import { ipcMain, app, Menu, BrowserWindow, session, WebContents } from 'electron'
import path from 'path'
import fs from 'fs'
import {
  getAllAccounts,
  createAccount,
  updateAccountStatus,
  updateAccountProxy,
  updateAccountDisplayName,
  updateAccountUsername,
  updateAccountGroup,
  updateAccountMemo,
  updateAccountMark,
  updateAccountSpeedPreset,
  updateAccountUserAgent,
  reorderAccounts,
  deleteAccount,
  getAccountById,
  getAccountFingerprint,
} from '../db/repositories/accounts'
import { pickRandomIphoneUA } from '../utils/iphone-ua'
import { getSetting, setSetting } from '../db/repositories/settings'
import type { StatusCheckResult } from '../browser-views/view-manager'
import { createAndSaveFingerprint } from '../fingerprint'
import { closeContext, reloadContext } from '../playwright/browser-manager'
import { getViewManager, fetchProfileFromInstagram, injectCookies, RawCookie } from '../browser-views/view-manager'
import { sendDiscordNotification } from '../discord'
import { autoRenameJapaneseFemale } from '../api/threads-web-api'

export function registerAccountHandlers(): void {
  ipcMain.handle('accounts:list', () => getAllAccounts())

  ipcMain.handle(
    'accounts:add',
    async (
      _event,
      options?: {
        proxy_url?:      string
        proxy_username?: string
        proxy_password?: string
        login_site?:     'threads' | 'instagram'
      }
    ) => {
      const viewManager = getViewManager()

      // ── login_site === 'instagram' (既存IGから作成) ─────────────────────
      // 動作確認済みの startInstagramLogin と完全に同じフローで実行するため、
      // 1) 仮ユーザー名で先にアカウントを作成（プロキシ・UA・フィンガープリントを永続パーティションに反映）
      // 2) startInstagramLogin(accountId) を呼ぶ（管理タブと同一コードパス）
      // 3) ログイン完了後、Cookie から実ユーザー名を取得してDB更新
      if (options?.login_site === 'instagram') {
        const userAgent  = pickRandomIphoneUA()
        const sessionDir = path.join(app.getPath('userData'), 'sessions', `account-${Date.now()}`)
        const placeholder = `__pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

        let stubAccountId: number | null = null
        try {
          const stub = createAccount({
            username:       placeholder,
            session_dir:    sessionDir,
            proxy_url:      options.proxy_url,
            proxy_username: options.proxy_username,
            proxy_password: options.proxy_password,
            user_agent:     userAgent,
          })
          stubAccountId = stub.id
          createAndSaveFingerprint(stub.id)
          updateAccountStatus(stub.id, 'needs_login')

          // 動作確認済みのコードを使用
          await viewManager.startInstagramLogin(stub.id)

          // ログイン後 Cookie から実ユーザー名を取得
          const sess = session.fromPartition(`persist:account-${stub.id}`)
          const cookies = await sess.cookies.get({})
          const hasSessionId = cookies.some(c => c.name === 'sessionid' && c.domain?.includes('instagram.com'))
          if (!hasSessionId) {
            // ログインが完了せずウィンドウが閉じられた → 仮アカウント削除
            try { deleteAccount(stub.id) } catch { /* ignore */ }
            return { success: false, error: 'Instagram ログインが完了しませんでした (sessionid 未取得)' }
          }

          const { username, displayName } = await fetchProfileFromInstagram(cookies)
          if (!username || username === 'unknown') {
            try { deleteAccount(stub.id) } catch { /* ignore */ }
            return { success: false, error: 'ユーザー名を取得できませんでした' }
          }

          // 仮ユーザー名 → 実ユーザー名に更新
          updateAccountUsername(stub.id, username)
          updateAccountStatus(stub.id, 'active', { display_name: displayName ?? undefined })

          const updated = getAccountById(stub.id)
          return { success: true, account: updated }
        } catch (err) {
          if (stubAccountId !== null) {
            try { deleteAccount(stubAccountId) } catch { /* ignore */ }
          }
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('UNIQUE constraint')) {
            return { success: false, error: 'このアカウントは既に追加されています。' }
          }
          return { success: false, error: msg }
        }
      }

      // ── 既存フロー (login_site === 'threads' or 未指定) ────────────────
      const tempKey  = `temp-${Date.now()}`
      const sessionDir = path.join(
        app.getPath('userData'),
        'sessions',
        `account-${Date.now()}`
      )

      try {
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

  /**
   * CSVから複数アカウントを一括インポート
   * 実際のログインは行わず、DB に username/password/proxy 情報のみ登録する。
   * 後から bulk-login-instagram などで個別ログインする想定。
   */
  ipcMain.handle(
    'accounts:bulk-import',
    async (
      _event,
      rows: Array<{
        username:    string
        password:    string | null
        proxy_host:  string | null
        proxy_port:  number | null
        proxy_user:  string | null
        proxy_pass:  string | null
        proxy_type?: string | null
        group_name?: string | null
      }>
    ) => {
      const results = {
        imported: 0,
        skipped:  0,
        errors:   [] as Array<{ username: string; message: string }>,
        accounts: [] as unknown[],
      }

      for (const row of rows) {
        const username = row.username?.trim()
        if (!username) {
          results.errors.push({ username: '', message: 'username が空です' })
          continue
        }

        let proxyUrl: string | undefined
        if (row.proxy_host && row.proxy_port) {
          const type = (row.proxy_type || 'http').toLowerCase()
          proxyUrl = `${type}://${row.proxy_host}:${row.proxy_port}`
        }

        const sessionDir = path.join(
          app.getPath('userData'),
          'sessions',
          `account-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        )

        try {
          const account = createAccount({
            username,
            session_dir:    sessionDir,
            proxy_url:      proxyUrl,
            proxy_username: row.proxy_user ?? undefined,
            proxy_password: row.proxy_pass ?? undefined,
            user_agent:     pickRandomIphoneUA(),
            ig_password:    row.password ?? undefined,
          })
          if (row.group_name) updateAccountGroup(account.id, row.group_name)
          createAndSaveFingerprint(account.id)
          updateAccountStatus(account.id, 'needs_login')
          results.imported++
          results.accounts.push(account)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('UNIQUE constraint')) {
            results.skipped++
            results.errors.push({ username, message: '既に追加済み' })
          } else {
            results.errors.push({ username, message: msg })
          }
        }
      }

      return results
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

  ipcMain.handle('accounts:update-mark', (_event, data: { id: number; mark: string | null }) => {
    updateAccountMark(data.id, data.mark)
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
      // DB追加前に追加の待機（autoRegisterAccount 内の 30s に加えて）
      onStatus({ type: 'saving', detail: 'DB に保存中...' })
      const sessionDir = path.join(app.getPath('userData'), 'sessions', `account-${Date.now()}`)
      const account = createAccount({
        username,
        display_name: displayName ?? undefined,
        session_dir: sessionDir,
        proxy_url:      data.proxy_url      ?? undefined,
        proxy_username: data.proxy_username ?? undefined,
        proxy_password: data.proxy_password ?? undefined,
        user_agent: pickRandomIphoneUA(),
        ig_password: data.password,
      })
      createAndSaveFingerprint(account.id)
      // status は needs_login で登録（すぐに active にするとロックリスクがある）
      updateAccountStatus(account.id, 'needs_login', { display_name: displayName ?? undefined })
      await getViewManager().migrateLoginSession(tempKey, account.id)
      onStatus({ type: 'completed' })
      return { success: true, account: { ...account, status: 'needs_login' } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onStatus({ type: 'error', detail: msg })
      return { success: false, error: msg }
    }
  })

  /**
   * Cookie ログインインポート。
   * フォーマット: username|password|token|[cookiesJSON]|email
   * Cookie を Electron パーティションに注入してアカウントを作成する。
   */
  ipcMain.handle('accounts:import-cookie-login', async (
    _event,
    rows: Array<{
      username:  string
      password:  string
      token:     string
      cookies:   unknown[]
      email:     string
      group_name?: string | null
    }>,
    options?: {
      proxyMode?:      'auto' | 'manual' | 'none'
      proxyStartPort?: number
    }
  ) => {
    console.log(`[import-cookie-login] START rows=${rows?.length ?? 'undefined'}`)
    if (!rows || !Array.isArray(rows)) {
      console.error(`[import-cookie-login] rows is not array:`, typeof rows, rows)
      return { imported: 0, skipped: 0, errors: [{ username: '', message: 'rows が不正' }] }
    }

    // ── ISP Dedicated プロキシ自動割り当て準備 ────────────────────────────
    // 既存アカウントから isp.decodo.com のプロキシ情報を収集
    const existingAccounts = getAllAccounts()
    const decodoAccounts = existingAccounts.filter(a =>
      a.proxy_url && a.proxy_url.includes('decodo')
    )

    // プロキシ認証情報を既存垢から取得（最初に見つかったもの）
    let proxyType = 'http'
    let proxyHost = ''
    let proxyUsername: string | null = null
    let proxyPassword: string | null = null
    if (decodoAccounts.length > 0) {
      const ref = decodoAccounts[0]
      try {
        const url = new URL(ref.proxy_url!)
        proxyType = url.protocol.replace(':', '')
        proxyHost = url.hostname
      } catch { /* ignore */ }
      proxyUsername = ref.proxy_username
      proxyPassword = ref.proxy_password
    }

    // ポートごとの使用垢数を集計
    const portCountMap = new Map<number, number>()
    let minPort = Infinity, maxPort = -Infinity
    for (const a of decodoAccounts) {
      try {
        const url = new URL(a.proxy_url!)
        const p = parseInt(url.port, 10)
        if (!isNaN(p)) {
          portCountMap.set(p, (portCountMap.get(p) ?? 0) + 1)
          if (p < minPort) minPort = p
          if (p > maxPort) maxPort = p
        }
      } catch { /* ignore */ }
    }

    // 設定されたポート範囲で上書き（設定がなければ既存アカウントから自動算出）
    const cfgStart = parseInt(getSetting('proxy_port_range_start') ?? '', 10)
    const cfgEnd   = parseInt(getSetting('proxy_port_range_end')   ?? '', 10)
    if (Number.isFinite(cfgStart) && cfgStart > 0) minPort = cfgStart
    if (Number.isFinite(cfgEnd)   && cfgEnd   > 0) maxPort = cfgEnd

    // 使用垢数が少ない順にポートをソート（同数はランダム）
    // 未使用ポート（範囲内で使われていないポート）も count=0 として含める
    const allPorts: Array<{ port: number; count: number }> = []
    if (proxyHost && minPort <= maxPort) {
      for (let p = minPort; p <= maxPort; p++) {
        allPorts.push({ port: p, count: portCountMap.get(p) ?? 0 })
      }
      allPorts.sort((a, b) => {
        if (a.count !== b.count) return a.count - b.count
        return Math.random() - 0.5  // 同数はランダム
      })
    }
    const proxyMode = options?.proxyMode ?? 'auto'
    console.log(`[import-cookie-login] proxyMode=${proxyMode} host=${proxyHost || 'NONE'} type=${proxyType} ports=${allPorts.length} user=${proxyUsername ?? 'NONE'}`)
    if (proxyMode === 'auto' && allPorts.length > 0) {
      console.log(`[import-cookie-login] top 5 least-used ports: ${allPorts.slice(0, 5).map(p => `${p.port}(${p.count}垢)`).join(', ')}`)
    }
    if (proxyMode === 'manual') {
      console.log(`[import-cookie-login] manual start port: ${options?.proxyStartPort}`)
    }

    const results = {
      imported: 0,
      skipped:  0,
      errors:   [] as Array<{ username: string; message: string }>,
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      console.log(`[import-cookie-login] row[${i}] username=${row.username} password=${row.password?.slice(0, 4)}... cookies.length=${row.cookies?.length ?? 'N/A'} email=${row.email}`)
      const username = row.username?.trim()
      if (!username) {
        console.log(`[import-cookie-login] row[${i}] SKIP: username empty`)
        results.errors.push({ username: '', message: 'username が空' })
        continue
      }

      // プロキシ割り当て
      let assignedProxyUrl: string | undefined
      if (proxyMode === 'auto' && proxyHost && allPorts.length > 0) {
        const portEntry = allPorts[i % allPorts.length]
        assignedProxyUrl = `${proxyType}://${proxyHost}:${portEntry.port}`
        console.log(`[import-cookie-login] row[${i}] auto proxy=${assignedProxyUrl} (was ${portEntry.count}垢)`)
      } else if (proxyMode === 'manual' && proxyHost && options?.proxyStartPort) {
        const port = options.proxyStartPort + i
        assignedProxyUrl = `${proxyType}://${proxyHost}:${port}`
        console.log(`[import-cookie-login] row[${i}] manual proxy=${assignedProxyUrl}`)
      }
      // proxyMode === 'none' → assignedProxyUrl は undefined のまま

      const sessionDir = path.join(
        app.getPath('userData'), 'sessions',
        `account-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      )

      try {
        console.log(`[import-cookie-login] row[${i}] creating account...`)
        const account = createAccount({
          username,
          session_dir:    sessionDir,
          user_agent:     pickRandomIphoneUA(),
          ig_password:    row.password || undefined,
          proxy_url:      assignedProxyUrl,
          proxy_username: assignedProxyUrl ? (proxyUsername ?? undefined) : undefined,
          proxy_password: assignedProxyUrl ? (proxyPassword ?? undefined) : undefined,
        })
        console.log(`[import-cookie-login] row[${i}] account created id=${account.id}`)
        if (row.group_name) updateAccountGroup(account.id, row.group_name)
        createAndSaveFingerprint(account.id)

        // Cookie を永続パーティションに注入
        const permSess = session.fromPartition(`persist:account-${account.id}`)
        const rawCookies: RawCookie[] = (row.cookies ?? []).map((c: unknown) => {
          const o = c as Record<string, unknown>
          return {
            name:           String(o.name  ?? ''),
            value:          String(o.value ?? ''),
            domain:         (o.domain as string) ?? undefined,
            path:           (o.path   as string) ?? '/',
            secure:         o.secure  as boolean | undefined,
            httpOnly:       o.httpOnly as boolean | undefined,
            expirationDate: o.expirationDate as number | undefined,
            expires:        o.expires as number | undefined,
            sameSite:       o.sameSite as string | undefined,
          }
        })
        console.log(`[import-cookie-login] row[${i}] rawCookies=${rawCookies.length} names=[${rawCookies.map(c => c.name).join(',')}]`)

        const hasSession = await injectCookies(rawCookies, permSess)
        console.log(`[import-cookie-login] row[${i}] injectCookies hasSession=${hasSession}`)

        // Cookie が実際にパーティションに書き込まれたか読み戻し検証
        const verify = await permSess.cookies.get({}).catch(() => [])
        const verifySessionId = verify.find(c => c.name === 'sessionid')
        const verifyCsrf      = verify.find(c => c.name === 'csrftoken')
        const verifyDsUser    = verify.find(c => c.name === 'ds_user_id')
        console.log(`[import-cookie-login] row[${i}] VERIFY: total=${verify.length} sessionid=${verifySessionId ? 'YES val=' + verifySessionId.value.slice(0, 20) + '... domain=' + verifySessionId.domain : 'NO'} csrftoken=${verifyCsrf ? 'YES' : 'NO'} ds_user_id=${verifyDsUser ? verifyDsUser.value : 'NO'}`)

        if (!verifySessionId?.value) {
          // injectCookies は true を返したが実際にはセットされていない
          console.error(`[import-cookie-login] row[${i}] ⚠ sessionid NOT persisted! Dumping rawCookies:`)
          for (const rc of rawCookies) {
            console.log(`  name=${rc.name} domain=${rc.domain} value=${rc.value?.slice(0, 20)}... secure=${rc.secure} httpOnly=${rc.httpOnly} expiry=${rc.expirationDate ?? rc.expires}`)
          }
        }

        updateAccountStatus(account.id, (hasSession && verifySessionId?.value) ? 'active' : 'needs_login')

        results.imported++
        console.log(`[import-cookie-login] row[${i}] SUCCESS imported=${results.imported}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[import-cookie-login] row[${i}] ERROR: ${msg}`)
        if (msg.includes('UNIQUE constraint')) {
          results.skipped++
          results.errors.push({ username, message: '既に追加済み' })
        } else {
          results.errors.push({ username, message: msg })
        }
      }
    }

    console.log(`[import-cookie-login] END imported=${results.imported} skipped=${results.skipped} errors=${results.errors.length}`)
    return results
  })

  /**
   * Instagram モバイル API でランダムな日本人女性名に変更する。
   * その垢の sessionid Cookie・iPhone UA・プロキシを適用。
   * 成功したら DB の display_name も更新する。
   */
  ipcMain.handle('accounts:auto-rename', async (_event, accountId: number) => {
    try {
      const acct = getAccountById(accountId)
      if (!acct) return { success: false, error: 'アカウントが見つかりません' }

      const result = await autoRenameJapaneseFemale(accountId)
      if (result.success && result.newName) {
        updateAccountDisplayName(accountId, result.newName)
      }
      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
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

  ipcMain.handle('accounts:check-ip', async (_event, data: {
    proxy_url: string | null
    proxy_username?: string
    proxy_password?: string
  }) => {
    const { net, session: electronSession } = await import('electron')
    const partitionKey = `temp:ip-check-${Date.now()}`
    const sess = electronSession.fromPartition(partitionKey)

    if (data.proxy_url) {
      let proxyUrl = data.proxy_url.trim()
      if (!/^https?:\/\/|^socks5?:\/\//i.test(proxyUrl)) proxyUrl = 'http://' + proxyUrl
      if (data.proxy_username && !proxyUrl.includes('@')) {
        const user = data.proxy_username
        const pass = data.proxy_password ?? ''
        proxyUrl = proxyUrl.replace(/^(https?:\/\/|socks5?:\/\/)/i, `$1${user}:${pass}@`)
      }
      await sess.setProxy({ proxyRules: proxyUrl }).catch(() => {})
    }

    return new Promise<{ ip: string | null; error?: string }>((resolve) => {
      const req = net.request({ method: 'GET', url: 'https://api.ipify.org', session: sess })
      const timer = setTimeout(() => req.abort(), 8000)
      let body = ''
      req.on('response', (resp) => {
        resp.on('data', c => { body += c.toString() })
        resp.on('end', () => { clearTimeout(timer); resolve({ ip: body.trim() }) })
      })
      req.on('error', (e) => { clearTimeout(timer); resolve({ ip: null, error: e.message }) })
      req.end()
    })
  })

  ipcMain.handle('accounts:has-access-token', async (_event, accountId: number) => {
    const sess = session.fromPartition(`persist:account-${accountId}`)
    const cookies = await sess.cookies.get({})
    const hasToken = cookies.some(c => c.name === 'sessionid' && c.domain?.includes('instagram.com'))
    return { hasToken }
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

  ipcMain.handle('accounts:proxy-url-counts', () => {
    const rows = getAllAccounts()
      .filter(a => a.proxy_url)
      .reduce<Record<string, number>>((acc, a) => {
        acc[a.proxy_url!] = (acc[a.proxy_url!] ?? 0) + 1
        return acc
      }, {})
    return rows
  })

  ipcMain.handle('accounts:proxy-port-stats', () => {
    const rows = getAllAccounts()
      .filter(a => a.proxy_url)
      .map(a => {
        try {
          const url = new URL(a.proxy_url!)
          return { host: url.hostname, port: parseInt(url.port, 10) }
        } catch {
          return null
        }
      })
      .filter((r): r is { host: string; port: number } => r !== null && !isNaN(r.port))

    // 設定されたポート範囲を取得
    const cfgStart = parseInt(getSetting('proxy_port_range_start') ?? '', 10)
    const cfgEnd   = parseInt(getSetting('proxy_port_range_end')   ?? '', 10)

    // ホストごとにポート→垢数のマップを構築
    const map = new Map<string, Map<number, number>>()
    for (const { host, port } of rows) {
      if (!map.has(host)) map.set(host, new Map())
      const portMap = map.get(host)!
      portMap.set(port, (portMap.get(port) ?? 0) + 1)
    }

    return Array.from(map.entries()).map(([host, portMap]) => {
      const portEntries = Array.from(portMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([port, count]) => ({ port, count }))

      const usedPortCount = portEntries.length
      // 設定範囲が有効ならそちらを使用、なければ既存ポートから自動算出
      const minPort = Number.isFinite(cfgStart) && cfgStart > 0 ? cfgStart : portEntries[0]?.port ?? 0
      const maxPort = Number.isFinite(cfgEnd)   && cfgEnd   > 0 ? cfgEnd   : portEntries[portEntries.length - 1]?.port ?? 0
      const totalInRange = maxPort >= minPort ? maxPort - minPort + 1 : 0
      const usedSet = new Set(portEntries.map(e => e.port))
      const unusedPorts: number[] = []
      for (let p = minPort; p <= maxPort; p++) {
        if (!usedSet.has(p)) unusedPorts.push(p)
      }

      return { host, portEntries, usedPortCount, minPort, maxPort, totalInRange, unusedPorts }
    })
  })

}
