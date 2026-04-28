import { getDb } from '../index'

export interface StorySchedule {
  id: number
  account_id: number
  image_path: string
  link_url: string | null
  link_x: number
  link_y: number
  link_width: number
  link_height: number
  scheduled_at: string
  status: 'pending' | 'posted' | 'failed' | 'skipped' | 'cancelled'
  error_msg: string | null
  posted_at: string | null
  source_group_schedule_id: number | null
  created_at: string
}

export function getPendingStorySchedules(): StorySchedule[] {
  return getDb()
    .prepare(
      "SELECT * FROM story_schedules WHERE status = 'pending' AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC"
    )
    .all() as StorySchedule[]
}

export function getAllStorySchedules(): StorySchedule[] {
  return getDb()
    .prepare('SELECT * FROM story_schedules ORDER BY scheduled_at DESC')
    .all() as StorySchedule[]
}

export function getStorySchedulesByAccount(accountId: number): StorySchedule[] {
  return getDb()
    .prepare('SELECT * FROM story_schedules WHERE account_id = ? ORDER BY scheduled_at DESC')
    .all(accountId) as StorySchedule[]
}

export function createStorySchedule(data: {
  account_id: number
  image_path: string
  link_url?: string | null
  link_x?: number
  link_y?: number
  link_width?: number
  link_height?: number
  scheduled_at: string
  source_group_schedule_id?: number | null
}): StorySchedule {
  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO story_schedules
        (account_id, image_path, link_url, link_x, link_y, link_width, link_height, scheduled_at, source_group_schedule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.account_id,
      data.image_path,
      data.link_url ?? null,
      data.link_x ?? 0.5,
      data.link_y ?? 0.5,
      data.link_width ?? 0.3,
      data.link_height ?? 0.1,
      data.scheduled_at,
      data.source_group_schedule_id ?? null
    )
  return db
    .prepare('SELECT * FROM story_schedules WHERE id = ?')
    .get(result.lastInsertRowid) as StorySchedule
}

export function updateStoryScheduleStatus(
  id: number,
  status: StorySchedule['status'],
  errorMsg?: string
): void {
  getDb()
    .prepare(
      `UPDATE story_schedules SET status = ?, error_msg = ?,
       posted_at = CASE WHEN ? = 'posted' THEN datetime('now') ELSE posted_at END
       WHERE id = ?`
    )
    .run(status, errorMsg ?? null, status, id)
}

export function deleteStorySchedule(id: number): void {
  getDb().prepare('DELETE FROM story_schedules WHERE id = ?').run(id)
}

/** 今日、指定グループスケジュールから展開済みかどうか */
export function hasExpandedToday(groupScheduleId: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM story_schedules
       WHERE source_group_schedule_id = ?
       AND date(created_at) = date('now')`
    )
    .get(groupScheduleId) as { c: number }
  return row.c > 0
}
