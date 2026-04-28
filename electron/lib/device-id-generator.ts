/**
 * デバイスID生成（seed決定論的）
 *
 * dilame/instagram-private-api の generateDevice() を移植。
 * Chance ライブラリの代わりに crypto.createHash で決定論的に生成。
 * 同じ seed (username) からは常に同じ ID が返る。
 */

import crypto from 'crypto'

// ── seed からハッシュを生成 ──────────────────────────────────────────────────

function hashSeed(seed: string, salt: string): Buffer {
  return crypto.createHash('sha256').update(seed + salt).digest()
}

// ── UUID v4 形式を seed から決定論的に生成 ────────────────────────────────────

function seedUuid(seed: string, salt: string): string {
  const hash = hashSeed(seed, salt)
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const hex = hash.toString('hex').slice(0, 32)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),               // version 4
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20), // variant
    hex.slice(20, 32),
  ].join('-')
}

// ── 公開 API ─────────────────────────────────────────────────────────────────

/** android-<16hex> 形式のデバイスID */
export function generateDeviceId(seed: string): string {
  const hash = hashSeed(seed, 'device_id')
  return 'android-' + hash.toString('hex').slice(0, 16)
}

/** UUID v4（デバイスUUID / X-IG-Device-ID 用） */
export function generateDeviceUuid(seed: string): string {
  return seedUuid(seed, 'device_uuid')
}

/** UUID v4（phoneId / jazoest生成用） */
export function generatePhoneId(seed: string): string {
  return seedUuid(seed, 'phone_id')
}

/** UUID v4（Google広告ID） */
export function generateAdid(seed: string): string {
  return seedUuid(seed, 'adid')
}

/** jazoest 生成（dilame移植: "2" + phoneId の各バイト合計） */
export function generateJazoest(phoneId: string): string {
  let sum = 0
  for (let i = 0; i < phoneId.length; i++) {
    sum += phoneId.charCodeAt(i)
  }
  return `2${sum}`
}

/** Pigeon Session ID（20分ごとにローテーション） */
export function generatePigeonSessionId(accountId: number): string {
  const bucket = Math.floor(Date.now() / 1_200_000) // 20分バケット
  return seedUuid(`pigeon_${accountId}_${bucket}`, 'pigeon')
}

/** 全デバイスIDをまとめて生成 */
export interface DeviceIds {
  device_id:   string
  device_uuid: string
  phone_id:    string
  adid:        string
}

export function generateAllDeviceIds(seed: string): DeviceIds {
  return {
    device_id:   generateDeviceId(seed),
    device_uuid: generateDeviceUuid(seed),
    phone_id:    generatePhoneId(seed),
    adid:        generateAdid(seed),
  }
}
