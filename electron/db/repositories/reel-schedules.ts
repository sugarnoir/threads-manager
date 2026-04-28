import { getDb } from '../index'

export interface ReelSchedule {
  id: number
  account_id: number
  video_path: string
  caption: string
  thumbnail_path: string | null
  scheduled_at: string
  status: 'pending' | 'posted' | 'failed' | 'skipped' | 'cancelled'
  error_msg: string | null
  posted_at: string | null
  source_group_schedule_id: number | null
  created_at: string
}

export function getPendingReelSchedules(): ReelSchedule[] {
  return getDb()
    .prepare(
      "SELECT * FROM reel_schedules WHERE status = 'pending' AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC"
    )
    .all() as ReelSchedule[]
}

export function getAllReelSchedules(): ReelSchedule[] {
  return getDb()
    .prepare('SELECT * FROM reel_schedules ORDER BY scheduled_at DESC')
    .all() as ReelSchedule[]
}

export function createReelSchedule(data: {
  account_id: number
  video_path: string
  caption?: string
  thumbnail_path?: string | null
  scheduled_at: string
  source_group_schedule_id?: number | null
}): ReelSchedule {
  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO reel_schedules
        (account_id, video_path, caption, thumbnail_path, scheduled_at, source_group_schedule_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.account_id,
      data.video_path,
      data.caption ?? '',
      data.thumbnail_path ?? null,
      data.scheduled_at,
      data.source_group_schedule_id ?? null
    )
  return db
    .prepare('SELECT * FROM reel_schedules WHERE id = ?')
    .get(result.lastInsertRowid) as ReelSchedule
}

export function updateReelScheduleStatus(
  id: number,
  status: ReelSchedule['status'],
  errorMsg?: string
): void {
  getDb()
    .prepare(
      `UPDATE reel_schedules SET status = ?, error_msg = ?,
       posted_at = CASE WHEN ? = 'posted' THEN datetime('now') ELSE posted_at END
       WHERE id = ?`
    )
    .run(status, errorMsg ?? null, status, id)
}

export function deleteReelSchedule(id: number): void {
  getDb().prepare('DELETE FROM reel_schedules WHERE id = ?').run(id)
}

export function hasReelExpandedToday(groupScheduleId: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM reel_schedules
       WHERE source_group_schedule_id = ?
       AND date(created_at) = date('now')`
    )
    .get(groupScheduleId) as { c: number }
  return row.c > 0
}
