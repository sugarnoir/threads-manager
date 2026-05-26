/**
 * Challenge Detector
 *
 * Instagram の危険画面を3層で検知:
 *   - URL    : /challenge/ /checkpoint/ /disabled/ /suspended/ etc.
 *   - DOM    : "Verify it's you" / "本人確認" / "selfie" etc.
 *   - Network: webRequest経由でURLパターンマッチ
 *
 * 検知時は onDetected コールバックを呼ぶ。
 * 1度検知したら以降の検知はsuppress（重複通知防止）。
 */

import type { WebContents, Session } from 'electron';
import type {
  ChallengeSignal,
  ChallengeSignalLayer,
  LoginPhase,
} from './login-probe.types';

// ============================================================
// 検知パターン定義
// ============================================================

const CHALLENGE_URL_PATTERNS: readonly string[] = [
  '/challenge/',
  '/accounts/login/checkpoint/',
  '/accounts/disabled/',
  '/accounts/suspended/',
  '/checkpoint/',
];

const DOM_KEYWORDS_EN: readonly string[] = [
  "Verify it's you",
  'We detected unusual login',
  'Confirm your identity',
  'Help us confirm',
  'This was me',
  "This wasn't me",
  'Upload a photo',
  'Take a selfie',
  'Selfie video',
  'suspicious login',
  'Suspicious Login Attempt',
  'Your account has been disabled',
  'Account suspended',
  'temporarily blocked',
  'Action Blocked',
  'Please verify your account',
  'Confirm your account',
];

const DOM_KEYWORDS_JA: readonly string[] = [
  '本人確認',
  '不審なログイン',
  '本人ですか',
  '私です',
  '私ではありません',
  'セルフィー',
  '自撮り',
  'アカウントが無効',
  'アカウントが停止',
  '一時的にブロック',
  'アクションがブロック',
  '認証コードを送信しました',
];

const NETWORK_URL_PATTERNS: readonly string[] = [
  '/challenge/',
  '/checkpoint/',
  '/accounts/disabled/',
];

// ============================================================
// Detector class
// ============================================================

export class ChallengeDetector {
  private currentPhase: LoginPhase = 'idle';
  private detected: ChallengeSignal | null = null;
  private domIntervalHandle: ReturnType<typeof setInterval> | null = null;
  private urlListener: ((event: Electron.Event, url: string) => void) | null = null;
  private inPageNavListener: ((event: Electron.Event, url: string) => void) | null = null;
  private networkListener: ((details: Electron.OnCompletedListenerDetails) => void) | null = null;
  private webContentsRef: WebContents | null = null;
  private sessionRef: Session | null = null;
  private readonly onDetected: (signal: ChallengeSignal) => void;
  private readonly domPollMs: number;

  constructor(
    onDetected: (signal: ChallengeSignal) => void,
    options: { domPollMs?: number } = {},
  ) {
    this.onDetected = onDetected;
    this.domPollMs = options.domPollMs ?? 600;
  }

  setPhase(phase: LoginPhase): void {
    this.currentPhase = phase;
  }

  getDetected(): ChallengeSignal | null {
    return this.detected;
  }

  start(webContents: WebContents, sess: Session): void {
    if (this.webContentsRef) throw new Error('ChallengeDetector: already started');
    this.webContentsRef = webContents;
    this.sessionRef = sess;

    this.urlListener = (_event, url) => this.checkUrl(url);
    this.inPageNavListener = (_event, url) => this.checkUrl(url);
    webContents.on('did-navigate', this.urlListener);
    webContents.on('did-navigate-in-page', this.inPageNavListener);

    this.networkListener = (details) => this.checkNetwork(details);
    sess.webRequest.onCompleted(this.networkListener);

    this.domIntervalHandle = setInterval(() => {
      this.checkDom().catch(() => {});
    }, this.domPollMs);
  }

  stop(): void {
    if (this.domIntervalHandle) {
      clearInterval(this.domIntervalHandle);
      this.domIntervalHandle = null;
    }
    if (this.webContentsRef) {
      if (this.urlListener) this.webContentsRef.removeListener('did-navigate', this.urlListener);
      if (this.inPageNavListener) this.webContentsRef.removeListener('did-navigate-in-page', this.inPageNavListener);
    }
    if (this.sessionRef && this.networkListener) {
      (this.sessionRef.webRequest.onCompleted as (cb: null) => void)(null);
    }
    this.urlListener = null;
    this.inPageNavListener = null;
    this.networkListener = null;
    this.webContentsRef = null;
    this.sessionRef = null;
  }

  private emit(layer: ChallengeSignalLayer, value: string): void {
    if (this.detected) return;
    const signal: ChallengeSignal = {
      layer,
      value,
      phase: this.currentPhase,
      matchedAt: new Date().toISOString(),
    };
    this.detected = signal;
    try { this.onDetected(signal); } catch (err) {
      console.error('[ChallengeDetector] onDetected callback threw:', err);
    }
  }

  private checkUrl(url: string): void {
    if (isTwoFactorUrl(url)) return;  // 2FA は challenge ではない
    for (const pattern of CHALLENGE_URL_PATTERNS) {
      if (url.includes(pattern)) { this.emit('url', pattern); return; }
    }
  }

  private async checkDom(): Promise<void> {
    if (this.detected) return;
    const wc = this.webContentsRef;
    if (!wc || wc.isDestroyed()) return;

    const keywords = [...DOM_KEYWORDS_EN, ...DOM_KEYWORDS_JA];
    const script = `(() => {
      try {
        const text = (document.body && document.body.innerText) || '';
        const keywords = ${JSON.stringify(keywords)};
        for (const kw of keywords) {
          if (text.indexOf(kw) !== -1) return kw;
        }
        return null;
      } catch (e) { return null; }
    })()`;

    const result = await wc.executeJavaScript(script, true);
    if (typeof result === 'string' && result.length > 0) {
      this.emit('dom', result);
    }
  }

  private checkNetwork(details: Electron.OnCompletedListenerDetails): void {
    const url = details.url;
    for (const pattern of NETWORK_URL_PATTERNS) {
      if (url.includes(pattern)) { this.emit('network', pattern); return; }
    }
    if (details.statusCode === 400 && url.includes('/api/v1/accounts/login_ajax/')) {
      this.emit('network', 'login_ajax_400');
    }
  }
}

// ============================================================
// URL分類ユーティリティ
// ============================================================

export function isTwoFactorUrl(url: string): boolean {
  return url.includes('/accounts/login/two_factor') ||
    url.includes('/accounts/login/two-factor') ||
    url.includes('/two_factor') ||
    url.includes('/two-step-verification') ||
    url.includes('next=%2Faccounts%2Flogin%2Ftwo_factor');
}

export function isChallengeUrl(url: string): boolean {
  return CHALLENGE_URL_PATTERNS.some((p) => url.includes(p));
}

export function isLoggedInUrl(url: string): boolean {
  if (!url.startsWith('https://www.instagram.com/')) return false;
  if (url.includes('/accounts/login')) return false;
  if (url.includes('/challenge/')) return false;
  if (url.includes('/checkpoint/')) return false;
  if (url.includes('/two_factor/')) return false;
  return true;
}
