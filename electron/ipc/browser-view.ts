import { ipcMain, BrowserWindow } from 'electron'
import { ViewManager, changeProfilePicViaView } from '../browser-views/view-manager'

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

  ipcMain.handle('browserView:open-compose', async (_e, accountId: number, content: string, images: string[] = [], topic?: string) => {
    console.log('[browserView:open-compose] received accountId=', accountId, 'content=', content.slice(0, 30), 'images=', images.length, 'topic=', topic)
    const result = await manager.openCompose(accountId, content, images, topic)
    console.log('[browserView:open-compose] result=', result)
    return result
  })

  // CDP レスポンスキャプチャ
  ipcMain.handle('browserView:enableCapture', (_e, accountId: number) => {
    const ok = manager.enableCdpCapture(accountId)
    return { ok }
  })

  ipcMain.handle('browserView:getCaptured', () => {
    return manager.getCapturedData()
  })

  ipcMain.handle('browserView:getFollowerCandidates', () => {
    return manager.getFollowerCandidates()
  })

  ipcMain.handle('browserView:clearCaptured', () => {
    manager.clearCapturedData()
    return { ok: true }
  })

  ipcMain.handle('browserView:changeProfilePic', (_e, accountId: number, imagePath: string) => {
    console.log(`[IPC:changeProfilePic] called accountId=${accountId} imagePath=${imagePath}`)
    return changeProfilePicViaView(accountId, imagePath)
  })
}
