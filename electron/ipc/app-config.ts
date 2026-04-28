import { ipcMain } from 'electron'
import { getAdminSupabase } from '../lib/supabase-admin'
import { fetchAndUpdateConfig, getConfigValue } from '../lib/app-config'

export interface AppConfigRow {
  key: string
  value: string
  updated_at: string
  updated_by: string | null
}

export function registerAppConfigHandlers(): void {

  // 一覧取得（admin用、service_role key 必要）
  ipcMain.handle('appConfig:list', async () => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }

    const { data, error } = await sb
      .from('app_config')
      .select('key, value, updated_at, updated_by')
      .order('key')

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as AppConfigRow[] }
  })

  // 更新（admin用、service_role key 必要）
  ipcMain.handle('appConfig:update', async (_e, payload: { key: string; value: string; updated_by?: string }) => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }

    const { error } = await sb
      .from('app_config')
      .upsert({
        key: payload.key,
        value: payload.value,
        updated_at: new Date().toISOString(),
        updated_by: payload.updated_by ?? null,
      }, { onConflict: 'key' })

    if (error) return { success: false, error: error.message }

    // ローカルキャッシュも即更新
    await fetchAndUpdateConfig()
    return { success: true }
  })

  // 手動リフレッシュ（anon key で fetch）
  ipcMain.handle('appConfig:refresh', async () => {
    return fetchAndUpdateConfig()
  })

  // 現在のキャッシュ値取得（同期的）
  ipcMain.handle('appConfig:get', (_e, key: string) => {
    return getConfigValue(key)
  })
}
