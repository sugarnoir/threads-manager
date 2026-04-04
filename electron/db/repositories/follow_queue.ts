import { getDb } from '../index'

export interface FollowQueueItem {
  id:              number
  account_id:      number
  target_pk:       string
  target_username: string
  status:          'pending' | 'done' | 'failed'
  created_at:      string
  followed_at:     string | null
}

export interface FollowQueueStats {
  pending: number
  done:    number
  failed:  number
}

/** フォロワー候補をキューに一括追加（重複は無視） */
export function enqueueFollowers(
  accountId:  number,
  candidates: Array<{ pk: string; username: string }>
): number {
  const db   = getDb()
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO follow_queue (account_id, target_pk, target_username)
     VALUES (?, ?, ?)`
  )
  const insert = db.transaction(() => {
    let added = 0
    for (const c of candidates) {
      const info = stmt.run(accountId, c.pk, c.username)
      added += info.changes
    }
    return added
  })
  return insert() as number
}

/** 次に処理すべき pending アイテムを取得 */
export function getNextPendingFollow(accountId: number): FollowQueueItem | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM follow_queue
       WHERE account_id = ? AND status = 'pending'
       ORDER BY id ASC LIMIT 1`
    )
    .get(accountId) as FollowQueueItem | undefined
  return row ?? null
}

/** アイテムを完了済みにマーク */
export function markFollowQueueDone(id: number): void {
  getDb()
    .prepare(
      `UPDATE follow_queue
       SET status = 'done', followed_at = datetime('now')
       WHERE id = ?`
    )
    .run(id)
}

/** アイテムを失敗済みにマーク */
export function markFollowQueueFailed(id: number): void {
  getDb()
    .prepare(`UPDATE follow_queue SET status = 'failed' WHERE id = ?`)
    .run(id)
}

/** キューの統計を取得 */
export function getFollowQueueStats(accountId: number): FollowQueueStats {
  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) as cnt
       FROM follow_queue WHERE account_id = ?
       GROUP BY status`
    )
    .all(accountId) as Array<{ status: string; cnt: number }>

  const stats: FollowQueueStats = { pending: 0, done: 0, failed: 0 }
  for (const r of rows) {
    if (r.status === 'pending') stats.pending = r.cnt
    else if (r.status === 'done')   stats.done    = r.cnt
    else if (r.status === 'failed') stats.failed  = r.cnt
  }
  return stats
}

/** pending キューをクリア */
export function clearPendingFollowQueue(accountId: number): void {
  getDb()
    .prepare(`DELETE FROM follow_queue WHERE account_id = ? AND status = 'pending'`)
    .run(accountId)
}
