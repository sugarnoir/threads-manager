/**
 * アカウントコンボのパーサー
 *
 * 対応フォーマット:
 * - npprteam: username|password|token|[cookies JSON]|email (pipe区切り、cookie あり)
 * - accsmarket: username:password:totp_secret (colon区切り、cookie なし)
 * - auto: 区切り文字とフィールド数から自動検出
 */

export type ComboFormat = 'npprteam' | 'accsmarket' | 'auto'

export interface AccountInput {
  username: string
  password: string
  token: string
  cookies: unknown[]
  email: string
  totpSecret: string
}

/**
 * コンボテキストをパースして AccountInput[] に正規化する。
 */
export function parseCombo(text: string, format: ComboFormat): AccountInput[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const effectiveFormat = format === 'auto' ? detectFormat(lines[0]) : format

  return lines
    .map(line => effectiveFormat === 'npprteam' ? parseNpprteam(line) : parseAccsmarket(line))
    .filter((r): r is AccountInput => r !== null)
}

/**
 * 最初の行から自動検出。
 * - [ が含まれる or | が2つ以上 → npprteam
 * - : が2つ以上 → accsmarket
 * - | が含まれる → npprteam
 * - fallback → accsmarket
 */
export function detectFormat(line: string): 'npprteam' | 'accsmarket' {
  if (line.includes('[')) return 'npprteam'
  const pipes = (line.match(/\|/g) || []).length
  const colons = (line.match(/:/g) || []).length
  if (pipes >= 2) return 'npprteam'
  if (colons >= 2) return 'accsmarket'
  if (pipes >= 1) return 'npprteam'
  return 'accsmarket'
}

/**
 * npprteam フォーマット: username|password|token|[cookies JSON]|email
 */
function parseNpprteam(line: string): AccountInput | null {
  const bracketStart = line.indexOf('[')
  const bracketEnd = line.lastIndexOf(']')

  let username = '', password = '', token = '', email = ''
  let cookies: unknown[] = []

  if (bracketStart !== -1 && bracketEnd !== -1 && bracketEnd > bracketStart) {
    const before = line.slice(0, bracketStart).replace(/\|$/, '')
    const cookieStr = line.slice(bracketStart, bracketEnd + 1)
    const after = line.slice(bracketEnd + 1).replace(/^\|/, '')

    const beforeParts = before.split('|')
    username = (beforeParts[0] ?? '').trim()
    password = (beforeParts[1] ?? '').trim()
    token = (beforeParts[2] ?? '').trim()
    email = after.split('|').filter(Boolean).pop()?.trim() ?? ''

    try { cookies = JSON.parse(cookieStr) } catch { cookies = [] }
  } else {
    const parts = line.split('|')
    username = (parts[0] ?? '').trim()
    password = (parts[1] ?? '').trim()
    token = (parts[2] ?? '').trim()
    email = (parts[4] ?? '').trim()
  }

  if (!username) return null
  return { username, password, token, cookies, email, totpSecret: '' }
}

/**
 * AccsMarket フォーマット: username:password:totp_secret
 * バリエーション:
 * - username:password:totp
 * - username:password
 * - email:username:password:totp
 */
function parseAccsmarket(line: string): AccountInput | null {
  const parts = line.split(':').map(s => s.trim())

  if (parts.length >= 4) {
    // email:username:password:totp
    return {
      username: parts[1],
      password: parts[2],
      token: '',
      cookies: [],
      email: parts[0],
      totpSecret: parts[3],
    }
  }
  if (parts.length === 3) {
    // username:password:totp
    return {
      username: parts[0],
      password: parts[1],
      token: '',
      cookies: [],
      email: '',
      totpSecret: parts[2],
    }
  }
  if (parts.length === 2) {
    // username:password
    return {
      username: parts[0],
      password: parts[1],
      token: '',
      cookies: [],
      email: '',
      totpSecret: '',
    }
  }

  return null
}
