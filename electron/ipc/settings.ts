import { ipcMain } from 'electron'
import { getAllSettings, setSetting } from '../db/repositories/settings'
import { sendDiscordNotification } from '../discord'
import { startBot, stopBot, isBotRunning } from '../discord/bot'

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get-all', () => getAllSettings())

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value)
    return { success: true }
  })

  // 複数設定を一括保存（IPC ラウンドトリップを削減）
  ipcMain.handle('settings:set-many', (_event, entries: Record<string, string>) => {
    for (const [key, value] of Object.entries(entries)) {
      setSetting(key, value)
    }
    return { success: true }
  })

  ipcMain.handle('settings:test-webhook', async () => {
    const result = await sendDiscordNotification({
      event: 'test',
      username: 'test_account',
      message: 'Threads Manager からのテスト通知です。正常に設定されています ✅',
    })
    return result
  })

  ipcMain.handle('settings:bot-start', async () => {
    return startBot()
  })

  ipcMain.handle('settings:bot-stop', () => {
    stopBot()
    return { ok: true }
  })

  ipcMain.handle('settings:bot-status', () => {
    return { running: isBotRunning() }
  })
}
