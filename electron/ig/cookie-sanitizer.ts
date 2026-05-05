/**
 * 買った cookie に混ざる壊れた値を除去 + 標準化。
 *
 * 既知の問題パターン:
 * - value が "&quo" (HTML エスケープの切れ端)
 * - value が空文字
 * - name が空
 * - domain に "." プレフィックスがない
 * - secure / sameSite が未設定
 */

interface CookieLike {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: string
  expirationDate?: number
}

export interface SanitizedCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: string
  expirationDate: number
}

export interface SanitizeResult {
  sanitized: SanitizedCookie[]
  removed: { name: string; reason: string }[]
}

const INVALID_VALUES = new Set(['&quo', '&quot', '', 'undefined', 'null'])

export function sanitizeCookies(raw: CookieLike[]): SanitizeResult {
  const removed: SanitizeResult['removed'] = []
  const sanitized: SanitizedCookie[] = []

  for (const c of raw) {
    if (!c.value || INVALID_VALUES.has(c.value)) {
      removed.push({ name: c.name, reason: 'invalid_value' })
      continue
    }
    if (!c.name || c.name.length === 0) {
      removed.push({ name: c.name || '<empty>', reason: 'invalid_name' })
      continue
    }

    const domain = c.domain || '.instagram.com'
    sanitized.push({
      name: c.name,
      value: c.value,
      domain: domain.startsWith('.') ? domain : `.${domain}`,
      path: c.path || '/',
      secure: true,
      httpOnly: c.httpOnly ?? false,
      sameSite: 'no_restriction',
      expirationDate: c.expirationDate ?? Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
    })
  }

  // 必須 cookie 不足の警告
  const required = ['sessionid', 'csrftoken', 'ds_user_id']
  const present = new Set(sanitized.map(c => c.name))
  const missing = required.filter(r => !present.has(r))
  if (missing.length > 0) {
    removed.push({
      name: missing.join(','),
      reason: 'missing_required_after_sanitize',
    })
  }

  return { sanitized, removed }
}

export function isCookieSetUsable(cookies: { name: string }[]): boolean {
  const present = new Set(cookies.map(c => c.name))
  return ['sessionid', 'csrftoken', 'ds_user_id'].every(r => present.has(r))
}
