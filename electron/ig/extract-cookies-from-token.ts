/**
 * Authorization Bearer Token から Cookie (sessionid, ds_user_id 等) を抽出する。
 *
 * Token 形式: "Bearer IGT:2:{Base64}"
 * Base64 デコード結果: { "ds_user_id": "...", "sessionid": "..." }
 */

import crypto from 'crypto'

export interface ExtractedCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: string
}

function generateCsrfToken(): string {
  return crypto.randomBytes(16).toString('hex') // 32文字の英数字
}

function generateIgDid(): string {
  return crypto.randomUUID().toUpperCase()
}

/**
 * Authorization Bearer Token + モバイルヘッダーから IG Cookie セットを生成する。
 *
 * 生成される Cookie:
 * - sessionid (Token から抽出)
 * - ds_user_id (Token から抽出)
 * - csrftoken (ランダム生成)
 * - ig_did (ランダム生成)
 * - mid (ヘッダーから、あれば)
 * - rur (ヘッダーから、あれば)
 */
export function extractCookiesFromMobileAuth(
  authorization: string,
  headers?: Record<string, string>,
): ExtractedCookie[] | null {
  try {
    const match = authorization.match(/Bearer\s+IGT:\d+:(.+)/)
    if (!match) {
      console.log('[extractCookies] Authorization does not match Bearer IGT pattern')
      return null
    }

    const base64 = match[1]
    const json = Buffer.from(base64, 'base64').toString('utf8')
    const data = JSON.parse(json) as Record<string, string>

    const sessionid = data.sessionid
    const dsUserId = data.ds_user_id

    if (!sessionid || !dsUserId) {
      console.log(`[extractCookies] missing fields: sessionid=${!!sessionid} ds_user_id=${!!dsUserId}`)
      return null
    }

    const csrftoken = generateCsrfToken()
    console.log(`[extractCookies] extracted ds_user_id=${dsUserId} sessionid=${sessionid.slice(0, 20)}... csrftoken=${csrftoken.slice(0, 8)}...`)

    const base = { domain: '.instagram.com', path: '/', secure: true, sameSite: 'no_restriction' }

    const cookies: ExtractedCookie[] = [
      { ...base, name: 'sessionid',  value: sessionid, httpOnly: true },
      { ...base, name: 'ds_user_id', value: dsUserId,  httpOnly: false },
      { ...base, name: 'csrftoken',  value: csrftoken,  httpOnly: false },
      { ...base, name: 'ig_did',     value: generateIgDid(), httpOnly: true },
    ]

    // mid (X-MID ヘッダーから)
    const mid = headers?.['X-MID']
    if (mid) {
      cookies.push({ ...base, name: 'mid', value: mid, httpOnly: true })
    }

    // rur (IG-U-RUR ヘッダーから)
    const rur = headers?.['IG-U-RUR']
    if (rur) {
      cookies.push({ ...base, name: 'rur', value: rur, httpOnly: true })
    }

    return cookies
  } catch (err) {
    console.error(`[extractCookies] parse error: ${err instanceof Error ? err.message : err}`)
    return null
  }
}
