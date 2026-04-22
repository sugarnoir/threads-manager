import { createClient } from '@supabase/supabase-js'
import Store from 'electron-store'
import os from 'os'
import { app } from 'electron'
import { setSetting, getSetting } from '../db/repositories/settings'

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
  maxAccounts?: number | null  // null = 無制限
}

interface LicenseRow {
  key:           string
  is_active:     boolean
  expires_at:    string | null
  mac_address:   string | null
  device_free:   boolean | null
  max_accounts:  number | null
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
    // device_free カラムが存在しない場合に備えて、取得失敗時は device_free なしで再取得
    let data: Record<string, unknown> | null = null
    let error: { message: string } | null = null
    {
      const res = await supabase
        .from('licenses')
        .select('key, is_active, expires_at, mac_address, device_free, max_accounts')
        .eq('key', key)
        .maybeSingle()
      if (res.error?.message?.includes('device_free') || res.error?.message?.includes('max_accounts')) {
        // カラム未追加 → 最低限のカラムで再取得
        console.warn('[License] column not found, falling back')
        const res2 = await supabase
          .from('licenses')
          .select('key, is_active, expires_at, mac_address')
          .eq('key', key)
          .maybeSingle()
        data = res2.data as Record<string, unknown> | null
        error = res2.error
      } else {
        data = res.data as Record<string, unknown> | null
        error = res.error
      }
    }

    console.log('[License] data:', JSON.stringify(data))
    console.log('[License] error:', JSON.stringify(error))

    if (error) return { valid: false, reason: 'network_error' }
    if (!data)  return { valid: false, reason: 'not_found' }

    const d = data as Record<string, unknown>
    const row: LicenseRow = {
      key:           String(d.key ?? ''),
      is_active:     Boolean(d.is_active),
      expires_at:    (d.expires_at as string | null) ?? null,
      mac_address:   (d.mac_address as string | null) ?? null,
      device_free:   Boolean(d.device_free),
      max_accounts:  typeof d.max_accounts === 'number' ? d.max_accounts : null,
    }
    if (!row.is_active) return { valid: false, reason: 'inactive' }
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      return { valid: false, reason: 'expired' }
    }

    // ── MACアドレス紐付けチェック ───────────────────────────────────────────────
    // device_free=true の場合は MAC チェックを完全スキップ
    if (row.device_free) {
      console.log('[License] device_free=true → skip MAC check')
    } else if (!row.mac_address) {
      // 初回認証: 現在のMACアドレスをSupabaseに紐付ける
      console.log('[License] first activation → binding mac:', currentMac)
      const { error: updateError } = await supabase
        .from('licenses')
        .update({ mac_address: currentMac })
        .eq('key', key)
        .is('mac_address', null)  // 他のリクエストが先に書いた場合の競合防止

      if (updateError) {
        console.warn('[License] mac binding update error:', updateError.message)
      }
    } else if (row.mac_address !== currentMac) {
      // 別のMacからのアクセス → 拒否
      console.warn('[License] mac mismatch: expected', row.mac_address, 'got', currentMac)
      return { valid: false, reason: 'mac_mismatch' }
    }

    // 認証成功 → app_version を Supabase に保存（service_role key で RLS バイパス）
    try {
      const appVersion = app.getVersion()
      const serviceKey = getSetting('supabase_service_key')?.trim()
      if (serviceKey) {
        const adminClient = createClient(SUPABASE_URL, serviceKey)
        const { error: verErr } = await adminClient
          .from('licenses')
          .update({ app_version: appVersion })
          .eq('key', key)
        if (verErr) {
          console.warn(`[License] app_version update error: ${verErr.message}`)
        } else {
          console.log(`[License] app_version saved: ${appVersion} (via service_role)`)
        }
      } else {
        // service_role がない場合は anon key でフォールバック
        const { error: verErr } = await supabase
          .from('licenses')
          .update({ app_version: appVersion })
          .eq('key', key)
        console.log(`[License] app_version update via anon: error=${verErr?.message ?? 'none'}`)
      }
    } catch (e) {
      console.warn(`[License] app_version update exception: ${e}`)
    }

    // MACアドレスをローカルにもキャッシュ + maxAccounts をローカル保存
    setStoredMac(currentMac)
    console.log(`[License] max_accounts from Supabase: ${JSON.stringify(row.max_accounts)} (type=${typeof row.max_accounts})`)
    if (row.max_accounts !== null && row.max_accounts !== undefined) {
      console.log(`[License] saving license_max_accounts=${row.max_accounts}`)
      try {
        setSetting('license_max_accounts', String(row.max_accounts))
      } catch (e) {
        console.error(`[License] setSetting failed:`, e)
      }
    } else {
      console.log('[License] max_accounts is null/undefined → saving empty (unlimited)')
      try {
        setSetting('license_max_accounts', '')
      } catch (e) {
        console.error(`[License] setSetting failed:`, e)
      }
    }
    return { valid: true, maxAccounts: row.max_accounts }
  } catch (e) {
    console.log('[License] exception:', e)
    return { valid: false, reason: 'network_error' }
  }
}
