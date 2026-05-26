/**
 * Instagram Login Probe
 *
 * 半自動ログインフロー:
 *   1. ig_password と totp_secret でログイン画面に自動入力
 *   2. 2FAが出た場合は totp_secret からコード生成して入力
 *   3. challenge / checkpoint を検知したら自動処理停止
 *   4. 停止時は status='challenge' にして画面を開いたままユーザーに引き継ぐ
 *   5. ログイン成功時は Cookie/localStorage/IndexedDB を persist:account-{id} に維持
 *   6. 既存sessionは削除しない
 *   7. bulk は同時実行数制限 + jitter
 */

import {
  app,
  session,
  WebContentsView,
  type BrowserWindow,
  type Session,
} from 'electron';
import path from 'path';
import fs from 'fs';
import {
  ChallengeDetector,
  isChallengeUrl,
  isLoggedInUrl,
  isTwoFactorUrl,
} from './challenge-detector';
import {
  sleep,
  jitter,
  randInt,
  humanType,
  humanClick,
  createLimit,
  updateAccount,
  notifyChallengeDetected,
  notifyPhaseChanged,
  notifyDone,
} from './login-helpers';
import type {
  LoginProbeOptions,
  LoginProbeResult,
  LoginPhase,
  ChallengeSignal,
  BulkLoginConfig,
  ChallengeNotification,
} from './login-probe.types';

// ============================================================
// 定数
// ============================================================

const IG_LOGIN_URL = 'https://www.instagram.com/accounts/login/';
const IG_HOME_URL = 'https://www.instagram.com/';

const SEL_USERNAME = 'input[name="email"], input[name="username"], input[autocomplete="username"]';
const SEL_PASSWORD = 'input[name="pass"], input[name="password"], input[autocomplete="current-password"]';
const SEL_LOGIN_SUBMIT = 'button[type="submit"], input[type="submit"], [type="submit"]';
const SEL_2FA_INPUT = 'input[name="verificationCode"], input[name="approvals_code"], input[autocomplete="one-time-code"], input[inputmode="numeric"][maxlength="6"]';

const PAGE_LOAD_SETTLE_MS = 2500;
const POST_SUBMIT_WAIT_MS = 5000;
const CHALLENGE_DETECTION_GRACE_MS = 1500;

// ============================================================
// TOTP 生成 (TM 既存の otpauth ライブラリを使用)
// ============================================================

function generateTOTP(secret: string): string {
  const { TOTP } = require('otpauth')
  const totp = new TOTP({ secret, digits: 6, period: 30, algorithm: 'SHA1' })
  return totp.generate()
}

// ============================================================
// デバッグスクリーンショット（失敗時のみ）
// ============================================================

async function captureDebugScreenshot(
  view: WebContentsView,
  accountId: number,
  reason: string,
): Promise<string | null> {
  try {
    const dir = path.join(app.getPath('userData'), 'login-probe-debug')
    fs.mkdirSync(dir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${accountId}-${timestamp}-${reason}.png`
    const filePath = path.join(dir, filename)
    const image = await view.webContents.capturePage()
    fs.writeFileSync(filePath, image.toPNG())
    console.log(`[login-probe] screenshot saved: ${filePath}`)
    return filename
  } catch (err) {
    console.warn(`[login-probe] screenshot failed:`, err)
    return null
  }
}

// ============================================================
// View管理
// _retainedViews: challenge検知後に保持（UIに引き継ぐ）
// _activeProbeViews: probeLogin 実行中の view（キャンセル用）
// ============================================================

const _retainedViews = new Map<number, WebContentsView>();
const _activeProbeViews = new Map<number, WebContentsView>();

function registerActiveView(accountId: number, view: WebContentsView): void {
  _activeProbeViews.set(accountId, view);
}

function unregisterActiveView(accountId: number): void {
  _activeProbeViews.delete(accountId);
}

function retainView(accountId: number, view: WebContentsView): void {
  unregisterActiveView(accountId);
  const existing = _retainedViews.get(accountId);
  if (existing && existing !== view) {
    try { existing.webContents.close(); } catch { /* noop */ }
  }
  _retainedViews.set(accountId, view);
}

/**
 * challenge 後の retained view、または実行中の active view を破棄する。
 * どちらにも該当しなければ何もしない。
 */
export function cancelProbe(
  accountId: number,
  parentWindow: BrowserWindow,
): void {
  // retained (challenge後)
  const retained = _retainedViews.get(accountId);
  if (retained) {
    try { parentWindow.contentView.removeChildView(retained); } catch { /* noop */ }
    _retainedViews.delete(accountId);
    return;
  }
  // active (実行中)
  const active = _activeProbeViews.get(accountId);
  if (active) {
    try { parentWindow.contentView.removeChildView(active); } catch { /* noop */ }
    _activeProbeViews.delete(accountId);
  }
}

export function releaseRetainedView(
  accountId: number,
  parentWindow: BrowserWindow,
): void {
  const view = _retainedViews.get(accountId);
  if (!view) return;
  try { parentWindow.contentView.removeChildView(view); } catch { /* noop */ }
  _retainedViews.delete(accountId);
}

export function releaseAllRetainedViews(parentWindow: BrowserWindow): void {
  for (const accountId of [..._retainedViews.keys()]) {
    releaseRetainedView(accountId, parentWindow);
  }
}

// ============================================================
// View生成
// ============================================================

type CreatedView = { view: WebContentsView; session: Session };

function createAccountView(
  accountId: number,
  parentWindow: BrowserWindow,
): CreatedView {
  const partition = `persist:account-${accountId}`;
  const accountSession = session.fromPartition(partition);

  const view = new WebContentsView({
    webPreferences: {
      session: accountSession,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  parentWindow.contentView.addChildView(view);

  const bounds = parentWindow.getBounds();
  view.setBounds({
    x: Math.max(0, bounds.width - 420),
    y: 60,
    width: 400,
    height: Math.max(600, bounds.height - 120),
  });

  return { view, session: accountSession };
}

// ============================================================
// 既存session生存チェック
// ============================================================

async function checkSessionAlive(
  accountId: number,
  parentWindow: BrowserWindow,
): Promise<boolean> {
  const { view } = createAccountView(accountId, parentWindow);
  try {
    await view.webContents.loadURL(IG_HOME_URL);
    await sleep(2000);
    const url = view.webContents.getURL();
    return !url.includes('/accounts/login');
  } catch {
    return false;
  } finally {
    try { parentWindow.contentView.removeChildView(view); } catch { /* noop */ }
  }
}

// ============================================================
// メインフロー: 単発ログイン
// ============================================================

export async function probeLogin(
  options: LoginProbeOptions,
  parentWindow: BrowserWindow,
): Promise<LoginProbeResult> {
  const { accountId, username, password, totpSecret } = options;
  const skipIfAlive = options.skipIfSessionAlive ?? true;

  // Step 1: 既存session生存チェック
  if (skipIfAlive) {
    notifyPhaseChanged({ accountId, phase: 'navigating' });
    const alive = await checkSessionAlive(accountId, parentWindow);
    if (alive) {
      updateAccount(accountId, {
        last_login_phase: 'logged_in',
        login_probe_error: null,
      });
      notifyDone({ accountId, ok: true, phase: 'logged_in' });
      return { ok: true, accountId, sessionAlreadyAlive: true };
    }
  }

  // Step 2: ログイン用 view 起動
  const { view, session: accountSession } = createAccountView(accountId, parentWindow);
  registerActiveView(accountId, view);

  let currentPhase: LoginPhase = 'idle';
  const detector = new ChallengeDetector((signal) => { detectedSignal = signal; });
  let detectedSignal: ChallengeSignal | null = null;

  const setPhase = (p: LoginPhase) => {
    currentPhase = p;
    detector.setPhase(p);
    notifyPhaseChanged({ accountId, phase: p });
  };

  detector.start(view.webContents, accountSession);

  // challenge 検知時の共通処理
  const haltOnChallenge = (phase: LoginPhase): LoginProbeResult | null => {
    if (!detectedSignal) return null;
    const signal = detectedSignal;

    updateAccount(accountId, {
      status: 'challenge',
      last_login_phase: 'challenge_detected',
      login_probe_error: `challenge:${signal.layer}:${signal.value}`,
      alertErrorType: 'challenge_detected',
      alertRawBody: JSON.stringify(signal),
    });

    retainView(accountId, view);
    detector.stop();

    const notification: ChallengeNotification = { accountId, username, phase, signal };
    notifyChallengeDetected(notification);
    notifyDone({ accountId, ok: false, phase: 'challenge_detected' });

    return { ok: false, accountId, phase: 'challenge_detected', signal };
  };

  const cleanupView = () => {
    detector.stop();
    unregisterActiveView(accountId);
    try { parentWindow.contentView.removeChildView(view); } catch { /* noop */ }
  };

  try {
    // Step 3: ログイン画面ロード
    setPhase('navigating');
    await view.webContents.loadURL(IG_LOGIN_URL);
    await sleep(PAGE_LOAD_SETTLE_MS + randInt(0, 1000));

    { const r = haltOnChallenge('navigating'); if (r) return r; }

    // Step 4: 認証情報入力
    setPhase('entering_credentials');
    await humanType(view.webContents, SEL_USERNAME, username);
    await sleep(randInt(400, 900));
    await humanType(view.webContents, SEL_PASSWORD, password);
    await sleep(randInt(600, 1400));

    const clicked = await humanClick(view.webContents, SEL_LOGIN_SUBMIT);
    if (!clicked) {
      const screenshot = await captureDebugScreenshot(view, accountId, 'submit_not_found');
      updateAccount(accountId, {
        last_login_phase: 'failed',
        login_probe_error: `login_submit_button_not_found${screenshot ? ` [${screenshot}]` : ''}`,
        alertErrorType: 'login_failed',
        alertRawBody: 'submit button not found',
      });
      cleanupView();
      notifyDone({ accountId, ok: false, phase: 'failed' });
      return { ok: false, accountId, phase: 'failed', error: 'login_submit_button_not_found' };
    }

    await sleep(POST_SUBMIT_WAIT_MS + randInt(0, 2000));
    await sleep(CHALLENGE_DETECTION_GRACE_MS);

    { const r = haltOnChallenge('entering_credentials'); if (r) return r; }

    // Step 5: 2FA 判定
    const urlAfterCreds = view.webContents.getURL();
    if (isTwoFactorUrl(urlAfterCreds)) {
      setPhase('awaiting_2fa');

      if (!totpSecret) {
        updateAccount(accountId, {
          last_login_phase: 'awaiting_2fa',
          login_probe_error: '2fa_required_but_totp_missing',
          alertErrorType: 'two_fa_missing',
          alertRawBody: '2FA required but totpSecret not provided',
        });
        retainView(accountId, view);
        detector.stop();
        notifyDone({ accountId, ok: false, phase: 'awaiting_2fa' });
        return { ok: false, accountId, phase: 'awaiting_2fa', error: '2fa_required_but_totp_missing' };
      }

      // TOTP 時間境界回避: 残り5秒未満なら次のウィンドウまで待つ
      const TOTP_STEP_SEC = 30;
      const remainingSec = TOTP_STEP_SEC - (Math.floor(Date.now() / 1000) % TOTP_STEP_SEC);
      if (remainingSec < 5) {
        await sleep((remainingSec + 1) * 1000);
      }
      const code = generateTOTP(totpSecret);

      setPhase('entering_2fa');
      await humanType(view.webContents, SEL_2FA_INPUT, code);
      await sleep(randInt(500, 1100));

      await view.webContents.executeJavaScript(`
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const target = btns.find(b => {
            const t = (b.textContent || '').trim();
            if (!t) return false;
            return /Confirm|Verify|Submit|Continue|確認|送信/i.test(t);
          });
          if (target) { target.click(); return true; }
          const submit = document.querySelector('button[type="submit"]');
          if (submit) { submit.click(); return true; }
          return false;
        })()
      `);

      await sleep(POST_SUBMIT_WAIT_MS + randInt(0, 2000));
      await sleep(CHALLENGE_DETECTION_GRACE_MS);

      { const r = haltOnChallenge('entering_2fa'); if (r) return r; }
    }

    // Step 6: 最終結果判定
    const finalUrl = view.webContents.getURL();

    if (isChallengeUrl(finalUrl)) {
      detectedSignal = {
        layer: 'url',
        value: finalUrl,
        phase: currentPhase,
        matchedAt: new Date().toISOString(),
      };
      const r = haltOnChallenge(currentPhase);
      if (r) return r;
    }

    if (isLoggedInUrl(finalUrl)) {
      setPhase('logged_in');
      updateAccount(accountId, {
        status: 'active',
        last_login_phase: 'logged_in',
        login_probe_error: null,
      });
      cleanupView();
      notifyDone({ accountId, ok: true, phase: 'logged_in' });
      return { ok: true, accountId, sessionAlreadyAlive: false };
    }

    // unexpected
    const screenshot2 = await captureDebugScreenshot(view, accountId, 'unexpected_url');
    updateAccount(accountId, {
      last_login_phase: 'failed',
      login_probe_error: `unexpected_url:${finalUrl}${screenshot2 ? ` [${screenshot2}]` : ''}`,
      alertErrorType: 'unexpected_url',
      alertRawBody: finalUrl,
    });
    cleanupView();
    notifyDone({ accountId, ok: false, phase: 'failed' });
    return { ok: false, accountId, phase: 'failed', error: `unexpected_final_url:${finalUrl}` };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // exception catch 内でもスクショ試行（view が破壊されてなければ）
    const screenshot3 = await captureDebugScreenshot(view, accountId, 'exception').catch(() => null);
    updateAccount(accountId, {
      last_login_phase: 'failed',
      login_probe_error: `exception:${message}${screenshot3 ? ` [${screenshot3}]` : ''}`,
      alertErrorType: 'login_failed',
      alertRawBody: message,
    });
    cleanupView();
    notifyDone({ accountId, ok: false, phase: 'failed' });
    return { ok: false, accountId, phase: 'failed', error: message };
  }
}

// ============================================================
// Bulk実行
// ============================================================

export async function bulkProbeLogin(
  optionsList: LoginProbeOptions[],
  parentWindow: BrowserWindow,
  config: BulkLoginConfig = {},
): Promise<LoginProbeResult[]> {
  const concurrency = config.concurrency ?? 3;
  const maxJitterMs = config.jitterMs ?? 30000;
  const limit = createLimit(concurrency);

  const tasks = optionsList.map((opts) =>
    limit(async () => {
      await jitter(maxJitterMs);
      try {
        return await probeLogin(opts, parentWindow);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, accountId: opts.accountId, phase: 'failed' as LoginPhase, error: message };
      }
    }),
  );

  return Promise.all(tasks);
}
