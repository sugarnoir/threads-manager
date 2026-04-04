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
  updateAccountUserAgent,
  reorderAccounts,
  deleteAccount,
  getAccountById,
  getAccountFingerprint,
} from '../db/repositories/accounts'
import { pickRandomIphoneUA } from '../utils/iphone-ua'
import { setSetting } from '../db/repositories/settings'
import type { StatusCheckResult } from '../browser-views/view-manager'
import { createAndSaveFingerprint } from '../fingerprint'
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
        const { username, displayName } = await viewManager.startLogin(tempKey)

        if (!username || username === 'unknown') {
          return { success: false, error: 'ユーザー名を取得できませんでした。ログインが完了しているか確認してください。' }
        }

        const account = createAccount({
          username,
          display_name: displayName ?? undefined,
          session_dir: sessionDir,
          proxy_url: options?.proxy_url,
          proxy_username: options?.proxy_username,
          proxy_password: options?.proxy_password,
          user_agent: pickRandomIphoneUA(),
        })
        // アカウント作成直後にフィンガープリントを固定
        createAndSaveFingerprint(account.id)
        updateAccountStatus(account.id, 'active', { display_name: displayName ?? undefined })

        // Copy login session cookies into the permanent account partition
        await viewManager.migrateLoginSession(tempKey, account.id)

        return { success: true, account: { ...account, status: 'active' } }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('UNIQUE constraint')) {
          return { success: false, error: 'このアカウントは既に追加されています。別のアカウントをお試しください。' }
        }
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
    'accounts:register',
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
        const { username, displayName } = await viewManager.startRegister(
          tempKey,
          options?.proxy_url,
          options?.proxy_username,
          options?.proxy_password,
        )

        if (!username || username === 'unknown') {
          return { success: false, error: 'ユーザー名を取得できませんでした。登録が完了しているか確認してください。' }
        }

        const account = createAccount({
          username,
          display_name: displayName ?? undefined,
          session_dir: sessionDir,
          proxy_url: options?.proxy_url,
          proxy_username: options?.proxy_username,
          proxy_password: options?.proxy_password,
          user_agent: pickRandomIphoneUA(),
        })
        // アカウント作成直後にフィンガープリントを固定
        createAndSaveFingerprint(account.id)
        updateAccountStatus(account.id, 'active', { display_name: displayName ?? undefined })
        await viewManager.migrateLoginSession(tempKey, account.id)

        return { success: true, account: { ...account, status: 'active' } }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('UNIQUE constraint')) {
          return { success: false, error: 'このアカウントは既に追加されています。別のアカウントをお試しください。' }
        }
        if (!msg.includes('キャンセル')) {
          sendDiscordNotification({
            event: 'login_failed',
            username: 'unknown',
            message: 'アカウント登録に失敗しました',
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
      console.log(`[accounts:update-proxy] reloadContext done for account=${data.id} proxy=${data.proxy_url ?? 'none'}`)

      // 2. Electron セッション（WebContentsView 用）にもプロキシを反映
      try {
        const sess = session.fromPartition(`persist:account-${data.id}`)
        if (data.proxy_url) {
          await sess.setProxy({ proxyRules: data.proxy_url })
          console.log(`[accounts:update-proxy] Electron session proxy set: ${data.proxy_url}`)
        } else {
          await sess.setProxy({ proxyRules: 'direct://' })
          console.log(`[accounts:update-proxy] Electron session proxy cleared (direct://)`)
        }

        // 3. WebContentsView を再初期化（プロキシ認証リスナーを新設定で再作成）
        try {
          getViewManager().reinitView(data.id)
        } catch { /* ビューが開いていない場合は無視 */ }
      } catch { /* セッションが存在しない場合は無視 */ }

      return { success: true, account: getAccountById(data.id) }
    }
  )

  ipcMain.handle('accounts:check', async (_event, id: number) => {
    const result: StatusCheckResult = await getViewManager().checkStatus(id)
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

      const result: StatusCheckResult = await getViewManager().checkStatus(account.id)
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

  ipcMain.handle('accounts:update-user-agent', (_event, data: { id: number; user_agent: string | null }) => {
    updateAccountUserAgent(data.id, data.user_agent)
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

  ipcMain.handle('accounts:reset-session', async (_event, id: number) => {
    // 1. Electron セッション（WebContentsView partition）のストレージを全消去
    try {
      const sess = session.fromPartition(`persist:account-${id}`)
      await sess.clearStorageData()
    } catch { /* session may not exist */ }

    // 2. Playwright コンテキストを閉じて session_dir を削除
    await closeContext(id)
    const account = getAccountById(id)
    if (account?.session_dir) {
      try {
        fs.rmSync(account.session_dir, { recursive: true, force: true })
      } catch { /* ignore */ }
    }

    // 3. DBのCookieバックアップを削除
    setSetting(`session_cookies_${id}`, '')

    // 4. アカウントステータスを needs_login に更新
    updateAccountStatus(id, 'needs_login')

    // 5. WebContentsView を閉じる（再ログイン促進）
    try { getViewManager().closeView(id) } catch { /* ignore */ }

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

  ipcMain.handle('accounts:fingerprint', (_event, id: number) => {
    const json = getAccountFingerprint(id)
    if (!json) return null
    try { return JSON.parse(json) } catch { return null }
  })

  // ── ネイティブコンテキストメニュー ──────────────────────────────────────────
  // WebContentsView より前面に表示するため Electron ネイティブメニューを使用
  ipcMain.handle('accounts:auto-register', async (event, data: {
    name: string
    email: string
    password: string
    proxy_url?: string | null
    proxy_username?: string | null
    proxy_password?: string | null
  }) => {
    const onStatus = (e: { type: string; detail?: string }) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('accounts:auto-register-status', e)
      }
    }
    try {
      const { username, displayName, tempKey } = await getViewManager().autoRegisterAccount(
        {
          name: data.name, email: data.email, password: data.password,
          proxyUrl: data.proxy_url, proxyUsername: data.proxy_username, proxyPassword: data.proxy_password,
        },
        onStatus,
      )
      const sessionDir = path.join(app.getPath('userData'), 'sessions', `account-${Date.now()}`)
      const account = createAccount({
        username,
        display_name: displayName ?? undefined,
        session_dir: sessionDir,
        proxy_url:      data.proxy_url      ?? undefined,
        proxy_username: data.proxy_username ?? undefined,
        proxy_password: data.proxy_password ?? undefined,
        user_agent: pickRandomIphoneUA(),
      })
      createAndSaveFingerprint(account.id)
      updateAccountStatus(account.id, 'active', { display_name: displayName ?? undefined })
      await getViewManager().migrateLoginSession(tempKey, account.id)
      onStatus({ type: 'completed' })
      return { success: true, account: { ...account, status: 'active' } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onStatus({ type: 'error', detail: msg })
      return { success: false, error: msg }
    }
  })

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

  ipcMain.handle('accounts:login-instagram', async (_event, accountId: number) => {
    try {
      const viewManager = getViewManager()
      await viewManager.startInstagramLogin(accountId)
      // ログイン後のクッキーを確認
      const sess = session.fromPartition(`persist:account-${accountId}`)
      const cookies = await sess.cookies.get({})
      const hasSessionId = cookies.some(c => c.name === 'sessionid' && c.domain?.includes('instagram.com'))
      return { success: true, hasSessionId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('accounts:bulk-login-instagram', async (event, data: { group_name: string | null }) => {
    const push = (payload: object) => {
      if (!event.sender.isDestroyed()) event.sender.send('accounts:bulk-login-progress', payload)
    }

    const all = getAllAccounts()
    const targets = data.group_name === null
      ? all.filter(a => a.group_name === null)
      : all.filter(a => a.group_name === data.group_name)

    const total = targets.length
    if (total === 0) {
      push({ type: 'done', total: 0, successCount: 0 })
      return { success: true }
    }

    push({ type: 'start', total })
    let successCount = 0

    for (let i = 0; i < targets.length; i++) {
      const account = targets[i]
      push({ type: 'progress', current: i, total, accountId: account.id, username: account.username })
      try {
        const viewManager = getViewManager()
        await viewManager.startInstagramLogin(account.id)
        const sess = session.fromPartition(`persist:account-${account.id}`)
        const cookies = await sess.cookies.get({})
        const hasSessionId = cookies.some(c => c.name === 'sessionid' && c.domain?.includes('instagram.com'))
        if (hasSessionId) successCount++
        push({ type: 'result', current: i + 1, total, accountId: account.id, username: account.username, success: hasSessionId })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        push({ type: 'result', current: i + 1, total, accountId: account.id, username: account.username, success: false, error: msg })
      }
    }

    push({ type: 'done', total, successCount })
    return { success: true }
  })

}
