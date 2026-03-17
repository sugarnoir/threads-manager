import { ipcMain, BrowserWindow } from 'electron'
import {
  getAllSchedules,
  createSchedule,
  getPendingSchedules,
  updateScheduleStatus,
  deleteSchedule,
} from '../db/repositories/schedules'
import { createPost, updatePostStatus } from '../db/repositories/posts'
import { postThread } from '../playwright/threads-client'

let schedulerInterval: NodeJS.Timeout | null = null
let schedulerRunning = false

export function startScheduler(win: BrowserWindow): void {
  if (schedulerInterval) return
  schedulerInterval = setInterval(async () => {
    // 前回の実行がまだ完了していない場合はスキップ
    if (schedulerRunning) return
    schedulerRunning = true
    try {
      const pending = getPendingSchedules()
      for (const schedule of pending) {
        updateScheduleStatus(schedule.id, 'posted') // 先にステータス変更して重複実行防止
        const post = createPost({
          account_id: schedule.account_id,
          content: schedule.content,
          media_paths: schedule.media_paths,
        })
        const result = await postThread(
          schedule.account_id,
          schedule.content,
          schedule.media_paths
        )
        updatePostStatus(post.id, result.success ? 'posted' : 'failed', result.error)
        updateScheduleStatus(
          schedule.id,
          result.success ? 'posted' : 'failed',
          post.id
        )
        if (!win.isDestroyed()) {
          win.webContents.send('scheduler:executed', {
            schedule_id: schedule.id,
            success: result.success,
          })
        }
      }
    } finally {
      schedulerRunning = false
    }
  }, 60_000) // 1分ごとにチェック
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
  schedulerRunning = false
}

export function registerSchedulerHandlers(): void {
  ipcMain.handle('schedules:list', () => {
    return getAllSchedules()
  })

  ipcMain.handle(
    'schedules:create',
    (
      _event,
      data: {
        account_id: number
        content: string
        media_paths?: string[]
        scheduled_at: string
      }
    ) => {
      return createSchedule(data)
    }
  )

  ipcMain.handle('schedules:delete', (_event, id: number) => {
    deleteSchedule(id)
    return { success: true }
  })
}
