/**
 * UA 生成ロジック（app_config のパラメータからテンプレート生成）
 *
 * 全て同期的に呼び出し可能（getConfigValue はメモリ → electron-store → フォールバック）
 */

import { getConfigValue } from './app-config'

// ── ヘルパー ─────────────────────────────────────────────────────────────────

function getAppVersion(): string {
  return getConfigValue('instagram_app_version')
}

function getIosPool(): string[] {
  try {
    const arr = JSON.parse(getConfigValue('ios_versions_pool'))
    return Array.isArray(arr) && arr.length > 0 ? arr : ['18_4']
  } catch {
    return ['18_4']
  }
}

function getModelPool(): string[] {
  try {
    const arr = JSON.parse(getConfigValue('iphone_models_pool'))
    return Array.isArray(arr) && arr.length > 0 ? arr : ['iPhone16,2']
  } catch {
    return ['iPhone16,2']
  }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ios_versions_pool のアンダースコア表記をドット表記に変換 (18_4 → 18.4)
function iosUnderscoreToDot(ios: string): string {
  return ios.replace(/_/g, '.')
}

// ── 公開 API ─────────────────────────────────────────────────────────────────

/** 現在の instagram_app_version を返す（同期） */
export function getInstagramAppVersion(): string {
  return getAppVersion()
}

/**
 * Instagram 公式アプリ UA（BROWSER_UA 相当）
 * プール先頭の model / ios を使用（最新固定値）
 */
export function generateBrowserUA(): string {
  const version = getAppVersion()
  const model   = getModelPool()[0]
  const ios     = getIosPool()[0]
  return `Instagram ${version} (${model}; iOS ${ios}; ja_JP; ja; scale=3.00; 1320x2868; 620931905)`
}

/**
 * Barcelona 公式アプリ UA（IG_MOBILE_UA 相当）
 * プール先頭の model / ios を使用（最新固定値）
 */
export function generateMobileUA(): string {
  const version = getAppVersion()
  const model   = getModelPool()[0]
  const ios     = getIosPool()[0]
  return `Barcelona ${version} (${model}; iOS ${ios}; ja_JP; ja; scale=3.00; 1320x2868; 620931905)`
}

/**
 * アカウント固有の Safari Mobile UA を生成
 * model / ios をプールからランダム選択
 */
export function generateAccountUA(): string {
  const ios    = pickRandom(getIosPool())
  const iosDot = iosUnderscoreToDot(ios)
  return `Mozilla/5.0 (iPhone; CPU iPhone OS ${ios} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${iosDot} Mobile/15E148 Safari/604.1`
}
