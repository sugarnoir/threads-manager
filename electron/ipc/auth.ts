import { ipcMain, app } from 'electron'
import { checkLicenseOnline, getStoredKey, setStoredKey, clearStoredKey } from '../lib/supabase-auth'

function isProd(): boolean {
  return app.isPackaged
}

const INVALID_REASON_MSG: Record<string, string> = {
  not_found:     '無効なライセンスキーです',
  inactive:      'このライセンスキーは無効化されています',
  expired:       'ライセンスキーの有効期限が切れています',
  network_error: '認証サーバーに接続できませんでした。インターネット接続を確認してください。',
}

export function registerAuthHandlers(): void {

  // ── 起動時の認証チェック ──────────────────────────────────────────────────────
  // dev 環境では認証スキップ。prod のみ認証必須。
  ipcMain.handle('auth:check', async () => {
    // if (!isProd()) return { required: false, authenticated: true } // dev 認証テスト用に一時コメントアウト

    const storedKey = getStoredKey()
    if (!storedKey) return { required: true, authenticated: false }

    const result = await checkLicenseOnline(storedKey)

    // ネットワークエラー時は保存済みキーがあれば通過（一時的な接続障害に対応）
    if (result.reason === 'network_error') {
      return { required: true, authenticated: true }
    }

    // 無効・失効したキーはキャッシュから削除して再入力を求める
    if (!result.valid) {
      clearStoredKey()
      return { required: true, authenticated: false }
    }

    return { required: true, authenticated: true }
  })

  // ── キー手動入力での認証 ──────────────────────────────────────────────────────
  ipcMain.handle('auth:verify', async (_event, key: string) => {
    process.stdout.write(`[auth:verify] called with key="${key}"\n`)

    const result = await checkLicenseOnline(key.trim())

    process.stdout.write(`[auth:verify] result=${JSON.stringify(result)}\n`)

    if (!result.valid) {
      return {
        ok: false,
        error: INVALID_REASON_MSG[result.reason ?? 'not_found'] ?? '認証に失敗しました',
      }
    }

    setStoredKey(key.trim())
    return { ok: true }
  })

  // ── ログアウト ────────────────────────────────────────────────────────────────
  ipcMain.handle('auth:logout', () => {
    clearStoredKey()
    return { ok: true }
  })
}
