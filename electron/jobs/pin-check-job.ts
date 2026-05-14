/**
 * ピン留めチェック定期ジョブ
 *
 * 1日1回、各アクティブ垢のピン留め投稿を確認する。
 * 垢IDのハッシュで実行時刻を分散し、同時実行を防ぐ。
 */

import { getDb } from '../db'
import { getAllAccounts, updatePinnedPostStatus, type Account } from '../db/repositories/accounts'
import { detectPinnedPost, checkPostAlive } from '../ipc/pinned-check'
import { sendDiscordNotification } from '../discord'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5分ごとにポーリング
const MIN_INTERVAL_BETWEEN_CHECKS_MS = 5 * 60 * 1000  // 最小5分間隔
const CHECK_INTERVAL_HOURS = 24  // 24時間に1回

let timer: ReturnType<typeof setInterval> | null = null

export function startPinCheckJob(): void {
  if (timer) return
  console.log('[pin-check-job] started')
  // 起動後1分で初回チェック
  setTimeout(() => void runOnce(), 60_000)
  timer = setInterval(() => void runOnce(), POLL_INTERVAL_MS)
}

export function stopPinCheckJob(): void {
  if (timer) { clearInterval(timer); timer = null }
}

/**
 * 垢IDからその垢の「1日の中での実行時刻 (分)」を決定する。
 * 0〜1439 (0:00〜23:59) に分散。
 */
function getScheduledMinute(accountId: number): number {
  // 簡易ハッシュ: accountId を素数で混ぜて 0-1439 に写像
  let h = accountId * 2654435761 // Knuth multiplicative hash
  h = (h >>> 0) % 1440
  return h
}

/**
 * ジッター付きの実行時刻判定。±15分のランダム幅。
 */
function isDueNow(account: Account): boolean {
  // pin_check_enabled チェック (デフォルト0=無効、明示的に1にした垢のみ対象)
  if ((account as any).pin_check_enabled !== 1) return false

  // 最終チェックから24時間経過していなければスキップ
  if (account.pinned_checked_at) {
    const lastCheck = new Date(account.pinned_checked_at).getTime()
    if (Date.now() - lastCheck < CHECK_INTERVAL_HOURS * 3600_000) return false
  }

  // 実行時刻の判定（現在時刻がスケジュール時刻の±15分以内か）
  const now = new Date()
  const currentMinute = now.getHours() * 60 + now.getMinutes()
  const scheduledMinute = getScheduledMinute(account.id)
  const diff = Math.abs(currentMinute - scheduledMinute)
  const wrappedDiff = Math.min(diff, 1440 - diff)
  return wrappedDiff <= 15
}

async function runOnce(): Promise<void> {
  const accounts = getAllAccounts().filter(a => a.status === 'active')
  const due = accounts.filter(isDueNow)

  if (due.length === 0) return

  console.log(`[pin-check-job] ${due.length} accounts due for pin check`)

  let deletedCount = 0

  for (const acct of due) {
    try {
      console.log(`[pin-check-job] checking @${acct.username} (id=${acct.id})`)

      let pinnedUrl: string | null = acct.pinned_post_url ?? null
      let status: 'alive' | 'deleted' | 'unknown' | null = null
      let isPinned = false
      let errorMsg: string | null = null

      // プロフィールからピン投稿を検出
      if (!pinnedUrl) {
        pinnedUrl = await detectPinnedPost(acct.id, acct.username)
      }

      if (pinnedUrl) {
        isPinned = true
        status = await checkPostAlive(acct.id, pinnedUrl)
        if (status === 'deleted') deletedCount++
      }

      // DB更新
      updatePinnedPostStatus(acct.id, pinnedUrl, status)

      // 履歴記録
      insertCheckHistory(acct.id, isPinned, pinnedUrl, status, null)

      console.log(`[pin-check-job] @${acct.username}: pinned=${isPinned} status=${status ?? 'no_pin'}`)

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`[pin-check-job] @${acct.username} error: ${errorMsg}`)
      insertCheckHistory(acct.id, false, null, null, errorMsg)

      // プロキシエラーなら30分後リトライ（pinned_checked_at を更新しない）
      if (errorMsg.includes('proxy') || errorMsg.includes('PROXY') || errorMsg.includes('timeout')) {
        console.log(`[pin-check-job] @${acct.username}: proxy/timeout error, will retry in 30min`)
      }
    }

    // 最小5分間隔保証
    await new Promise(r => setTimeout(r, MIN_INTERVAL_BETWEEN_CHECKS_MS))
  }

  // 削除検知があれば Discord 通知
  if (deletedCount > 0) {
    sendDiscordNotification({
      event: 'account_error',
      username: 'system',
      message: `ピン投稿削除検知: ${deletedCount}垢のピン留め投稿が削除されています`,
    }).catch(() => {})
  }
}

function insertCheckHistory(
  accountId: number,
  isPinned: boolean,
  pinPostUrl: string | null,
  status: string | null,
  errorMessage: string | null,
): void {
  try {
    getDb().prepare(
      'INSERT INTO pin_check_history (account_id, is_pinned, pin_post_url, status, error_message) VALUES (?, ?, ?, ?, ?)'
    ).run(accountId, isPinned ? 1 : 0, pinPostUrl, status, errorMessage)
  } catch { /* ignore */ }
}
