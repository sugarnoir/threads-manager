import { autoUpdater } from 'electron-updater'
import { dialog, BrowserWindow } from 'electron'
import log from 'electron-log'

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // electron-log にアップデートログを流す
  autoUpdater.logger = log
  ;(autoUpdater.logger as typeof log).transports.file.level = 'info'

  // dev ビルドではチェックしない
  autoUpdater.autoDownload = false
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
  })

  autoUpdater.on('update-available', async (info) => {
    log.info('[Updater] 新バージョン検出:', info.version)

    const { response } = await dialog.showMessageBox(mainWindow, {
      type:    'info',
      title:   'アップデートがあります',
      message: `新しいバージョン ${info.version} が利用可能です。\n今すぐダウンロードしますか？`,
      buttons: ['ダウンロード', '後で'],
      defaultId: 0,
      cancelId:  1,
    })

    if (response === 0) {
      autoUpdater.downloadUpdate()
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    const msg = `[Updater] ダウンロード中: ${Math.round(progress.percent)}% (${Math.round(progress.bytesPerSecond / 1024)} KB/s)`
    log.info(msg)
    mainWindow.setProgressBar(progress.percent / 100)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    mainWindow.setProgressBar(-1)
    log.info('[Updater] ダウンロード完了:', info.version)

    const { response } = await dialog.showMessageBox(mainWindow, {
      type:    'info',
      title:   'ダウンロード完了',
      message: `バージョン ${info.version} の準備ができました。\n再起動してアップデートを適用しますか？`,
      buttons: ['再起動して適用', '後で適用'],
      defaultId: 0,
      cancelId:  1,
    })

    if (response === 0) {
      autoUpdater.quitAndInstall()
    }
  })

  // ── 起動時にチェック（5秒後に実行して起動処理を邪魔しない）─────────────────
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('[Updater] チェック失敗:', err.message)
    })
  }, 5000)
}
