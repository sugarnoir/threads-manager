import { getSetting } from '../db/repositories/settings'

export interface SupabaseConfig {
  url: string
  serviceKey: string
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = getSetting('supabase_url')?.trim()
  const serviceKey = getSetting('supabase_service_key')?.trim()
  if (!url || !serviceKey) return null
  return { url, serviceKey }
}

export async function sbFetch<T>(
  config: SupabaseConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${config.url}/rest/v1/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.serviceKey}`,
        'apikey': config.serviceKey,
        'Prefer': 'return=representation',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const text = await res.text()
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`
      try { errMsg = (JSON.parse(text) as { message?: string }).message ?? errMsg } catch { /* */ }
      return { data: null, error: errMsg }
    }
    const data = text ? JSON.parse(text) as T : null
    return { data, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}
