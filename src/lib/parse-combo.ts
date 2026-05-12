/**
 * アカウントコンボのパーサー
 *
 * 対応フォーマット:
 * - cookie-pipe: username|password|token|[cookies JSON]|email
 * - simple-colon: username:password:totp_secret
 * - mobile-session: [user:pass:2fa]|[UA]|[DeviceIDs]|[Headers]|[ID]
 * - auto: 自動検出
 */

export type ComboFormat = 'npprteam' | 'accsmarket' | 'mobile-session' | 'cookie-string-pipe' | 'auto'

export interface AccountInput {
  username: string
  password: string
  token: string
  cookies: unknown[]
  email: string
  totpSecret: string
  // モバイルセッション情報 (mobile-session 形式)
  userAgent?: string
  deviceId?: string
  deviceUuid?: string
  phoneId?: string
  adid?: string
  mobileHeaders?: Record<string, string>
}

/**
 * コンボテキストをパースして AccountInput[] に正規化する。
 */
export function parseCombo(text: string, format: ComboFormat): AccountInput[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  return lines
    .map(line => {
      const fmt = format === 'auto' ? detectFormat(line) : format
      if (fmt === 'mobile-session') return parseMobileSession(line)
      if (fmt === 'cookie-string-pipe') return parseCookieStringPipe(line)
      if (fmt === 'npprteam') return parseCookiePipe(line)
      return parseSimpleColon(line)
    })
    .filter((r): r is AccountInput => r !== null)
}

/**
 * 行ごとに自動検出。
 * - 列2が "Instagram " で始まる → mobile-session
 * - [ が含まれる → cookie-pipe (npprteam)
 * - | が2つ以上 → mobile-session or cookie-pipe を列2で判定
 * - : が2つ以上 → simple-colon
 */
export function detectFormat(line: string): 'npprteam' | 'accsmarket' | 'mobile-session' | 'cookie-string-pipe' {
  // 末尾の空パイプを除去してから判定
  const rawParts = line.split('|')
  const pipeParts = rawParts.slice()
  while (pipeParts.length > 0 && (pipeParts[pipeParts.length - 1] ?? '').trim() === '') {
    pipeParts.pop()
  }

  // mobile-session: 列2が "Instagram " で始まる
  if (pipeParts.length >= 4 && (pipeParts[1] ?? '').trim().startsWith('Instagram ')) {
    return 'mobile-session'
  }
  // mobile-session: 最後の列に Authorization=Bearer or sessionid= + 列3がデバイスID風
  if (pipeParts.length >= 4) {
    const lastCol = pipeParts[pipeParts.length - 1] ?? ''
    if (lastCol.includes('Authorization=Bearer') || lastCol.includes('sessionid=')) {
      const col3 = (pipeParts[2] ?? '').trim()
      if (col3.startsWith('android-') || /^[0-9a-f]{8}-/.test(col3)) {
        return 'mobile-session'
      }
    }
  }

  // cookie-string-pipe: 4列パイプ、列4が key=value; 形式 (sessionid= を含む)
  if (pipeParts.length >= 4) {
    const col4 = (pipeParts[3] ?? '').trim()
    if (col4.includes('sessionid=') || col4.includes('csrftoken=')) {
      return 'cookie-string-pipe'
    }
  }

  // cookie-pipe (JSON配列): [ が含まれる
  if (line.includes('[')) return 'npprteam'

  const pipes = (line.match(/\|/g) || []).length
  const colons = (line.match(/:/g) || []).length
  if (pipes >= 2) return 'npprteam'
  if (colons >= 2) return 'accsmarket'
  if (pipes >= 1) return 'npprteam'
  return 'accsmarket'
}

/**
 * Cookie pipe フォーマット: username|password|token|[cookies JSON]|email
 */
function parseCookiePipe(line: string): AccountInput | null {
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
 * Simple colon フォーマット: username:password:totp_secret
 */
function parseSimpleColon(line: string): AccountInput | null {
  const parts = line.split(':').map(s => s.trim())

  if (parts.length >= 4) {
    return { username: parts[1], password: parts[2], token: '', cookies: [], email: parts[0], totpSecret: parts[3] }
  }
  if (parts.length === 3) {
    return { username: parts[0], password: parts[1], token: '', cookies: [], email: '', totpSecret: parts[2] }
  }
  if (parts.length === 2) {
    return { username: parts[0], password: parts[1], token: '', cookies: [], email: '', totpSecret: '' }
  }
  return null
}

/**
 * Mobile session フォーマット (trend-sns.com 等):
 * [user:pass:2fa]|[UA]|[device_id;uuid;phone_id;adid]|[headers]|[id]
 *
 * 列1: username:password:TOTP (コロン区切り、TOTP にスペース含む可能性)
 * 列2: Instagram モバイルアプリ UA
 * 列3: デバイスID群 (セミコロン区切り)
 * 列4: ヘッダー/Cookie (セミコロン区切り key=value)
 * 列5: 内部ID (無視)
 */
function parseMobileSession(line: string): AccountInput | null {
  const parts = line.split('|')
  if (parts.length < 4) return null

  // 列1: username:password:2FA
  const credParts = (parts[0] ?? '').split(':')
  const username = (credParts[0] ?? '').trim()
  const password = (credParts[1] ?? '').trim()
  // TOTP: 残りを結合（コロンが含まれない場合も対応）、スペース除去
  const totpRaw = credParts.slice(2).join(':').trim()
  const totpSecret = totpRaw.replace(/\s+/g, '')

  if (!username) return null

  // 列2: User-Agent
  const userAgent = (parts[1] ?? '').trim()

  // 列3: Device IDs (セミコロン区切り)
  const deviceParts = (parts[2] ?? '').split(';').map(s => s.trim())
  const deviceId = deviceParts[0] || undefined
  const deviceUuid = deviceParts[1] || undefined
  const phoneId = deviceParts[2] || undefined
  const adid = deviceParts[3] || undefined

  // 列4: Headers/Cookies (セミコロン区切り key=value)
  const headerStr = (parts[3] ?? '').trim()
  const mobileHeaders: Record<string, string> = {}
  if (headerStr) {
    for (const pair of headerStr.split(';')) {
      const eqIdx = pair.indexOf('=')
      if (eqIdx > 0) {
        const key = pair.slice(0, eqIdx).trim()
        const val = pair.slice(eqIdx + 1).trim()
        if (key && val) mobileHeaders[key] = val
      }
    }
  }

  return {
    username,
    password,
    token: '',
    cookies: [],
    email: '',
    totpSecret,
    userAgent: userAgent || undefined,
    deviceId,
    deviceUuid,
    phoneId,
    adid,
    mobileHeaders: Object.keys(mobileHeaders).length > 0 ? mobileHeaders : undefined,
  }
}

/**
 * Cookie string pipe フォーマット (Web版購入垢):
 * username|password|totp_secret|key=value;key=value;...
 *
 * Cookie 文字列を key=value で分割し、Cookie オブジェクト配列に変換。
 * 引用符付きの値 (rur="EAG ...") も対応。
 */
function parseCookieStringPipe(line: string): AccountInput | null {
  const parts = line.split('|')
  if (parts.length < 4) return null

  const username = (parts[0] ?? '').trim()
  const password = (parts[1] ?? '').trim()
  const totpSecret = (parts[2] ?? '').trim()
  const cookieStr = parts.slice(3).join('|').trim() // 列4以降を結合（値に | が含まれる可能性対応）

  if (!username) return null

  // Cookie 文字列をパース: key=value; で分割
  const cookies: Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean }> = []

  // セミコロンで分割（ただし引用符内のセミコロンは無視）
  for (const pair of splitCookieString(cookieStr)) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx <= 0) continue
    const name = pair.slice(0, eqIdx).trim()
    let value = pair.slice(eqIdx + 1).trim()
    // 引用符除去
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    if (!name || !value) continue
    cookies.push({
      name,
      value,
      domain: '.instagram.com',
      path: '/',
      secure: true,
      httpOnly: name === 'sessionid' || name === 'rur' || name === 'mid' || name === 'ig_did' || name === 'datr',
    })
  }

  return {
    username,
    password,
    token: '',
    cookies,
    email: '',
    totpSecret,
  }
}

/** Cookie 文字列をセミコロンで分割（引用符内は無視） */
function splitCookieString(str: string): string[] {
  const results: string[] = []
  let current = ''
  let inQuote = false
  for (const ch of str) {
    if (ch === '"') { inQuote = !inQuote; current += ch; continue }
    if (ch === ';' && !inQuote) {
      const trimmed = current.trim()
      if (trimmed) results.push(trimmed)
      current = ''
      continue
    }
    current += ch
  }
  const trimmed = current.trim()
  if (trimmed) results.push(trimmed)
  return results
}
