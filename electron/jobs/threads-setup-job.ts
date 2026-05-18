/**
 * Threads 自動セットアップジョブ
 *
 * Cookieインポートで追加された新規垢 (threads_setup_status='pending') を
 * バックグラウンドで1垢ずつ順次処理する。
 *
 * - 5分間隔でポーリング
 * - 同時1垢のみ
 * - リトライ最大3回
 * - 失敗時 Discord 通知
 */

import { getDb } from '../db'
import { setupThreadsAccount, type SetupResult } from '../services/threads-setup'
import { sendDiscordNotification } from '../discord'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5分
const MAX_ATTEMPTS = 3

let timer: ReturnType<typeof setInterval> | null = null
let running = false

export function startThreadsSetupJob(): void {
  if (timer) return
  console.log('[threads-setup-job] started')
  setTimeout(() => void runOnce(), 2 * 60 * 1000)  // 起動後2分で初回
  timer = setInterval(() => void runOnce(), POLL_INTERVAL_MS)
}

export function stopThreadsSetupJob(): void {
  if (timer) { clearInterval(timer); timer = null }
}

async function runOnce(): Promise<void> {
  if (running) return
  running = true

  try {
    const db = getDb()

    // 直近5分で処理した垢があればスキップ（ペース制限）
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const recent = db.prepare(`
      SELECT id FROM accounts
      WHERE threads_setup_at > ?
        AND threads_setup_status IN ('in_progress', 'completed', 'failed', 'skipped')
    `).all(cutoff) as any[]

    if (recent.length > 0) return

    // 'pending' な垢を1つ取得
    const account = db.prepare(`
      SELECT * FROM accounts
      WHERE threads_setup_status = 'pending'
        AND status = 'active'
        AND threads_setup_attempts < ?
      ORDER BY id ASC
      LIMIT 1
    `).get(MAX_ATTEMPTS) as any | undefined

    if (!account) return

    console.log(`[threads-setup-job] processing @${account.username} (id=${account.id}, attempt=${(account.threads_setup_attempts || 0) + 1})`)

    // in_progress に更新
    db.prepare(`
      UPDATE accounts SET
        threads_setup_status = 'in_progress',
        threads_setup_at = datetime('now')
      WHERE id = ?
    `).run(account.id)

    const result: SetupResult = await setupThreadsAccount(account.id)

    if (result.status === 'completed' || result.status === 'skipped') {
      db.prepare(`
        UPDATE accounts SET
          threads_setup_status = ?,
          threads_setup_at = datetime('now'),
          threads_setup_error = NULL
        WHERE id = ?
      `).run(result.status, account.id)
      console.log(`[threads-setup-job] @${account.username}: ${result.status}`)
    } else {
      // failed
      const attempts = (account.threads_setup_attempts || 0) + 1
      if (attempts >= MAX_ATTEMPTS) {
        db.prepare(`
          UPDATE accounts SET
            threads_setup_status = 'failed',
            threads_setup_error = ?,
            threads_setup_attempts = ?,
            threads_setup_at = datetime('now')
          WHERE id = ?
        `).run(result.error ?? 'unknown', attempts, account.id)

        sendDiscordNotification({
          event: 'automation_failed',
          username: account.username,
          message: `Threads セットアップ失敗 (${attempts}/${MAX_ATTEMPTS})`,
          detail: result.error,
        }).catch(() => {})
        console.error(`[threads-setup-job] @${account.username} failed permanently: ${result.error}`)
      } else {
        // リトライ可能 → pending に戻す
        db.prepare(`
          UPDATE accounts SET
            threads_setup_status = 'pending',
            threads_setup_error = ?,
            threads_setup_attempts = ?,
            threads_setup_at = datetime('now')
          WHERE id = ?
        `).run(result.error ?? 'unknown', attempts, account.id)
        console.warn(`[threads-setup-job] @${account.username} retry ${attempts}/${MAX_ATTEMPTS}: ${result.error}`)
      }
    }

  } catch (err) {
    console.error('[threads-setup-job] unexpected error:', err instanceof Error ? err.message : err)
  } finally {
    running = false
  }
}
