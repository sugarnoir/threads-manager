import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'
import log from 'electron-log'

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.logger = log
  ;(autoUpdater.logger as typeof log).transports.file.level = 'info'

  // 強制アップデート: 自動ダウンロード + 終了時自動インストール
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // ── イベントハンドラー ────────────────────────────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    log.info('[Updater] バージョン確認中...')
  })

  autoUpdater.on('update-not-available', () => {
    log.info('[Updater] 最新バージョンです')
  })

  autoUpdater.on('error', (err) => {
    log.error('[Updater] エラー:', err.message)
    // エラー時はローディングを解除して通常起動させる
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', { type: 'error', message: err.message })
    }
  })

  autoUpdater.on('update-available', (info) => {
    log.info('[Updater] 新バージョン検出:', info.version, '→ 自動ダウンロード開始')
    // フロントにアップデート開始を通知 → ローディング画面を表示
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', {
        type:    'downloading',
        version: info.version,
        percent: 0,
      })
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent)
    log.info(`[Updater] ダウンロード中: ${pct}% (${Math.round(progress.bytesPerSecond / 1024)} KB/s)`)
    if (!mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(progress.percent / 100)
      mainWindow.webContents.send('updater:status', {
        type:    'downloading',
        percent: pct,
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[Updater] ダウンロード完了:', info.version, '→ 強制再起動')
    if (!mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1)
      mainWindow.webContents.send('updater:status', {
        type:    'installing',
        version: info.version,
      })
    }
    // 3秒待ってから強制再起動（ユーザーに「インストール中」を見せるため）
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true)  // isSilent=false, isForceRunAfter=true
    }, 3000)
  })

  // ── 起動時にチェック（3秒後に実行）─────────────────────────────────────
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('[Updater] チェック失敗:', err.message)
    })
  }, 3000)
}
