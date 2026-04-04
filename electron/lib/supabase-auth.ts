import { createClient } from '@supabase/supabase-js'
import Store from 'electron-store'
import os from 'os'

const SUPABASE_URL = 'https://pywvrkghavvwdqvefqbh.supabase.co'
const SUPABASE_KEY  = 'sb_publishable_EPQxxmN_PJzcpbjk43DB4Q_oSzXF1T4'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── MACアドレス取得 ─────────────────────────────────────────────────────────────

export function getMacAddress(): string {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    const entries = ifaces[name]
    if (!entries) continue
    for (const entry of entries) {
      if (!entry.internal && entry.mac && entry.mac !== '00:00:00:00:00:00') {
        return entry.mac.toLowerCase()
      }
    }
  }
  return 'unknown'
}

// ── electron-store（ローカルキャッシュ）────────────────────────────────────────

interface AuthStore {
  license_key?: string
  bound_mac?:   string  // 認証済みMACアドレス（オフライン検証用）
}

// lazy init: app.getPath('userData') が ready 後に確定するため
let _store: Store<AuthStore> | null = null
function getStore(): Store<AuthStore> {
  if (!_store) _store = new Store<AuthStore>({ name: 'auth' })
  return _store
}

export function getStoredKey(): string | undefined {
  return getStore().get('license_key')
}

export function setStoredKey(key: string): void {
  getStore().set('license_key', key)
}

export function clearStoredKey(): void {
  getStore().delete('license_key')
  getStore().delete('bound_mac')
}

export function getStoredMac(): string | undefined {
  return getStore().get('bound_mac')
}

export function setStoredMac(mac: string): void {
  getStore().set('bound_mac', mac)
}

// ── Supabase オンライン検証 ────────────────────────────────────────────────────

export type InvalidReason = 'not_found' | 'inactive' | 'expired' | 'network_error' | 'mac_mismatch'

export interface LicenseCheckResult {
  valid: boolean
  reason?: InvalidReason
}

interface LicenseRow {
  key:         string
  is_active:   boolean
  expires_at:  string | null
  mac_address: string | null
}

export async function checkMasterKeyOnline(key: string): Promise<LicenseCheckResult> {
  try {
    const { data, error } = await supabase
      .from('master_keys')
      .select('key, is_active, expires_at')
      .eq('key', key)
      .maybeSingle()
    if (error) return { valid: false, reason: 'network_error' }
    if (!data)  return { valid: false, reason: 'not_found' }
    const row = data as LicenseRow
    if (!row.is_active) return { valid: false, reason: 'inactive' }
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      return { valid: false, reason: 'expired' }
    }
    return { valid: true }
  } catch {
    return { valid: false, reason: 'network_error' }
  }
}

export async function checkLicenseOnline(key: string): Promise<LicenseCheckResult> {
  const currentMac = getMacAddress()

  try {
    console.log('[License] checking key:', key, 'mac:', currentMac)
    const { data, error } = await supabase
      .from('licenses')
      .select('key, is_active, expires_at, mac_address')
      .eq('key', key)
      .maybeSingle()

    console.log('[License] data:', JSON.stringify(data))
    console.log('[License] error:', JSON.stringify(error))

    if (error) return { valid: false, reason: 'network_error' }
    if (!data)  return { valid: false, reason: 'not_found' }

    const row = data as LicenseRow
    if (!row.is_active) return { valid: false, reason: 'inactive' }
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      return { valid: false, reason: 'expired' }
    }

    // ── MACアドレス紐付けチェック ───────────────────────────────────────────────
    if (!row.mac_address) {
      // 初回認証: 現在のMACアドレスをSupabaseに紐付ける
      console.log('[License] first activation → binding mac:', currentMac)
      const { error: updateError } = await supabase
        .from('licenses')
        .update({ mac_address: currentMac })
        .eq('key', key)
        .is('mac_address', null)  // 他のリクエストが先に書いた場合の競合防止

      if (updateError) {
        console.warn('[License] mac binding update error:', updateError.message)
        // 更新エラーでも通過させ（楽観的）、次回のチェックで弾く
      }
    } else if (row.mac_address !== currentMac) {
      // 別のMacからのアクセス → 拒否
      console.warn('[License] mac mismatch: expected', row.mac_address, 'got', currentMac)
      return { valid: false, reason: 'mac_mismatch' }
    }

    // 認証成功 → MACアドレスをローカルにもキャッシュ
    setStoredMac(currentMac)
    return { valid: true }
  } catch (e) {
    console.log('[License] exception:', e)
    return { valid: false, reason: 'network_error' }
  }
}
