import { ipcMain } from 'electron'
import {
  getStocksByAccount,
  createStock,
  updateStock,
  deleteStock,
} from '../db/repositories/post_stocks'

export function registerStockHandlers(): void {
  ipcMain.handle('stocks:list', (_e, accountId: number) => {
    try {
      return { success: true, data: getStocksByAccount(accountId) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('stocks:create', (_e, data: {
    account_id: number
    title?:     string | null
    content:    string
    image_url?: string | null
  }) => {
    try {
      return { success: true, data: createStock(data) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('stocks:update', (_e, data: {
    id:         number
    title?:     string | null
    content:    string
    image_url?: string | null
  }) => {
    try {
      const { id, ...rest } = data
      return { success: true, data: updateStock(id, rest) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('stocks:delete', (_e, id: number) => {
    try {
      deleteStock(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
