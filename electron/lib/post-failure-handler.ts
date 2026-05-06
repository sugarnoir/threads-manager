/**
 * 投稿失敗時の自動停止ロジック
 *
 * 連続失敗カウント + エラータイプに基づいて自動停止を判断。
 */

import { incrementFailures, resetFailures, pauseAccount } from '../db/repositories/accounts'
import { sendDiscordNotification } from '../discord'

const CONSECUTIVE_FAILURE_THRESHOLD = 3  // 3回連続失敗で一時停止
const TEMP_PAUSE_HOURS = 6               // 一時停止: 6時間

// 永久停止にすべきエラーパターン
const PERMANENT_PAUSE_PATTERNS = [
  'login_required',
  'consent_required',
  'user_has_logged_out',
]

// 即時停止 (一時) にすべきエラーパターン
const IMMEDIATE_PAUSE_PATTERNS = [
  'checkpoint_required',
  'feedback_required',
  'sentry_block',
]

/**
 * 投稿結果を処理する。失敗時は連続カウントを更新し、必要に応じて自動停止。
 * @returns true: 停止した / false: 停止しなかった
 */
export function handlePostResult(
  accountId: number,
  username: string,
  success: boolean,
  error?: string,
): boolean {
  if (success) {
    resetFailures(accountId)
    return false
  }

  const errorLower = (error ?? '').toLowerCase()

  // 永久停止パターン
  for (const pattern of PERMANENT_PAUSE_PATTERNS) {
    if (errorLower.includes(pattern)) {
      pauseAccount(accountId, '永続', `投稿エラー: ${pattern}`)
      console.log(`[post-failure] account=${accountId} (${username}): 永久停止 (${pattern})`)
      sendDiscordNotification({
        event: 'account_error',
        username,
        message: `自動停止（永久）: ${pattern}`,
      }).catch(() => {})
      return true
    }
  }

  // 即時一時停止パターン
  for (const pattern of IMMEDIATE_PAUSE_PATTERNS) {
    if (errorLower.includes(pattern)) {
      const until = new Date(Date.now() + TEMP_PAUSE_HOURS * 3600_000).toISOString()
      pauseAccount(accountId, until, `投稿エラー: ${pattern}`)
      console.log(`[post-failure] account=${accountId} (${username}): ${TEMP_PAUSE_HOURS}h停止 (${pattern})`)
      return true
    }
  }

  // 連続失敗カウント
  const count = incrementFailures(accountId)
  if (count >= CONSECUTIVE_FAILURE_THRESHOLD) {
    const until = new Date(Date.now() + TEMP_PAUSE_HOURS * 3600_000).toISOString()
    pauseAccount(accountId, until, `連続${count}回失敗`)
    console.log(`[post-failure] account=${accountId} (${username}): ${TEMP_PAUSE_HOURS}h停止 (連続${count}回失敗)`)
    return true
  }

  return false
}
