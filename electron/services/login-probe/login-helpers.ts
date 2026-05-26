/**
 * Login Probe - ヘルパー関数
 *
 * - sleep / jitter
 * - human-like typing into WebContentsView
 * - DB write (TM の better-sqlite3 直接)
 * - Renderer通知 (BrowserWindow.webContents.send)
 * - 自前 pLimit
 */

import type { WebContents, BrowserWindow } from 'electron';
import { getDb } from '../../db';
import { insertAlert } from '../../db/repositories/response-alerts';
import type {
  LoginPhase,
  ChallengeSignal,
  ChallengeNotification,
} from './login-probe.types';

// ============================================================
// 基本ユーティリティ
// ============================================================

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(maxMs: number): Promise<void> {
  return sleep(Math.random() * maxMs);
}

export function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// ============================================================
// 自前 pLimit
// ============================================================

export function createLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= concurrency) return;
    const task = queue.shift();
    if (!task) return;
    active++;
    task();
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          active--;
          next();
        }
      };
      queue.push(run);
      next();
    });
  };
}

// ============================================================
// Human-like typing
// ============================================================

export async function humanType(
  webContents: WebContents,
  selector: string,
  text: string,
): Promise<void> {
  // focus + click（IG のフィールドは click でアクティブ化される場合がある）
  await webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      el.click();
      return true;
    })()`,
  );
  await sleep(randInt(200, 500));

  // 1文字ずつ入力: ネイティブ setter + React が認識する全イベントを発火
  for (const char of text) {
    const escapedChar = JSON.stringify(char);
    await webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return;

        // React の内部ファイバーが参照するネイティブ setter を使う
        const proto = el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, (el.value || '') + ${escapedChar});
        } else {
          el.value = (el.value || '') + ${escapedChar};
        }

        // React 16+/17+/18+ が認識するイベント群を発火
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        // React 内部の _valueTracker をリセット（これがないと React が変更を無視する）
        const tracker = el._valueTracker;
        if (tracker) { tracker.setValue(''); }
      })()`,
    );
    await sleep(randInt(60, 180));
  }

  // 入力完了後に最終 change を発火
  await webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
  await sleep(randInt(150, 350));
}

export async function humanClick(
  webContents: WebContents,
  selector: string,
): Promise<boolean> {
  await sleep(randInt(300, 900));
  const clicked = await webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );
  return clicked === true;
}

// ============================================================
// DB write helpers (TM の better-sqlite3 直接)
// ============================================================

export type AccountUpdate = {
  status?: string;
  login_probe_error?: string | null;
  last_login_phase?: LoginPhase;
  /** response_alerts テーブルに追記する challenge 情報 */
  alertErrorType?: string;
  alertRawBody?: string;
};

export function updateAccount(
  accountId: number,
  update: AccountUpdate,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.transaction(() => {
    if (update.status !== undefined) {
      db.prepare("UPDATE accounts SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(update.status, accountId);
    }
    if (update.login_probe_error !== undefined) {
      db.prepare('UPDATE accounts SET login_probe_error = ? WHERE id = ?')
        .run(update.login_probe_error, accountId);
    }
    if (update.last_login_phase !== undefined) {
      db.prepare('UPDATE accounts SET last_login_phase = ?, login_probe_at = ? WHERE id = ?')
        .run(update.last_login_phase, now, accountId);
    }
    if (update.alertErrorType) {
      insertAlert(accountId, update.alertErrorType, update.alertRawBody);
    }
  })();
}

// ============================================================
// Renderer 通知
// ============================================================

let _mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  _mainWindow = win;
}

function send(channel: string, payload: unknown): void {
  if (!_mainWindow || _mainWindow.isDestroyed()) return;
  _mainWindow.webContents.send(channel, payload);
}

export function notifyChallengeDetected(notification: ChallengeNotification): void {
  send('login-probe:challenge', notification);
}

export function notifyPhaseChanged(payload: { accountId: number; phase: LoginPhase }): void {
  send('login-probe:phase', payload);
}

export function notifyDone(result: { accountId: number; ok: boolean; phase: LoginPhase }): void {
  send('login-probe:done', result);
}
