import { ipcMain } from 'electron'
import {
  getAlerts,
  getAlertsByAccount,
  getAlertsSummary24h,
} from '../db/repositories/response-alerts'

export function registerResponseAlertHandlers(): void {
  ipcMain.handle('alerts:list', async (_event, limit?: number, offset?: number) => {
    return getAlerts(limit ?? 100, offset ?? 0)
  })

  ipcMain.handle('alerts:byAccount', async (_event, accountId: number, limit?: number) => {
    return getAlertsByAccount(accountId, limit ?? 50)
  })

  ipcMain.handle('alerts:summary', async () => {
    return getAlertsSummary24h()
  })
}
