import { ipcMain } from 'electron'
import { getAdminSupabase } from '../lib/supabase-admin'

export interface LicenseRow {
  key: string
  is_active: boolean
  expires_at: string | null
  memo: string | null
}

export function registerLicenseAdminHandlers(): void {

  // 一覧取得
  ipcMain.handle('license:list', async () => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }
    const { data, error } = await sb
      .from('licenses')
      .select('key, is_active, expires_at, memo')
      .order('key')
    if (error) return { success: false, error: error.message }
    return { success: true, data: data as LicenseRow[] }
  })

  // 新規追加
  ipcMain.handle('license:create', async (_e, row: LicenseRow) => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }
    const { error } = await sb.from('licenses').insert({
      key:        row.key.trim(),
      is_active:  row.is_active,
      expires_at: row.expires_at || null,
      memo:       row.memo?.trim() || null,
    })
    if (error) return { success: false, error: error.message }
    return { success: true }
  })

  // 有効/無効 or memo 更新
  ipcMain.handle('license:update', async (_e, data: Partial<LicenseRow> & { key: string }) => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }
    const { key, ...updates } = data
    const { error } = await sb.from('licenses').update(updates).eq('key', key)
    if (error) return { success: false, error: error.message }
    return { success: true }
  })

  // 削除
  ipcMain.handle('license:delete', async (_e, key: string) => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }
    const { error } = await sb.from('licenses').delete().eq('key', key)
    if (error) return { success: false, error: error.message }
    return { success: true }
  })
}
