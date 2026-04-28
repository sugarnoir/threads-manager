import { getDb } from '../index'

export interface ReelGroupSchedule {
  id: number
  group_name: string
  day_of_week: number
  time_slot: string
  random_offset: number
  enabled: number
  created_at: string
}

export interface ReelGroupVideo {
  id: number
  reel_group_schedule_id: number
  video_path: string
  caption: string
  thumbnail_path: string | null
  sort_order: number
}

export function getAllReelGroupSchedules(): ReelGroupSchedule[] {
  return getDb()
    .prepare('SELECT * FROM reel_group_schedules ORDER BY group_name, day_of_week, time_slot')
    .all() as ReelGroupSchedule[]
}

export function getEnabledReelGroupSchedules(): ReelGroupSchedule[] {
  return getDb()
    .prepare('SELECT * FROM reel_group_schedules WHERE enabled = 1 ORDER BY group_name, day_of_week, time_slot')
    .all() as ReelGroupSchedule[]
}

export function createReelGroupSchedule(data: {
  group_name: string
  day_of_week: number
  time_slot: string
  random_offset?: number
}): ReelGroupSchedule {
  const db = getDb()
  const result = db
    .prepare(
      'INSERT INTO reel_group_schedules (group_name, day_of_week, time_slot, random_offset) VALUES (?, ?, ?, ?)'
    )
    .run(data.group_name, data.day_of_week, data.time_slot, data.random_offset ?? 30)
  return db
    .prepare('SELECT * FROM reel_group_schedules WHERE id = ?')
    .get(result.lastInsertRowid) as ReelGroupSchedule
}

export function deleteReelGroupSchedule(id: number): void {
  getDb().prepare('DELETE FROM reel_group_schedules WHERE id = ?').run(id)
}

export function toggleReelGroupSchedule(id: number, enabled: boolean): void {
  getDb()
    .prepare('UPDATE reel_group_schedules SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, id)
}

// --- 動画プール ---

export function getVideosByGroupSchedule(scheduleId: number): ReelGroupVideo[] {
  return getDb()
    .prepare('SELECT * FROM reel_group_videos WHERE reel_group_schedule_id = ? ORDER BY sort_order, id')
    .all(scheduleId) as ReelGroupVideo[]
}

export function addGroupVideo(data: {
  reel_group_schedule_id: number
  video_path: string
  caption?: string
  thumbnail_path?: string | null
  sort_order?: number
}): ReelGroupVideo {
  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO reel_group_videos
        (reel_group_schedule_id, video_path, caption, thumbnail_path, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      data.reel_group_schedule_id,
      data.video_path,
      data.caption ?? '',
      data.thumbnail_path ?? null,
      data.sort_order ?? 0
    )
  return db
    .prepare('SELECT * FROM reel_group_videos WHERE id = ?')
    .get(result.lastInsertRowid) as ReelGroupVideo
}

export function removeGroupVideo(id: number): void {
  getDb().prepare('DELETE FROM reel_group_videos WHERE id = ?').run(id)
}
