import { ipcMain, BrowserWindow } from 'electron'
import { ViewManager } from '../browser-views/view-manager'

export function registerBrowserViewHandlers(win: BrowserWindow, manager: ViewManager): void {
  manager.setOnChanged((infos) => {
    if (!win.isDestroyed()) win.webContents.send('browserView:changed', infos)
  })

  ipcMain.handle('browserView:list', () => manager.getViewInfos())

  ipcMain.handle('browserView:show', (_e, accountId: number, y: number, height: number) => {
    try {
      manager.showView(accountId, y, height)
    } catch (err) {
      console.error('[browserView:show] error:', err)
    }
  })

  ipcMain.handle('browserView:hide', (_e, accountId: number) => {
    manager.hideView(accountId)
  })

  ipcMain.handle('browserView:close', (_e, accountId: number) => {
    manager.closeView(accountId)
  })

  ipcMain.handle('browserView:set-bounds', (_e, accountId: number, y: number, height: number) => {
    manager.updateBounds(accountId, y, height)
  })

  ipcMain.handle('browserView:navigate', (_e, accountId: number, url: string) => {
    manager.navigate(accountId, url)
  })

  ipcMain.handle('browserView:back',    (_e, accountId: number) => manager.goBack(accountId))
  ipcMain.handle('browserView:forward', (_e, accountId: number) => manager.goForward(accountId))
  ipcMain.handle('browserView:reload',  (_e, accountId: number) => manager.reload(accountId))
}
