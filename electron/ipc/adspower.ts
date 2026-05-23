import { ipcMain, BrowserWindow, session } from 'electron'
import {
  checkStatus,
  createProfile,
  updateProfile,
  deleteProfile,
  listProfiles,
  startBrowser,
  stopBrowser,
  getActiveBrowsers,
  createGroup,
  listGroups,
  type AdsPowerCreateProfilePayload,
} from '../services/adspower/client'
import { convertTMCookieToAdsPower } from '../services/adspower/cookie-converter'
import { convertTMProxyToAdsPower } from '../services/adspower/proxy-converter'
import { getSetting, setSetting } from '../db/repositories/settings'
import { getAccountById } from '../db/repositories/accounts'
import { getDb } from '../db'

// ── ステータス監視 ───────────────────────────────────────────────────────────

let statusMonitorInterval: ReturnType<typeof setInterval> | null = null

export function startAdsPowerStatusMonitor(mainWindow: BrowserWindow): void {
  stopAdsPowerStatusMonitor()

  statusMonitorInterval = setInterval(async () => {
    if (getSetting('adspower_enabled') !== 'true') return

    try {
      const activeBrowsers = await getActiveBrowsers()
      const activeUserIds = new Set(activeBrowsers.map(b => b.user_id))

      // adspower_user_id を持つ全垢を取得
      const rows = getDb()
        .prepare("SELECT id, adspower_user_id, adspower_status FROM accounts WHERE adspower_user_id IS NOT NULL")
        .all() as Array<{ id: number; adspower_user_id: string; adspower_status: string }>

      let changed = false
      for (const row of rows) {
        const isRunning = activeUserIds.has(row.adspower_user_id)
        const newStatus = isRunning ? 'running' : 'created'
        if (row.adspower_status !== newStatus) {
          getDb().prepare("UPDATE accounts SET adspower_status = ? WHERE id = ?").run(newStatus, row.id)
          changed = true
        }
      }

      if (changed && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('adspower:status-changed')
      }
    } catch {
      // AdsPower 未起動時などはスキップ
    }
  }, 5000)
}

export function stopAdsPowerStatusMonitor(): void {
  if (statusMonitorInterval) {
    clearInterval(statusMonitorInterval)
    statusMonitorInterval = null
  }
}

// ── Cookie 取得ヘルパー ─────────────────────────────────────────────────────

async function getAccountCookieJson(accountId: number): Promise<string> {
  // まず Electron セッションから最新 Cookie を取得
  try {
    const sess = session.fromPartition(`persist:account-${accountId}`)
    const cookies = await sess.cookies.get({})
    if (cookies.length > 0) {
      const normalized = cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
        sameSite: c.sameSite,
      }))
      return JSON.stringify(normalized)
    }
  } catch { /* fallthrough */ }

  // Electron セッションに Cookie がなければ DB バックアップから
  return getSetting(`session_cookies_${accountId}`) || '[]'
}

// ── fingerprint 設定ビルダー ────────────────────────────────────────────────

function buildFingerprintConfig(browserCore: 'sun' | 'flower'): Record<string, unknown> {
  const config: Record<string, unknown> = {
    automatic_timezone: '1',
    language: ['en-US', 'en'],
    webrtc: 'proxy',
    canvas: '1',           // noise
    webgl_image: '1',      // noise
    audio: '1',            // noise
    hardware_concurrency: '8',
    device_memory: '8',
  }

  if (browserCore === 'sun') {
    config.browser_kernel_config = { version: '146', type: 'chrome' }
    config.random_ua = { ua_browser: ['chrome'], ua_system_version: ['Mac OS X 10.15'] }
  } else {
    config.browser_kernel_config = { version: 'ua_auto', type: 'flower' }
  }

  return config
}

// ── IPC ハンドラー ──────────────────────────────────────────────────────────

export function registerAdsPowerHandlers(): void {
  // ── 接続テスト ──
  ipcMain.handle('adspower:check-status', async () => {
    try {
      const result = await checkStatus()
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── 設定取得 ──
  ipcMain.handle('adspower:get-settings', () => {
    return {
      api_url: getSetting('adspower_api_url') || 'http://localhost:50325',
      enabled: getSetting('adspower_enabled') === 'true',
      default_browser_core: getSetting('adspower_default_browser_core') || 'sun',
      default_group_id: getSetting('adspower_default_group_id') || '',
    }
  })

  // ── 設定保存 ──
  ipcMain.handle('adspower:save-settings', (_event, data: {
    api_url: string
    enabled: boolean
    default_browser_core: string
    default_group_id: string
  }) => {
    setSetting('adspower_api_url', data.api_url)
    setSetting('adspower_enabled', String(data.enabled))
    setSetting('adspower_default_browser_core', data.default_browser_core)
    setSetting('adspower_default_group_id', data.default_group_id)
    return { success: true }
  })

  // ── プロファイル作成（垢情報から自動で Cookie/プロキシ同期） ──
  ipcMain.handle('adspower:create-profile', async (_event, data: {
    accountId: number
    name: string
    browserCore: 'sun' | 'flower'
    groupId?: string
  }) => {
    try {
      const account = getAccountById(data.accountId)
      if (!account) throw new Error(`Account ${data.accountId} not found`)

      // Cookie 取得 & 変換
      const cookieJson = await getAccountCookieJson(data.accountId)
      const adsCookie = convertTMCookieToAdsPower(cookieJson)

      // プロキシ変換
      const proxyConfig = convertTMProxyToAdsPower(
        account.proxy_url,
        account.proxy_username,
        account.proxy_password,
      )

      // AdsPower プロファイル作成
      const payload: AdsPowerCreateProfilePayload = {
        name: data.name || account.username,
        group_id: data.groupId || getSetting('adspower_default_group_id') || '0',
        domain_name: 'threads.com',
        username: account.username,
        password: account.ig_password || '',
        cookie: adsCookie,
        user_proxy_config: proxyConfig,
        fingerprint_config: buildFingerprintConfig(data.browserCore),
        repeat_config: ['0'],
      }

      const userId = await createProfile(payload)

      // DB 更新
      getDb().prepare(
        'UPDATE accounts SET adspower_user_id = ?, adspower_status = ?, adspower_browser_core = ? WHERE id = ?',
      ).run(userId, 'created', data.browserCore, data.accountId)

      return { success: true, userId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── プロファイル Cookie/プロキシ再同期 ──
  ipcMain.handle('adspower:sync-profile', async (_event, data: { accountId: number }) => {
    try {
      const account = getAccountById(data.accountId)
      if (!account) throw new Error(`Account ${data.accountId} not found`)
      if (!account.adspower_user_id) throw new Error('AdsPower profile not created')

      getDb().prepare("UPDATE accounts SET adspower_status = 'syncing' WHERE id = ?").run(data.accountId)

      const cookieJson = await getAccountCookieJson(data.accountId)
      const adsCookie = convertTMCookieToAdsPower(cookieJson)
      const proxyConfig = convertTMProxyToAdsPower(
        account.proxy_url,
        account.proxy_username,
        account.proxy_password,
      )

      await updateProfile(account.adspower_user_id, {
        cookie: adsCookie,
        user_proxy_config: proxyConfig,
      })

      getDb().prepare("UPDATE accounts SET adspower_status = 'created' WHERE id = ?").run(data.accountId)

      return { success: true }
    } catch (err) {
      getDb().prepare("UPDATE accounts SET adspower_status = 'error' WHERE id = ?").run(data.accountId)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── プロファイル更新（手動指定） ──
  ipcMain.handle('adspower:update-profile', async (_event, data: {
    userId: string
    cookie?: string
    proxyConfig?: unknown
  }) => {
    try {
      const payload: Partial<AdsPowerCreateProfilePayload> = {}
      if (data.cookie) payload.cookie = data.cookie
      if (data.proxyConfig) payload.user_proxy_config = data.proxyConfig as AdsPowerCreateProfilePayload['user_proxy_config']

      await updateProfile(data.userId, payload)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── プロファイル削除 ──
  ipcMain.handle('adspower:delete-profile', async (_event, data: {
    accountId: number
    userId: string
  }) => {
    try {
      await deleteProfile([data.userId])
      getDb().prepare(
        "UPDATE accounts SET adspower_user_id = NULL, adspower_status = 'not_created', adspower_browser_core = NULL WHERE id = ?",
      ).run(data.accountId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── ブラウザ起動（プロファイルなければ自動作成） ──
  ipcMain.handle('adspower:start-browser', async (_event, data: {
    accountId: number
    userId?: string
    browserCore?: 'sun' | 'flower'
  }) => {
    try {
      let userId = data.userId
      const account = getAccountById(data.accountId)
      if (!account) throw new Error(`Account ${data.accountId} not found`)

      // プロファイルがなければ自動作成
      if (!userId && !account.adspower_user_id) {
        const browserCore = data.browserCore || (getSetting('adspower_default_browser_core') as 'sun' | 'flower') || 'sun'
        const cookieJson = await getAccountCookieJson(data.accountId)
        const adsCookie = convertTMCookieToAdsPower(cookieJson)
        const proxyConfig = convertTMProxyToAdsPower(
          account.proxy_url,
          account.proxy_username,
          account.proxy_password,
        )

        const payload: AdsPowerCreateProfilePayload = {
          name: account.username,
          group_id: getSetting('adspower_default_group_id') || '0',
          domain_name: 'threads.com',
          username: account.username,
          password: account.ig_password || '',
          cookie: adsCookie,
          user_proxy_config: proxyConfig,
          fingerprint_config: buildFingerprintConfig(browserCore),
          repeat_config: ['0'],
        }

        userId = await createProfile(payload)
        getDb().prepare(
          'UPDATE accounts SET adspower_user_id = ?, adspower_status = ?, adspower_browser_core = ? WHERE id = ?',
        ).run(userId, 'created', browserCore, data.accountId)
      } else {
        userId = userId || account.adspower_user_id!
      }

      // ブラウザ起動
      const browserSession = await startBrowser(userId, {
        open_tabs: 1,
        ip_tab: 0,
      })

      getDb().prepare(
        "UPDATE accounts SET adspower_status = 'running' WHERE id = ?",
      ).run(data.accountId)

      return { success: true, session: browserSession }
    } catch (err) {
      getDb().prepare(
        "UPDATE accounts SET adspower_status = 'error' WHERE id = ?",
      ).run(data.accountId)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── ブラウザ停止 ──
  ipcMain.handle('adspower:stop-browser', async (_event, data: {
    accountId: number
    userId: string
  }) => {
    try {
      await stopBrowser(data.userId)
      getDb().prepare(
        "UPDATE accounts SET adspower_status = 'created' WHERE id = ?",
      ).run(data.accountId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── アクティブブラウザ一覧 ──
  ipcMain.handle('adspower:active-browsers', async () => {
    try {
      const list = await getActiveBrowsers()
      return { success: true, list }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), list: [] }
    }
  })

  // ── プロファイル一覧 ──
  ipcMain.handle('adspower:list-profiles', async (_event, groupId?: string) => {
    try {
      const result = await listProfiles(groupId)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), list: [] }
    }
  })

  // ── グループ一覧 ──
  ipcMain.handle('adspower:list-groups', async () => {
    try {
      const list = await listGroups()
      return { success: true, list }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), list: [] }
    }
  })

  // ── グループ作成 ──
  ipcMain.handle('adspower:create-group', async (_event, name: string) => {
    try {
      const groupId = await createGroup(name)
      return { success: true, groupId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
