import { createClient } from '@supabase/supabase-js'
import Store from 'electron-store'

const SUPABASE_URL = 'https://pywvrkghavvwdqvefqbh.supabase.co'
const SUPABASE_KEY  = 'sb_publishable_EPQxxmN_PJzcpbjk43DB4Q_oSzXF1T4'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── electron-store（ローカルキャッシュ）────────────────────────────────────────

interface AuthStore {
  license_key?: string
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
}

// ── Supabase オンライン検証 ────────────────────────────────────────────────────

export type InvalidReason = 'not_found' | 'inactive' | 'expired' | 'network_error'

export interface LicenseCheckResult {
  valid: boolean
  reason?: InvalidReason
}

interface LicenseRow {
  key: string
  is_active: boolean
  expires_at: string | null
}

export async function checkLicenseOnline(key: string): Promise<LicenseCheckResult> {
  try {
    console.log('[License] checking key:', key)
    const { data, error } = await supabase
      .from('licenses')
      .select('key, is_active, expires_at')
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
    return { valid: true }
  } catch (e) {
    console.log('[License] exception:', e)
    return { valid: false, reason: 'network_error' }
  }
}
