/**
 * Threads API 経路設定
 *
 * Mobile (Path 0): i.instagram.com + Threads Android App ID
 * Web (Path 1/2/3): threads.com + Web App ID
 *
 * use_threads_mobile_api フラグが有効な垢のみ Mobile 経路で
 * Threads Android App ID + Barcelona UA を使用する。
 */

// ── Mobile API (Path 0) ─────────────────────────────────────────────────────

/** Threads Android (Barcelona) アプリの App ID */
export const THREADS_MOBILE_APP_ID = '3419628305025917'

/** 従来の Web 用 App ID (フォールバック / Web Path 用) */
export const THREADS_WEB_APP_ID = '238260118697367'

/** Mobile API ホスト */
export const MOBILE_API_HOST = 'https://i.instagram.com'

// ── Barcelona UA ─────────────────────────────────────────────────────────────

/**
 * Barcelona (Threads Android) UA を生成
 * フォーマット: Barcelona {version} Android ({android_version}/{release}; {dpi}; {resolution}; {manufacturer}; {model}; {device}; {cpu}; {locale}; {version_code})
 */
export function generateBarcelonaUA(appVersion?: string): string {
  const version = appVersion ?? '355.0.0.24.108'
  // Pixel 8 Pro (最新リファレンスデバイス)
  return `Barcelona ${version} Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 620931905)`
}

/**
 * Barcelona (Threads iOS) UA を生成
 * iOS デバイスプロファイルの垢向け
 */
export function generateBarcelonaIOSUA(appVersion?: string): string {
  const version = appVersion ?? '355.0.0.24.108'
  return `Barcelona ${version} (iPhone16,2; iOS 18.4; ja_JP; ja; scale=3.00; 1320x2868; 620931905)`
}
