import { app, BrowserWindow, session } from 'electron'
import path from 'path'
import { closeDb } from './db/index'
import { closeAllContexts } from './playwright/browser-manager'
import { startBot, stopBot } from './discord/bot'
import { getSetting, setSetting } from './db/repositories/settings'
import { getAllAccounts } from './db/repositories/accounts'
import { registerAccountHandlers } from './ipc/account'
import { registerPostHandlers } from './ipc/post'
import { registerSchedulerHandlers, startScheduler, stopScheduler } from './ipc/scheduler'
import { registerEngagementHandlers } from './ipc/engagement'
import { registerContextHandlers } from './ipc/contexts'
import { registerBrowserViewHandlers } from './ipc/browser-view'
import { registerSettingsHandlers } from './ipc/settings'
import { registerAuthHandlers } from './ipc/auth'
import { registerGroupHandlers } from './ipc/groups'
import { registerResearchHandlers } from './ipc/research'
import { registerStockHandlers } from './ipc/stocks'
import { registerTemplateHandlers } from './ipc/templates'
import { registerLicenseAdminHandlers } from './ipc/license-admin'
import { registerAutopostHandlers } from './ipc/autopost'
import { registerAutoEngagementHandlers } from './ipc/auto_engagement'
import { registerFollowQueueHandlers } from './ipc/follow-queue'
import { registerProxyPresetHandlers } from './ipc/proxy-presets'
import { registerMasterKeyHandlers } from './ipc/master-key'
import { registerAutoReplyHandlers } from './ipc/auto-reply'
import { registerStoryScheduleHandlers } from './ipc/story-schedule'
import { registerReelScheduleHandlers } from './ipc/reel-schedule'
import { registerResponseAlertHandlers } from './ipc/response-alerts'
import { initAutoUpdater } from './updater'
import { initViewManager } from './browser-views/view-manager'
import { registerAppConfigHandlers } from './ipc/app-config'
import { initAppConfig } from './lib/app-config'

const isDev = process.env.NODE_ENV === 'development'

// 配布ビルドで WebContentsView が黒くなる GPU 合成バグを防ぐ
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // ローカルファイル(file://)をimgタグで表示するために必要
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // DevTools は Cmd+Option+I で手動オープン
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// シングルインスタンスロック — 2つ目の起動を防ぐ
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 2つ目が起動しようとしたら既存ウィンドウにフォーカス
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

app.whenReady().then(() => {
  registerAuthHandlers()
  registerLicenseAdminHandlers()
  registerAutopostHandlers()
  registerAutoEngagementHandlers()
  registerAutoReplyHandlers()
  registerProxyPresetHandlers()
  registerMasterKeyHandlers()
  registerAppConfigHandlers()
  registerStoryScheduleHandlers()
  registerReelScheduleHandlers()
  registerResponseAlertHandlers()
  initAppConfig() // fire-and-forget: 起動を遅延させない
  registerGroupHandlers()
  registerResearchHandlers()
  registerStockHandlers()
  registerTemplateHandlers()
  registerAccountHandlers()
  registerPostHandlers()
  registerSchedulerHandlers()
  registerSettingsHandlers()

  createWindow()

  if (mainWindow) {
    const viewManager = initViewManager(mainWindow)

    startScheduler(mainWindow)
    registerEngagementHandlers(mainWindow)
    registerContextHandlers(mainWindow)
    registerBrowserViewHandlers(mainWindow, viewManager)
    registerFollowQueueHandlers(viewManager, mainWindow)
    initAutoUpdater(mainWindow)


    // Auto-start Discord Bot if enabled
    if (getSetting('discord_bot_enabled') === 'true') {
      startBot().then((r) => {
        if (!r.ok) console.warn('[DiscordBot] auto-start failed:', r.error)
      })
    }

  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopScheduler()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  stopScheduler()
  stopBot()

  // アプリ終了前にメモリ上のセッションCookieをDBにバックアップする。
  // セッションCookie（有効期限なし）は再起動で消えるため、終了時に保存しておく。
  await backupAllSessionCookies()

  await closeAllContexts()
  closeDb()
})

async function backupAllSessionCookies(): Promise<void> {
  const yearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
  try {
    const accounts = getAllAccounts()
    for (const account of accounts) {
      try {
        const sess = session.fromPartition(`persist:account-${account.id}`)
        const cookies = await sess.cookies.get({})
        if (cookies.length === 0) continue
        const normalized = cookies.map((c) => ({
          name:           c.name,
          value:          c.value,
          domain:         c.domain,
          path:           c.path,
          secure:         c.secure,
          httpOnly:       c.httpOnly,
          expirationDate: c.expirationDate ?? yearFromNow,
          sameSite:       c.sameSite,
        }))
        setSetting(`session_cookies_${account.id}`, JSON.stringify(normalized))
      } catch { /* skip individual account errors */ }
    }
  } catch { /* DB may be unavailable */ }
}
