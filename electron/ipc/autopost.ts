import { ipcMain } from 'electron'
import {
  getAutopostConfig,
  upsertAutopostConfig,
  resetAutopostNext,
} from '../db/repositories/autopost'

export function registerAutopostHandlers(): void {
  ipcMain.handle('autopost:get', (_event, accountId: number) => {
    return getAutopostConfig(accountId)
  })

  ipcMain.handle(
    'autopost:save',
    (
      _event,
      data: {
        account_id:    number
        enabled:       boolean
        mode:          'stock' | 'rewrite'
        min_interval:  number
        max_interval:  number
        rewrite_texts: string[]
      }
    ) => {
      return upsertAutopostConfig(data)
    }
  )

  ipcMain.handle('autopost:reset-next', (_event, accountId: number) => {
    resetAutopostNext(accountId)
    return { success: true }
  })
}
