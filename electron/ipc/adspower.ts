import { ipcMain } from 'electron'
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
  type AdsPowerProxyConfig,
} from '../services/adspower/client'
import { getSetting, setSetting } from '../db/repositories/settings'
import { getDb } from '../db'

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

  // ── プロファイル作成 ──
  ipcMain.handle('adspower:create-profile', async (_event, data: {
    accountId: number
    name: string
    browserCore: 'sun' | 'flower'
    groupId?: string
    cookie?: string
    proxyConfig?: AdsPowerProxyConfig
  }) => {
    try {
      const payload: AdsPowerCreateProfilePayload = {
        name: data.name,
        group_id: data.groupId || getSetting('adspower_default_group_id') || '0',
        domain_name: 'threads.com',
        fingerprint_config: {
          automatic_timezone: '1',
          language: ['ja-JP', 'ja'],
        },
        repeat_config: ['0'],
      }
      if (data.cookie) payload.cookie = data.cookie
      if (data.proxyConfig) payload.user_proxy_config = data.proxyConfig

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

  // ── プロファイル更新（Cookie / Proxy 同期） ──
  ipcMain.handle('adspower:update-profile', async (_event, data: {
    userId: string
    cookie?: string
    proxyConfig?: AdsPowerProxyConfig
  }) => {
    try {
      const payload: Partial<AdsPowerCreateProfilePayload> = {}
      if (data.cookie) payload.cookie = data.cookie
      if (data.proxyConfig) payload.user_proxy_config = data.proxyConfig

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

  // ── ブラウザ起動 ──
  ipcMain.handle('adspower:start-browser', async (_event, data: {
    accountId: number
    userId: string
  }) => {
    try {
      const session = await startBrowser(data.userId, {
        open_tabs: 1,
        ip_tab: 0,
      })

      getDb().prepare(
        "UPDATE accounts SET adspower_status = 'running' WHERE id = ?",
      ).run(data.accountId)

      return { success: true, session }
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
