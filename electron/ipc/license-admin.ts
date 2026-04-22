import { ipcMain } from 'electron'
import { getAdminSupabase } from '../lib/supabase-admin'

export interface LicenseRow {
  key:           string
  is_active:     boolean
  expires_at:    string | null
  memo:          string | null
  mac_address:   string | null
  device_free:   boolean
  max_accounts:  number | null
  app_version:   string | null
}

export function registerLicenseAdminHandlers(): void {

  // 一覧取得
  ipcMain.handle('license:list', async () => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }

    // カラム未追加時のフォールバック
    let resData: Record<string, unknown>[] | null = null
    let resError: { message: string } | null = null
    {
      const r1 = await sb
        .from('licenses')
        .select('key, is_active, expires_at, memo, mac_address, device_free, max_accounts, app_version')
        .order('key')
      console.log(`[license:list] r1 error=${r1.error?.message ?? 'none'} data_count=${r1.data?.length ?? 'null'}`)
      if (r1.error?.message?.includes('device_free') || r1.error?.message?.includes('max_accounts') || r1.error?.message?.includes('app_version')) {
        console.log(`[license:list] fallback: column missing, retrying without optional columns`)
        const r2 = await sb
          .from('licenses')
          .select('key, is_active, expires_at, memo, mac_address')
          .order('key')
        resData  = r2.data as Record<string, unknown>[] | null
        resError = r2.error
      } else {
        resData  = r1.data as Record<string, unknown>[] | null
        resError = r1.error
      }
    }
    if (resError) return { success: false, error: resError.message }
    const rows = (resData ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      device_free:  r.device_free === true,
      max_accounts: typeof r.max_accounts === 'number' ? r.max_accounts : null,
      app_version:  typeof r.app_version === 'string' ? r.app_version : null,
    })) as LicenseRow[]
    if (rows.length > 0) console.log(`[license:list] first row app_version=${rows[0].app_version} raw=${JSON.stringify((resData ?? [])[0]?.app_version)}`)
    return { success: true, data: rows }
  })

  // 新規追加
  ipcMain.handle('license:create', async (_e, row: LicenseRow) => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }
    const insertData: Record<string, unknown> = {
      key:          row.key.trim(),
      is_active:    row.is_active,
      expires_at:   row.expires_at || null,
      memo:         row.memo?.trim() || null,
      device_free:  row.device_free ?? false,
      max_accounts: row.max_accounts ?? null,
    }
    let { error } = await sb.from('licenses').insert(insertData)
    if (error?.message?.includes('device_free') || error?.message?.includes('max_accounts')) {
      delete insertData.device_free
      delete insertData.max_accounts
      const res2 = await sb.from('licenses').insert(insertData)
      error = res2.error
    }
    if (error) return { success: false, error: error.message }
    return { success: true }
  })

  // 有効/無効 or memo or device_free 更新
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

  // MACアドレスリセット（別Macへの移行時に管理者が実行）
  ipcMain.handle('license:reset-mac', async (_e, key: string) => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }
    const { error } = await sb.from('licenses').update({ mac_address: null }).eq('key', key)
    if (error) return { success: false, error: error.message }
    return { success: true }
  })
}
