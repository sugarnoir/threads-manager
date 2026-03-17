import { ipcMain, app, Menu, BrowserWindow, session, WebContents } from 'electron'
import path from 'path'
import fs from 'fs'
import {
  getAllAccounts,
  createAccount,
  updateAccountStatus,
  updateAccountProxy,
  updateAccountDisplayName,
  updateAccountGroup,
  updateAccountMemo,
  updateAccountSpeedPreset,
  reorderAccounts,
  deleteAccount,
  getAccountById,
} from '../db/repositories/accounts'
import { setSetting } from '../db/repositories/settings'
import { checkLoginStatus, checkAccountStatus } from '../playwright/threads-client'
import { closeContext, reloadContext } from '../playwright/browser-manager'
import { getViewManager } from '../browser-views/view-manager'
import { sendDiscordNotification } from '../discord'

export function registerAccountHandlers(): void {
  ipcMain.handle('accounts:list', () => getAllAccounts())

  ipcMain.handle(
    'accounts:add',
    async (
      _event,
      options?: { proxy_url?: string; proxy_username?: string; proxy_password?: string }
    ) => {
      const tempKey  = `temp-${Date.now()}`
      const sessionDir = path.join(
        app.getPath('userData'),
        'sessions',
        `account-${Date.now()}`
      )

      try {
        const viewManager = getViewManager()
        const { username } = await viewManager.startLogin(tempKey)

        const account = createAccount({
          username,
          session_dir: sessionDir,
          proxy_url: options?.proxy_url,
          proxy_username: options?.proxy_username,
          proxy_password: options?.proxy_password,
        })
        updateAccountStatus(account.id, 'active')

        // Copy login session cookies into the permanent account partition
        await viewManager.migrateLoginSession(tempKey, account.id)

        return { success: true, account: { ...account, status: 'active' } }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Notify login failure (but not for user-cancelled)
        if (!msg.includes('キャンセル')) {
          sendDiscordNotification({
            event: 'login_failed',
            username: 'unknown',
            message: 'ログインに失敗しました',
            detail: msg,
          }).catch(() => {})
        }
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle(
    'accounts:update-proxy',
    async (
      _event,
      data: { id: number; proxy_url: string | null; proxy_username: string | null; proxy_password: string | null }
    ) => {
      updateAccountProxy(data.id, {
        proxy_url: data.proxy_url,
        proxy_username: data.proxy_username,
        proxy_password: data.proxy_password,
      })

      // 1. Playwright コンテキストを再起動（次回 getContext 時に新プロキシで起動）
      await reloadContext(data.id)

      // 2. Electron セッション（WebContentsView 用）にもプロキシを反映
      try {
        const sess = session.fromPartition(`persist:account-${data.id}`)
        if (data.proxy_url) {
          // proxy_url が "http://host:port" 形式の場合そのまま渡す
          await sess.setProxy({ proxyRules: data.proxy_url })
        } else {
          await sess.setProxy({ proxyRules: 'direct://' })
        }

        // 3. 開いている WebContentsView をリロードして新プロキシを適用
        try {
          getViewManager().reload(data.id)
        } catch { /* ビューが開いていない場合は無視 */ }
      } catch { /* セッションが存在しない場合は無視 */ }

      return { success: true, account: getAccountById(data.id) }
    }
  )

  ipcMain.handle('accounts:check', async (_event, id: number) => {
    const result = await checkAccountStatus(id)
    updateAccountStatus(id, result.status)
    if (result.status !== 'active') {
      const account = getAccountById(id)
      if (account) {
        const eventType = result.status === 'frozen' ? 'account_error' : 'account_error'
        sendDiscordNotification({
          event: eventType,
          username: account.username,
          message: result.status === 'frozen'
            ? '🔴 アカウントが凍結されています'
            : result.status === 'needs_login'
            ? '🟡 セッションが切れています。再ログインが必要です。'
            : `⚠️ ステータス確認エラー: ${result.message ?? '不明'}`,
          detail: result.message,
        }).catch(() => {})
      }
    }
    return { status: result.status, message: result.message }
  })

  ipcMain.handle('accounts:check-all', async (event) => {
    const accounts = getAllAccounts()
    const total = accounts.length
    const sender: WebContents = event.sender

    const push = (data: object) => {
      if (!sender.isDestroyed()) sender.send('accounts:check-progress', data)
    }

    push({ type: 'start', total })

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i]
      push({ type: 'checking', accountId: account.id, index: i, total })

      const result = await checkAccountStatus(account.id)
      updateAccountStatus(account.id, result.status)

      if (result.status !== 'active') {
        sendDiscordNotification({
          event: 'account_error',
          username: account.username,
          message: result.status === 'frozen'
            ? '🔴 アカウントが凍結されています'
            : result.status === 'needs_login'
            ? '🟡 セッションが切れています'
            : `⚠️ エラー: ${result.message ?? '不明'}`,
          detail: result.message,
        }).catch(() => {})
      }

      push({ type: 'result', accountId: account.id, status: result.status, message: result.message, index: i + 1, total })
    }

    push({ type: 'done', total })
    return { success: true }
  })

  ipcMain.handle('accounts:update-display-name', (_event, data: { id: number; display_name: string | null }) => {
    updateAccountDisplayName(data.id, data.display_name)
    return { success: true }
  })

  ipcMain.handle('accounts:update-group', (_event, data: { id: number; group_name: string | null }) => {
    updateAccountGroup(data.id, data.group_name)
    return { success: true }
  })

  ipcMain.handle('accounts:update-memo', (_event, data: { id: number; memo: string | null }) => {
    updateAccountMemo(data.id, data.memo)
    return { success: true }
  })

  ipcMain.handle('accounts:update-speed-preset', (_event, data: { id: number; speed_preset: 'slow' | 'normal' | 'fast' }) => {
    updateAccountSpeedPreset(data.id, data.speed_preset)
    return { success: true }
  })

  ipcMain.handle(
    'accounts:reorder',
    (_event, updates: { id: number; sort_order: number; group_name: string | null }[]) => {
      reorderAccounts(updates)
      return { success: true }
    }
  )

  ipcMain.handle('accounts:clear-cookies', async (_event, id: number) => {
    // 1. Electron セッション（WebContentsView）のストレージを全消去
    try {
      const sess = session.fromPartition(`persist:account-${id}`)
      await sess.clearStorageData()
    } catch { /* session may not exist */ }

    // 2. Playwright コンテキストを閉じて session_dir を削除（完全リセット）
    await closeContext(id)
    const account = getAccountById(id)
    if (account?.session_dir) {
      try {
        fs.rmSync(account.session_dir, { recursive: true, force: true })
      } catch { /* ignore */ }
    }

    // 3. DBに保存したCookieバックアップも削除
    setSetting(`session_cookies_${id}`, '')

    return { success: true }
  })

  ipcMain.handle('accounts:delete', async (_event, id: number) => {
    const account = getAccountById(id)

    // 1. Playwright コンテキストを閉じる
    await closeContext(id)

    // 2. Playwright session_dir を削除
    if (account?.session_dir) {
      try {
        fs.rmSync(account.session_dir, { recursive: true, force: true })
      } catch { /* ignore */ }
    }

    // 3. DBのCookieバックアップを削除
    setSetting(`session_cookies_${id}`, '')

    // 4. Electron セッションのストレージを消去
    try {
      const sess = session.fromPartition(`persist:account-${id}`)
      await sess.clearStorageData()
    } catch { /* session may not exist */ }

    // 5. WebContentsView を閉じる
    try { getViewManager().closeView(id) } catch { /* ignore */ }

    deleteAccount(id)
    return { success: true }
  })

  // ── ネイティブコンテキストメニュー ──────────────────────────────────────────
  // WebContentsView より前面に表示するため Electron ネイティブメニューを使用
  ipcMain.handle('accounts:context-menu', (event, accountId: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const menu = Menu.buildFromTemplate([
      {
        label: '🌐  ブラウザで開く',
        click: () => win.webContents.send('accounts:action', { type: 'open', accountId }),
      },
      {
        label: '🔄  状態確認',
        click: () => win.webContents.send('accounts:action', { type: 'check', accountId }),
      },
      {
        label: '📁  グループ変更',
        click: () => win.webContents.send('accounts:action', { type: 'edit-group', accountId }),
      },
      {
        label: '🔒  プロキシ設定',
        click: () => win.webContents.send('accounts:action', { type: 'edit-proxy', accountId }),
      },
      { type: 'separator' },
      {
        label: '🗑  削除',
        click: () => win.webContents.send('accounts:action', { type: 'delete', accountId }),
      },
    ])

    menu.popup({ window: win })
  })
}
