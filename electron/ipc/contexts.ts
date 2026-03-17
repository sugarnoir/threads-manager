import { ipcMain, BrowserWindow } from 'electron'
import {
  getContext,
  closeContext,
  getContextInfos,
  getActiveContextIds,
  setStatusChangeCallback,
} from '../playwright/browser-manager'

export function registerContextHandlers(win: BrowserWindow): void {
  // コンテキスト状態一覧
  ipcMain.handle('contexts:list', () => getContextInfos())

  // ブラウザを開く（操作用）
  ipcMain.handle('contexts:open', async (_event, accountId: number) => {
    try {
      const ctx = await getContext(accountId)
      // すでにページがある場合はそれをフォーカス、なければ新規ページを開く
      const pages = ctx.pages()
      if (pages.length === 0) {
        const page = await ctx.newPage()
        await page.goto('https://www.threads.net', { waitUntil: 'domcontentloaded', timeout: 15_000 })
      } else {
        await pages[0].bringToFront().catch(() => {})
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ブラウザを閉じる
  ipcMain.handle('contexts:close', async (_event, accountId: number) => {
    await closeContext(accountId)
    return { success: true }
  })

  // アクティブなコンテキストの ID 一覧
  ipcMain.handle('contexts:active-ids', () => getActiveContextIds())

  // コンテキスト状態変化をレンダラーへプッシュ
  setStatusChangeCallback((infos) => {
    if (!win.isDestroyed()) {
      win.webContents.send('contexts:status-changed', infos)
    }
  })
}
