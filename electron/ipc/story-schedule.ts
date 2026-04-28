import { ipcMain } from 'electron'
import {
  getAllStorySchedules,
  getStorySchedulesByAccount,
  createStorySchedule,
  deleteStorySchedule,
} from '../db/repositories/story-schedules'
import {
  getAllStoryGroupSchedules,
  getStoryGroupSchedulesByGroup,
  createStoryGroupSchedule,
  updateStoryGroupSchedule,
  deleteStoryGroupSchedule,
  toggleStoryGroupSchedule,
  getImagesByGroupSchedule,
  addGroupImage,
  removeGroupImage,
} from '../db/repositories/story-group-schedules'

export function registerStoryScheduleHandlers(): void {
  // --- 個別ストーリー予約 ---
  ipcMain.handle('storySchedules:list', async () => {
    return getAllStorySchedules()
  })

  ipcMain.handle('storySchedules:listByAccount', async (_event, accountId: number) => {
    return getStorySchedulesByAccount(accountId)
  })

  ipcMain.handle('storySchedules:create', async (_event, data: {
    account_id: number
    image_path: string
    link_url?: string | null
    link_x?: number
    link_y?: number
    link_width?: number
    link_height?: number
    scheduled_at: string
  }) => {
    try {
      const schedule = createStorySchedule(data)
      return { success: true, schedule }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('storySchedules:delete', async (_event, id: number) => {
    try {
      deleteStorySchedule(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- グループスケジュール ---
  ipcMain.handle('storyGroupSchedules:list', async () => {
    return getAllStoryGroupSchedules()
  })

  ipcMain.handle('storyGroupSchedules:listByGroup', async (_event, groupName: string) => {
    return getStoryGroupSchedulesByGroup(groupName)
  })

  ipcMain.handle('storyGroupSchedules:create', async (_event, data: {
    group_name: string
    day_of_week: number
    time_slot: string
    random_offset?: number
  }) => {
    try {
      const schedule = createStoryGroupSchedule(data)
      return { success: true, schedule }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('storyGroupSchedules:update', async (_event, id: number, data: {
    group_name?: string
    day_of_week?: number
    time_slot?: string
    random_offset?: number
  }) => {
    try {
      updateStoryGroupSchedule(id, data)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('storyGroupSchedules:delete', async (_event, id: number) => {
    try {
      deleteStoryGroupSchedule(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('storyGroupSchedules:toggle', async (_event, id: number, enabled: boolean) => {
    try {
      toggleStoryGroupSchedule(id, enabled)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- 画像プール ---
  ipcMain.handle('storyGroupImages:list', async (_event, scheduleId: number) => {
    return getImagesByGroupSchedule(scheduleId)
  })

  ipcMain.handle('storyGroupImages:add', async (_event, data: {
    story_group_schedule_id: number
    image_path: string
    link_url?: string | null
    link_x?: number
    link_y?: number
    link_width?: number
    link_height?: number
    sort_order?: number
  }) => {
    try {
      const image = addGroupImage(data)
      return { success: true, image }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('storyGroupImages:remove', async (_event, id: number) => {
    try {
      removeGroupImage(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
