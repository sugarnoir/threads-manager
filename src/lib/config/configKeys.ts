/** app_config テーブルの allowlist 定義 */

export interface ConfigKeyDef {
  label: string
  description: string
  validation: (v: string) => boolean
  placeholder: string
}

export const CONFIG_KEYS: Record<string, ConfigKeyDef> = {
  bloks_versioning_id: {
    label: 'Bloks Versioning ID',
    description: 'Threads APIのBloksログインで必要。Barcelona APKリリース毎に更新',
    validation: (v) => /^[a-f0-9]{64}$/.test(v),
    placeholder: '64文字のhex',
  },
  instagram_app_version: {
    label: 'Instagram App Version',
    description: 'Instagram/Barcelona公式アプリのバージョン番号。UA生成に使用',
    validation: (v) => /^\d+\.\d+\.\d+\.\d+\.\d+$/.test(v),
    placeholder: '355.0.0.24.108',
  },
  ios_versions_pool: {
    label: 'iOS Versions Pool',
    description: 'UA生成時のiOSバージョンプール（JSON配列）',
    validation: (v) => { try { const a = JSON.parse(v); return Array.isArray(a) && a.length > 0 && a.every((s: unknown) => typeof s === 'string'); } catch { return false; } },
    placeholder: '["18_3","18_4","18_5"]',
  },
  iphone_models_pool: {
    label: 'iPhone Models Pool',
    description: 'UA生成時のiPhoneモデルプール（JSON配列）',
    validation: (v) => { try { const a = JSON.parse(v); return Array.isArray(a) && a.length > 0 && a.every((s: unknown) => typeof s === 'string'); } catch { return false; } },
    placeholder: '["iPhone16,2","iPhone16,1"]',
  },
} as const

export type ConfigKey = keyof typeof CONFIG_KEYS
