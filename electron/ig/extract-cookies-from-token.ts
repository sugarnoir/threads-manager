/**
 * Authorization Bearer Token から Cookie (sessionid, ds_user_id) を抽出する。
 *
 * Token 形式: "Bearer IGT:2:{Base64}"
 * Base64 デコード結果: { "ds_user_id": "...", "sessionid": "..." }
 */

export interface ExtractedCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: string
}

/**
 * Authorization Bearer Token から sessionid と ds_user_id を抽出して Cookie 配列として返す。
 * パース失敗時は null。
 */
export function extractCookiesFromMobileAuth(authorization: string): ExtractedCookie[] | null {
  try {
    // "Bearer IGT:2:eyJ..." → Base64 部分を取得
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

    console.log(`[extractCookies] extracted ds_user_id=${dsUserId} sessionid=${sessionid.slice(0, 20)}...`)

    const cookies: ExtractedCookie[] = [
      {
        name: 'sessionid',
        value: sessionid,
        domain: '.instagram.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'no_restriction',
      },
      {
        name: 'ds_user_id',
        value: dsUserId,
        domain: '.instagram.com',
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'no_restriction',
      },
    ]

    return cookies
  } catch (err) {
    console.error(`[extractCookies] parse error: ${err instanceof Error ? err.message : err}`)
    return null
  }
}
