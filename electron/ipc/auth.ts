import { ipcMain, app } from 'electron'
import {
  checkLicenseOnline,
  getStoredKey,
  setStoredKey,
  clearStoredKey,
  getMacAddress,
  getStoredMac,
} from '../lib/supabase-auth'

function isProd(): boolean {
  return app.isPackaged
}

const INVALID_REASON_MSG: Record<string, string> = {
  not_found:     '無効なライセンスキーです',
  inactive:      'このライセンスキーは無効化されています',
  expired:       'ライセンスキーの有効期限が切れています',
  network_error: '認証サーバーに接続できませんでした。インターネット接続を確認してください。',
  mac_mismatch:  'このライセンスキーは別のMacに紐付けられています。同じライセンスを複数台で使用することはできません。',
}

export function registerAuthHandlers(): void {

  // ── 起動時の認証チェック ──────────────────────────────────────────────────────
  ipcMain.handle('auth:check', async () => {
    const storedKey = getStoredKey()
    if (!storedKey) return { required: true, authenticated: false }

    const result = await checkLicenseOnline(storedKey)

    if (result.reason === 'network_error') {
      // ネットワークエラー時: キーがあってかつMACアドレスが一致すれば通過
      const storedMac  = getStoredMac()
      const currentMac = getMacAddress()
      if (storedMac && storedMac === currentMac) {
        console.log('[License] offline fallback: mac matches stored')
        return { required: true, authenticated: true }
      }
      // MACが未キャッシュ or 不一致ならオフラインでも拒否
      console.warn('[License] offline fallback: mac mismatch or no stored mac')
      clearStoredKey()
      return { required: true, authenticated: false }
    }

    // mac_mismatch は即座にキーを削除して再入力を要求
    if (result.reason === 'mac_mismatch') {
      clearStoredKey()
      return {
        required: true,
        authenticated: false,
        error: INVALID_REASON_MSG['mac_mismatch'],
      }
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
