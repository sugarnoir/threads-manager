import { ipcMain } from 'electron'
import { checkMasterKeyOnline } from '../lib/supabase-auth'
import { getAdminSupabase } from '../lib/supabase-admin'

// セッション内認証状態（アプリを閉じるまで保持、ディスクには保存しない）
let _authenticated = false

const INVALID_REASON_MSG: Record<string, string> = {
  not_found:     '無効なマスターキーです',
  inactive:      'このマスターキーは無効化されています',
  expired:       'マスターキーの有効期限が切れています',
  network_error: '認証サーバーに接続できませんでした。インターネット接続を確認してください。',
}

export function registerMasterKeyHandlers(): void {

  // 認証状態確認（セッション内）
  ipcMain.handle('master-key:check', () => {
    return { authenticated: _authenticated }
  })

  // キー認証
  ipcMain.handle('master-key:verify', async (_e, key: string) => {
    const result = await checkMasterKeyOnline(key.trim())

    // ネットワークエラー時は通過させない（ライセンスと異なりより厳格に）
    if (!result.valid) {
      return {
        ok: false,
        error: INVALID_REASON_MSG[result.reason ?? 'not_found'] ?? '認証に失敗しました',
      }
    }
    _authenticated = true
    return { ok: true }
  })

  // 管理: 一覧取得
  ipcMain.handle('master-key:list', async () => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }
    const { data, error } = await sb
      .from('master_keys')
      .select('key, is_active, expires_at, memo')
      .order('key')
    if (error) return { success: false, error: error.message }
    return { success: true, data }
  })

  // 管理: 新規追加
  ipcMain.handle('master-key:create', async (_e, row: {
    key: string; is_active: boolean; expires_at: string | null; memo: string | null
  }) => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }
    const { error } = await sb.from('master_keys').insert({
      key:        row.key.trim(),
      is_active:  row.is_active,
      expires_at: row.expires_at || null,
      memo:       row.memo?.trim() || null,
    })
    if (error) return { success: false, error: error.message }
    return { success: true }
  })

  // 管理: 更新（有効/無効、有効期限、メモ）
  ipcMain.handle('master-key:update', async (_e, data: {
    key: string; is_active?: boolean; expires_at?: string | null; memo?: string | null
  }) => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }
    const { key, ...updates } = data
    const { error } = await sb.from('master_keys').update(updates).eq('key', key)
    if (error) return { success: false, error: error.message }
    return { success: true }
  })

  // 管理: 削除
  ipcMain.handle('master-key:delete', async (_e, key: string) => {
    const sb = getAdminSupabase()
    if (!sb) return { success: false, error: 'Service Role Key が未設定です' }
    const { error } = await sb.from('master_keys').delete().eq('key', key)
    if (error) return { success: false, error: error.message }
    return { success: true }
  })
}
