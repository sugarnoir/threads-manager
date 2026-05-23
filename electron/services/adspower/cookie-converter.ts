/**
 * TM Cookie → AdsPower 形式変換
 *
 * TM の Cookie は app_settings テーブルに session_cookies_{accountId} として
 * JSON 配列文字列で保存されている。
 * 形式: [{ name, value, domain, path, secure, httpOnly, expirationDate, sameSite }, ...]
 */

export function convertTMCookieToAdsPower(tmCookieJson: string | null): string {
  if (!tmCookieJson) return '[]'
  try {
    const cookies = JSON.parse(tmCookieJson)
    if (!Array.isArray(cookies) || cookies.length === 0) return '[]'

    return JSON.stringify(
      cookies.map((c: Record<string, unknown>) => ({
        domain: c.domain ?? '',
        name: c.name ?? '',
        value: c.value ?? '',
        path: (c.path as string) || '/',
        expirationDate: c.expirationDate ?? c.expires ?? undefined,
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? false,
        sameSite: normalizeSameSite(c.sameSite as string | undefined),
      })),
    )
  } catch {
    return '[]'
  }
}

function normalizeSameSite(v: string | undefined): string {
  if (!v) return 'Lax'
  const lower = v.toLowerCase()
  if (lower === 'no_restriction' || lower === 'none') return 'None'
  if (lower === 'strict') return 'Strict'
  return 'Lax'
}
