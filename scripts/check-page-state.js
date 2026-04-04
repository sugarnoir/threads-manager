/**
 * ページの実際の状態を確認する
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/check_page_state.txt'

function log(msg) {
  process.stdout.write(msg + '\n')
  fs.appendFileSync(OUT_FILE, msg + '\n')
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT_FILE, '')

  const win = new BrowserWindow({
    show: true,
    width: 1200,
    height: 900,
    webPreferences: {
      partition: `persist:account-${ACCOUNT_ID}`,
      contextIsolation: false,
    }
  })

  win.webContents.loadURL('https://www.threads.com/activity')
  await new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    setTimeout(resolve, 20000)
  })
  await new Promise(r => setTimeout(r, 5000))

  const info = await win.webContents.executeJavaScript(`
    (function() {
      return {
        url: window.location.href,
        title: document.title,
        bodyText: document.body?.innerText?.slice(0, 500) ?? '',
        hasLoginForm: !!document.querySelector('input[name="password"]') || document.body?.innerText?.includes('ログイン') || document.body?.innerText?.includes('Log in'),
        mainContent: document.querySelector('main')?.innerText?.slice(0, 300) ?? 'no main',
      };
    })()
  `, false)

  log('=== Page State ===')
  log(`URL: ${info.url}`)
  log(`Title: ${info.title}`)
  log(`Has login form: ${info.hasLoginForm}`)
  log(`Body text: ${info.bodyText}`)
  log(`Main: ${info.mainContent}`)

  win.destroy()
  app.exit(0)
})
