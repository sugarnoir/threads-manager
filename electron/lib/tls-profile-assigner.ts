/**
 * TLS プロファイル割当ロジック
 *
 * 垢の UA カテゴリ + ID mod で決定論的にプロファイルを割り当てる。
 * 同じ垢は常に同じプロファイルを返す (idempotent)。
 */

/** 利用可能な tls-client プロファイル */
export const TLS_PROFILES = [
  'safari_ios_16_0',
  'safari_ios_15_5',
  'chrome_android_13',
  'okhttp4_android_13',
  'chrome_120',
  'chrome_117',
  'safari_16_0',
] as const

export type TlsProfile = typeof TLS_PROFILES[number]

/**
 * 垢の UA とID から TLS プロファイルを決定
 */
export function assignTlsProfile(accountId: number, userAgent: string | null): TlsProfile {
  const lower = (userAgent ?? '').toLowerCase()
  const mod = accountId % 100

  // iPhone / iOS
  if (lower.includes('iphone') || lower.includes('ios')) {
    return mod < 70 ? 'safari_ios_16_0' : 'safari_ios_15_5'
  }

  // Android
  if (lower.includes('android')) {
    return mod < 60 ? 'chrome_android_13' : 'okhttp4_android_13'
  }

  // Mac
  if (lower.includes('macintosh') || lower.includes('mac os')) {
    if (mod < 50) return 'chrome_120'
    if (mod < 80) return 'safari_16_0'
    return 'chrome_117'
  }

  // Windows
  if (lower.includes('windows')) {
    return mod < 70 ? 'chrome_120' : 'chrome_117'
  }

  // デフォルト
  return 'chrome_120'
}
