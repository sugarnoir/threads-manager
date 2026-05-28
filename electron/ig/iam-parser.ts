/**
 * IAM-API (dark.shopping) 形式のパーサー
 *
 * 入力形式:
 *   username:password||android_id;phone_id;uuid;client_session_id|X-MID=xxx;sessionid=xxx;IG-U-DS-USER-ID=xxx;Authorization=Bearer IGT:2:xxx
 *
 * login() は絶対呼ばない。set_settings のみで復元。
 */

/** device_settings と整合する Android UA (pickRandomIphoneUA を使わない) */
export const IAM_ANDROID_UA = 'Instagram 309.0.0.40.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-A528B; a52sxq; qcom; en_US; 541635890)'

export interface IamParsed {
  username: string
  password: string
  androidId: string
  phoneId: string
  uuid: string
  clientSessionId: string
  mid: string
  sessionid: string
  dsUserId: string
  authorization: string
}

export function parseIamLine(line: string): IamParsed | null {
  try {
    const parts = line.split('|')
    if (parts.length < 4) return null

    const [userPass, , deviceStr, headerStr] = parts
    if (!userPass || !deviceStr || !headerStr) return null

    const colonIdx = userPass.indexOf(':')
    if (colonIdx < 0) return null
    const username = userPass.slice(0, colonIdx)
    const password = userPass.slice(colonIdx + 1)

    const deviceIds = deviceStr.split(';')
    if (deviceIds.length < 4) return null

    const headers: Record<string, string> = {}
    for (const kv of headerStr.split(';')) {
      const eqIdx = kv.indexOf('=')
      if (eqIdx > 0) {
        headers[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1)
      }
    }

    const sessionid = headers['sessionid'] ?? ''
    const dsUserId = headers['IG-U-DS-USER-ID'] ?? ''
    if (!sessionid || !dsUserId) return null

    return {
      username,
      password,
      androidId: deviceIds[0],
      phoneId: deviceIds[1],
      uuid: deviceIds[2],
      clientSessionId: deviceIds[3],
      mid: headers['X-MID'] ?? '',
      sessionid,
      dsUserId,
      authorization: headers['Authorization'] ?? '',
    }
  } catch {
    return null
  }
}

/**
 * パース結果から instagrapi 互換の session JSON を生成
 */
export function toSessionJson(parsed: IamParsed): string {
  const session = {
    uuids: {
      phone_id: parsed.phoneId,
      uuid: parsed.uuid,
      client_session_id: parsed.clientSessionId,
      advertising_id: parsed.uuid,
      android_device_id: parsed.androidId,
      request_id: parsed.clientSessionId,
      tray_session_id: parsed.clientSessionId,
    },
    mid: parsed.mid,
    ig_u_rur: null,
    ig_www_claim: null,
    authorization_data: {
      ds_user_id: parsed.dsUserId,
      sessionid: parsed.sessionid,
      should_use_header_over_cookies: true,
    },
    cookies: {},
    last_login: Date.now() / 1000,
    device_settings: {
      app_version: '309.0.0.40.113',
      android_version: 33,
      android_release: '13',
      dpi: '420dpi',
      resolution: '1080x2400',
      manufacturer: 'samsung',
      device: 'a52sxq',
      model: 'SM-A528B',
      cpu: 'qcom',
      version_code: '541635890',
    },
    user_agent: 'Instagram 309.0.0.40.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-A528B/TP1A.220624.014; en_US; 541635890)',
  }
  return JSON.stringify(session)
}

/**
 * デバイスID JSON を生成（変更厳禁、参照用）
 */
export function toDeviceIdsJson(parsed: IamParsed): string {
  return JSON.stringify({
    android_id: parsed.androidId,
    phone_id: parsed.phoneId,
    uuid: parsed.uuid,
    client_session_id: parsed.clientSessionId,
  })
}
