/**
 * Login Probe - IPC Handlers
 *
 * チャンネル:
 *   login-probe:single           → 単発ログイン
 *   login-probe:bulk             → bulk ログイン
 *   login-probe:resolve-challenge → challenge 手動解決
 *   login-probe:check-session    → session 生存チェック
 *   login-probe:release-all      → 全 view 強制破棄
 *
 * イベント (main → renderer):
 *   login-probe:phase            → phase 変化
 *   login-probe:challenge        → challenge 検知
 *   login-probe:done             → 完了通知
 */

import { ipcMain, type BrowserWindow } from 'electron';
import {
  probeLogin,
  bulkProbeLogin,
  cancelProbe,
  releaseRetainedView,
  releaseAllRetainedViews,
} from './instagram-login';
import { setMainWindow, updateAccount } from './login-helpers';
import type { LoginProbeOptions, BulkLoginConfig } from './login-probe.types';

export function registerLoginProbeHandlers(mainWindow: BrowserWindow): void {
  setMainWindow(mainWindow);

  ipcMain.handle('login-probe:single', async (_event, options: LoginProbeOptions) => {
    return probeLogin(options, mainWindow);
  });

  ipcMain.handle('login-probe:bulk', async (_event, payload: {
    optionsList: LoginProbeOptions[];
    config?: BulkLoginConfig;
  }) => {
    return bulkProbeLogin(payload.optionsList, mainWindow, payload.config ?? {});
  });

  ipcMain.handle('login-probe:resolve-challenge', async (_event, accountId: number) => {
    releaseRetainedView(accountId, mainWindow);
    updateAccount(accountId, {
      status: 'active',
      last_login_phase: 'logged_in',
      login_probe_error: null,
    });
    return { ok: true };
  });

  ipcMain.handle('login-probe:check-session', async (_event, accountId: number) => {
    const result = await probeLogin(
      { accountId, username: '', password: '', skipIfSessionAlive: true },
      mainWindow,
    );
    return {
      ok: result.ok,
      alive: result.ok && result.sessionAlreadyAlive,
    };
  });

  ipcMain.handle('login-probe:cancel', async (_event, accountId: number) => {
    cancelProbe(accountId, mainWindow);
    updateAccount(accountId, {
      status: 'inactive',
      last_login_phase: 'failed',
      login_probe_error: 'cancelled_by_user',
    });
    return { ok: true };
  });

  ipcMain.handle('login-probe:release-all', async () => {
    releaseAllRetainedViews(mainWindow);
    return { ok: true };
  });
}
