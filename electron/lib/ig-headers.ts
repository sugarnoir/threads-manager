/**
 * Instagram/Threads API ヘッダー生成ヘルパー
 *
 * レガシー（パターン別）:
 *   パターンA: Instagram公式アプリ偽装（www.threads.com、Instagram UA）
 *   パターンB: iPhone Safari偽装（i.instagram.com、Safari UA）
 *   パターンC: デスクトップChrome偽装（www.threads.com、Chrome UA）
 *
 * 新方式（統一ヘッダー）:
 *   全リクエストで dilame 準拠 20 ヘッダーを送信
 */

import { generatePigeonSessionId } from './device-id-generator'
import { getBloksVersionId } from './app-config'
import { getAccountById, updateAccountDeviceIds } from '../db/repositories/accounts'
import { generateAllDeviceIds } from './device-id-generator'

// ── レガシー: パターン別ヘッダー ─────────────────────────────────────────────

export function getHeadersPatternA(accountId: number): Record<string, string> {
  return {
    'X-IG-App-Locale':       'ja_JP',
    'X-IG-Device-Locale':    'ja_JP',
    'X-Pigeon-Rawclienttime': (Date.now() / 1000).toFixed(3),
    'X-IG-Connection-Speed':  `${Math.floor(Math.random() * 2700) + 1000}kbps`,
  }
}

export function getHeadersPatternB(_accountId: number): Record<string, string> {
  return {
    'X-IG-App-Locale':       'ja_JP',
    'X-IG-Device-Locale':    'ja_JP',
    'X-Pigeon-Rawclienttime': (Date.now() / 1000).toFixed(3),
  }
}

export function getHeadersPatternC(_accountId: number): Record<string, string> {
  return {
    'X-IG-App-Locale':       'ja_JP',
    'X-IG-Device-Locale':    'ja_JP',
  }
}

// ── 新方式: 統一ヘッダー（dilame 準拠 20 ヘッダー）─────────────────────────

/**
 * 統一ヘッダーモード用ヘッダーセット。
 * device_id が NULL なら lazy 生成してから返す。
 */
export function getUnifiedHeaders(accountId: number): Record<string, string> {
  const acct = getAccountById(accountId)
  if (!acct) return {}

  // lazy 生成: device_id が NULL なら生成して DB 保存
  let deviceId   = acct.device_id
  let deviceUuid = acct.device_uuid
  let phoneId    = acct.phone_id
  if (!deviceId || !deviceUuid || !phoneId) {
    const ids = generateAllDeviceIds(acct.username)
    updateAccountDeviceIds(accountId, ids)
    deviceId   = ids.device_id
    deviceUuid = ids.device_uuid
    phoneId    = ids.phone_id
  }

  return {
    // ── 固定値（14個）──────────────────────────────────────────
    'X-CM-Bandwidth-KBPS':              '-1.000',
    'X-CM-Latency':                     '-1.000',
    'X-IG-Bandwidth-Speed-KBPS':        '-1.000',
    'X-IG-Bandwidth-TotalBytes-B':      '0',
    'X-IG-Bandwidth-TotalTime-MS':      '0',
    'X-IG-Capabilities':                '3brTv10=',
    'X-IG-Connection-Type':             'WIFI',
    'X-FB-HTTP-Engine':                 'Liger',
    'X-Ads-Opt-Out':                    '0',
    'X-Bloks-Is-Layout-RTL':            'false',
    'X-IG-App-Locale':                  'ja_JP',
    'X-IG-Device-Locale':               'ja_JP',
    'Accept-Language':                  'ja-JP',
    'X-IG-Extended-CDN-Thumbnail-Cache-Busting-Value': '1000',

    // ── 動的値（6個）──────────────────────────────────────────
    'X-IG-Android-ID':                  deviceId,
    'X-IG-Device-ID':                   deviceUuid,
    'X-Pigeon-Session-Id':              `UFS-${generatePigeonSessionId(accountId)}-0`,
    'X-Pigeon-Rawclienttime':           (Date.now() / 1000).toFixed(3),
    'X-IG-Connection-Speed':            `${Math.floor(Math.random() * 2700) + 1000}kbps`,
    'X-Bloks-Version-Id':              getBloksVersionId(),
  }
}
