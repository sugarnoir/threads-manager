import { getDb } from '../index'

export interface StoryGroupSchedule {
  id: number
  group_name: string
  day_of_week: number
  time_slot: string
  random_offset: number
  enabled: number
  created_at: string
}

export interface StoryGroupImage {
  id: number
  story_group_schedule_id: number
  image_path: string
  link_url: string | null
  link_x: number
  link_y: number
  link_width: number
  link_height: number
  sort_order: number
}

export function getAllStoryGroupSchedules(): StoryGroupSchedule[] {
  return getDb()
    .prepare('SELECT * FROM story_group_schedules ORDER BY group_name, day_of_week, time_slot')
    .all() as StoryGroupSchedule[]
}

export function getStoryGroupSchedulesByGroup(groupName: string): StoryGroupSchedule[] {
  return getDb()
    .prepare('SELECT * FROM story_group_schedules WHERE group_name = ? ORDER BY day_of_week, time_slot')
    .all(groupName) as StoryGroupSchedule[]
}

export function getEnabledStoryGroupSchedules(): StoryGroupSchedule[] {
  return getDb()
    .prepare('SELECT * FROM story_group_schedules WHERE enabled = 1 ORDER BY group_name, day_of_week, time_slot')
    .all() as StoryGroupSchedule[]
}

export function createStoryGroupSchedule(data: {
  group_name: string
  day_of_week: number
  time_slot: string
  random_offset?: number
}): StoryGroupSchedule {
  const db = getDb()
  const result = db
    .prepare(
      'INSERT INTO story_group_schedules (group_name, day_of_week, time_slot, random_offset) VALUES (?, ?, ?, ?)'
    )
    .run(data.group_name, data.day_of_week, data.time_slot, data.random_offset ?? 30)
  return db
    .prepare('SELECT * FROM story_group_schedules WHERE id = ?')
    .get(result.lastInsertRowid) as StoryGroupSchedule
}

export function updateStoryGroupSchedule(
  id: number,
  data: Partial<Pick<StoryGroupSchedule, 'group_name' | 'day_of_week' | 'time_slot' | 'random_offset'>>
): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.group_name !== undefined)   { fields.push('group_name = ?');   values.push(data.group_name) }
  if (data.day_of_week !== undefined)  { fields.push('day_of_week = ?');  values.push(data.day_of_week) }
  if (data.time_slot !== undefined)    { fields.push('time_slot = ?');    values.push(data.time_slot) }
  if (data.random_offset !== undefined){ fields.push('random_offset = ?');values.push(data.random_offset) }
  if (fields.length === 0) return
  values.push(id)
  getDb().prepare(`UPDATE story_group_schedules SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function deleteStoryGroupSchedule(id: number): void {
  getDb().prepare('DELETE FROM story_group_schedules WHERE id = ?').run(id)
}

export function toggleStoryGroupSchedule(id: number, enabled: boolean): void {
  getDb()
    .prepare('UPDATE story_group_schedules SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, id)
}

// --- 画像プール ---

export function getImagesByGroupSchedule(scheduleId: number): StoryGroupImage[] {
  return getDb()
    .prepare('SELECT * FROM story_group_images WHERE story_group_schedule_id = ? ORDER BY sort_order, id')
    .all(scheduleId) as StoryGroupImage[]
}

export function addGroupImage(data: {
  story_group_schedule_id: number
  image_path: string
  link_url?: string | null
  link_x?: number
  link_y?: number
  link_width?: number
  link_height?: number
  sort_order?: number
}): StoryGroupImage {
  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO story_group_images
        (story_group_schedule_id, image_path, link_url, link_x, link_y, link_width, link_height, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.story_group_schedule_id,
      data.image_path,
      data.link_url ?? null,
      data.link_x ?? 0.5,
      data.link_y ?? 0.5,
      data.link_width ?? 0.3,
      data.link_height ?? 0.1,
      data.sort_order ?? 0
    )
  return db
    .prepare('SELECT * FROM story_group_images WHERE id = ?')
    .get(result.lastInsertRowid) as StoryGroupImage
}

export function removeGroupImage(id: number): void {
  getDb().prepare('DELETE FROM story_group_images WHERE id = ?').run(id)
}
