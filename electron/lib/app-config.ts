/**
 * app_config キャッシュ（二段構え）
 *
 * 1. electron-store から即読み（同期）
 * 2. 並行して Supabase fetch → 成功したら electron-store 更新
 * 3. fetch 失敗時は electron-store 値で動作継続
 * 4. electron-store も空ならハードコードのフォールバック値
 */

import Store from 'electron-store'
import { supabase } from './supabase-auth'

// ── フォールバック値 ─────────────────────────────────────────────────────────

const FALLBACK_VALUES: Record<string, string> = {
  bloks_versioning_id: '86eaac606b7c5e9b45f4357f86082d05eace8411e43d3f754d885bf54a759a71',
  instagram_app_version: '355.0.0.24.108',
  ios_versions_pool: '["17_5","18_0","18_1","18_2","18_3","18_4","18_5"]',
  iphone_models_pool: '["iPhone16,2","iPhone16,1","iPhone15,3","iPhone15,2"]',
}

// ── electron-store（ローカルキャッシュ）────────────────────────────────────────

interface ConfigStore {
  [key: string]: string
}

let _store: Store<ConfigStore> | null = null
function getStore(): Store<ConfigStore> {
  if (!_store) _store = new Store<ConfigStore>({ name: 'app-config' })
  return _store
}

// ── メモリキャッシュ ──────────────────────────────────────────────────────────

const _memCache: Record<string, string> = {}

// ── 公開 API ─────────────────────────────────────────────────────────────────

/**
 * 同期的に値を返す（メモリ → electron-store → フォールバック）
 */
export function getConfigValue(key: string): string {
  // 1. メモリキャッシュ
  if (_memCache[key]) return _memCache[key]

  // 2. electron-store
  const stored = getStore().get(key)
  if (stored) {
    _memCache[key] = stored
    return stored
  }

  // 3. ハードコードフォールバック
  return FALLBACK_VALUES[key] ?? ''
}

/** bloks_versioning_id の取得ショートカット */
export function getBloksVersionId(): string {
  return getConfigValue('bloks_versioning_id')
}

/**
 * 起動時に呼ぶ（fire-and-forget）
 * electron-store から即ロード + Supabase fetch を並行実行
 */
export function initAppConfig(): void {
  // electron-store からメモリキャッシュにロード
  const store = getStore()
  for (const key of Object.keys(FALLBACK_VALUES)) {
    const v = store.get(key)
    if (v) _memCache[key] = v
  }
  console.log('[app-config] loaded from store:', JSON.stringify(_memCache))

  // Supabase fetch（fire-and-forget）
  fetchAndUpdateConfig().catch((e) => {
    console.warn('[app-config] background fetch failed:', e)
  })
}

/**
 * Supabase から全 app_config を取得してメモリ + electron-store を更新
 */
export async function fetchAndUpdateConfig(): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')

    if (error) {
      console.warn('[app-config] supabase fetch error:', error.message)
      return { success: false, error: error.message }
    }

    if (data && data.length > 0) {
      const store = getStore()
      for (const row of data as { key: string; value: string }[]) {
        _memCache[row.key] = row.value
        store.set(row.key, row.value)
      }
      console.log('[app-config] updated from supabase:', data.length, 'keys')
    }

    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[app-config] fetch exception:', msg)
    return { success: false, error: msg }
  }
}
