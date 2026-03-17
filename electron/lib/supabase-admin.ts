import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSetting } from '../db/repositories/settings'

const SUPABASE_URL = 'https://pywvrkghavvwdqvefqbh.supabase.co'

/** service_role キーで Supabase クライアントを生成（RLS バイパス） */
export function getAdminSupabase(): SupabaseClient | null {
  const key = getSetting('supabase_service_key')?.trim()
  if (!key) return null
  return createClient(SUPABASE_URL, key)
}
