/**
 * APIレスポンスのエラー解析 — 検知 + ログ + DB保存 + IPC通知
 *
 * 現フェーズは通知のみ。status 変更や frozen_until は行わない。
 */

import { BrowserWindow } from 'electron'
import { insertAlert } from '../db/repositories/response-alerts'

const PATTERNS: [RegExp, string][] = [
  [/checkpoint_required|checkpoint_challenge/i, 'checkpoint_required'],
  [/feedback_required/i,                        'feedback_required'],
  [/sentry_block/i,                             'sentry_block'],
  [/login_required/i,                           'login_required'],
  [/rate.?limit|spam|too.?many/i,               'rate_limit'],
]

/**
 * レスポンス body を解析し、既知のエラーパターンにマッチするか検査する。
 * @returns マッチした errorType、なければ null
 */
export function analyzeResponse(body: string): string | null {
  if (!body) return null
  for (const [pattern, errorType] of PATTERNS) {
    if (pattern.test(body)) return errorType
  }
  return null
}

/**
 * レスポンスを解析し、検知時にログ出力 + DB保存 + UI通知。
 * @returns true if an alert was detected and logged
 */
export function analyzeAndLog(accountId: number, errorBody: string): boolean {
  const errorType = analyzeResponse(errorBody)
  if (!errorType) return false

  console.log(`[ResponseAnalyzer] account=${accountId} type=${errorType} body="${errorBody.slice(0, 200)}"`)

  try {
    const alert = insertAlert(accountId, errorType, errorBody)
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('response-alert', {
        id:          alert.id,
        account_id:  alert.account_id,
        error_type:  alert.error_type,
        detected_at: alert.detected_at,
      })
    }
  } catch (e) {
    console.error('[ResponseAnalyzer] DB/IPC error:', e)
  }

  return true
}
