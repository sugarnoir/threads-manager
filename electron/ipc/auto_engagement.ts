import { ipcMain } from 'electron'
import {
  getAutoEngagementConfig,
  upsertAutoEngagementConfig,
  resetAutoEngagementNext,
} from '../db/repositories/auto_engagement'

export function registerAutoEngagementHandlers(): void {
  ipcMain.handle(
    'autoEngagement:get',
    (_event, accountId: number, action: 'like' | 'follow') => {
      return getAutoEngagementConfig(accountId, action)
    }
  )

  ipcMain.handle(
    'autoEngagement:save',
    (
      _event,
      data: {
        account_id:       number
        action:           'like' | 'follow'
        target_usernames: string
        enabled:          boolean
        min_interval:     number
        max_interval:     number
      }
    ) => {
      return upsertAutoEngagementConfig(data)
    }
  )

  ipcMain.handle(
    'autoEngagement:reset-next',
    (_event, accountId: number, action: 'like' | 'follow') => {
      resetAutoEngagementNext(accountId, action)
      return { success: true }
    }
  )
}
