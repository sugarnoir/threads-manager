import { getDb } from '../index'

export interface Schedule {
  id: number
  account_id: number
  content: string
  media_paths: string[]
  scheduled_at: string
  status: 'pending' | 'posted' | 'failed' | 'cancelled'
  post_id: number | null
  created_at: string
}

interface ScheduleRow extends Omit<Schedule, 'media_paths'> {
  media_paths: string
}

function parseSchedule(row: ScheduleRow): Schedule {
  return { ...row, media_paths: JSON.parse(row.media_paths) }
}

export function getPendingSchedules(): Schedule[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM schedules WHERE status = 'pending' AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC"
    )
    .all() as ScheduleRow[]
  return rows.map(parseSchedule)
}

export function getAllSchedules(): Schedule[] {
  const rows = getDb()
    .prepare('SELECT * FROM schedules ORDER BY scheduled_at DESC')
    .all() as ScheduleRow[]
  return rows.map(parseSchedule)
}

export function createSchedule(data: {
  account_id: number
  content: string
  media_paths?: string[]
  scheduled_at: string
}): Schedule {
  const db = getDb()
  const result = db
    .prepare(
      'INSERT INTO schedules (account_id, content, media_paths, scheduled_at) VALUES (?, ?, ?, ?)'
    )
    .run(
      data.account_id,
      data.content,
      JSON.stringify(data.media_paths ?? []),
      data.scheduled_at
    )
  const row = db
    .prepare('SELECT * FROM schedules WHERE id = ?')
    .get(result.lastInsertRowid) as ScheduleRow
  return parseSchedule(row)
}

export function updateScheduleStatus(
  id: number,
  status: Schedule['status'],
  post_id?: number
): void {
  getDb()
    .prepare('UPDATE schedules SET status = ?, post_id = COALESCE(?, post_id) WHERE id = ?')
    .run(status, post_id ?? null, id)
}

export function deleteSchedule(id: number): void {
  getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id)
}
