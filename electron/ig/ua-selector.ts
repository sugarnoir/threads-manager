/**
 * Cookie の組成から最適な User-Agent を判定する。
 *
 * Cookieの特徴:
 * - authorization_data あり → モバイルアプリ由来
 * - datr + csrftoken 20-22文字 → iOS Safari 由来
 * - datr + csrftoken 30-34文字 → デスクトップ Chrome 由来
 * - いずれにも当てはまらない → fallback (iOS Safari)
 */

export type UAType = 'mobile_app' | 'ios_safari' | 'desktop_chrome' | 'fallback'

export const UA_STRINGS: Record<UAType, string> = {
  mobile_app:
    'Instagram 309.0.0.40.113 Android (33/13; 420dpi; 1080x2154; samsung; SM-A536U; a53x; Chrome/131.0.0.0 Safari/537.36',
  ios_safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  desktop_chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  fallback:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
}

interface CookieLike {
  name: string
  value: string
}

export function selectUAType(cookies: CookieLike[]): UAType {
  const cookieMap = new Map(cookies.map(c => [c.name, c.value]))

  if (cookieMap.has('authorization_data')) return 'mobile_app'

  const csrf = cookieMap.get('csrftoken') || ''
  const hasDatr = cookieMap.has('datr')

  if (hasDatr && csrf.length >= 20 && csrf.length <= 22) return 'ios_safari'
  if (hasDatr && csrf.length >= 30 && csrf.length <= 34) return 'desktop_chrome'

  return 'fallback'
}

export function selectUA(cookies: CookieLike[]): { type: UAType; ua: string } {
  const type = selectUAType(cookies)
  return { type, ua: UA_STRINGS[type] }
}
