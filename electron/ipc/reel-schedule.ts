import { ipcMain } from 'electron'
import {
  getAllReelSchedules,
  createReelSchedule,
  deleteReelSchedule,
} from '../db/repositories/reel-schedules'
import {
  getAllReelGroupSchedules,
  createReelGroupSchedule,
  deleteReelGroupSchedule,
  toggleReelGroupSchedule,
  getVideosByGroupSchedule,
  addGroupVideo,
  removeGroupVideo,
} from '../db/repositories/reel-group-schedules'

export function registerReelScheduleHandlers(): void {
  // --- 個別リール予約 ---
  ipcMain.handle('reelSchedules:list', async () => {
    return getAllReelSchedules()
  })

  ipcMain.handle('reelSchedules:create', async (_event, data: {
    account_id: number
    video_path: string
    caption?: string
    thumbnail_path?: string | null
    scheduled_at: string
  }) => {
    try {
      const schedule = createReelSchedule(data)
      return { success: true, schedule }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('reelSchedules:delete', async (_event, id: number) => {
    try {
      deleteReelSchedule(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- グループスケジュール ---
  ipcMain.handle('reelGroupSchedules:list', async () => {
    return getAllReelGroupSchedules()
  })

  ipcMain.handle('reelGroupSchedules:create', async (_event, data: {
    group_name: string
    day_of_week: number
    time_slot: string
    random_offset?: number
  }) => {
    try {
      const schedule = createReelGroupSchedule(data)
      return { success: true, schedule }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('reelGroupSchedules:delete', async (_event, id: number) => {
    try {
      deleteReelGroupSchedule(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('reelGroupSchedules:toggle', async (_event, id: number, enabled: boolean) => {
    try {
      toggleReelGroupSchedule(id, enabled)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- 動画プール ---
  ipcMain.handle('reelGroupVideos:list', async (_event, scheduleId: number) => {
    return getVideosByGroupSchedule(scheduleId)
  })

  ipcMain.handle('reelGroupVideos:add', async (_event, data: {
    reel_group_schedule_id: number
    video_path: string
    caption?: string
    thumbnail_path?: string | null
    sort_order?: number
  }) => {
    try {
      const video = addGroupVideo(data)
      return { success: true, video }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('reelGroupVideos:remove', async (_event, id: number) => {
    try {
      removeGroupVideo(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
