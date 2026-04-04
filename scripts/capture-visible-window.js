/**
 * 可視ウィンドウで /activity を開き全GraphQLレスポンスをキャプチャ
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/capture_visible.txt'

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

  const dbg = win.webContents.debugger
  dbg.attach('1.3')
  dbg.sendCommand('Network.enable').catch(() => {})

  const captured = []
  dbg.on('message', async (event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      const url = params.request?.url ?? ''
      if (url.includes('/api/graphql')) {
        const friendly = params.request?.headers?.['X-FB-Friendly-Name'] ?? ''
        const body = params.request?.postData ?? ''
        captured.push({ id: params.requestId, friendly, body: body.slice(0, 300) })
        log(`[REQ] ${friendly} (${params.requestId})`)
      }
    }
    if (method === 'Network.loadingFinished') {
      const req = captured.find(r => r.id === params.requestId)
      if (req) {
        try {
          const bodyResult = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId })
          req.responseBody = bodyResult.body
          const preview = bodyResult.body.slice(0, 300)
          if (bodyResult.body.includes('notifications')) {
            log(`[RESP] ${req.friendly}: ${preview}`)
          }
        } catch (e) {}
      }
    }
  })

  log('Loading /activity...')
  win.webContents.loadURL('https://www.threads.com/activity')

  await new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    setTimeout(resolve, 20000)
  })
  await new Promise(r => setTimeout(r, 8000))

  log(`\nTotal GraphQL requests: ${captured.length}`)
  log('All friendly names:')
  const seen = new Set()
  for (const r of captured) {
    if (!seen.has(r.friendly)) {
      seen.add(r.friendly)
      log(`  ${r.friendly}`)
    }
  }

  // Show any responses with "notifications" key
  log('\nResponses with notifications:')
  for (const r of captured) {
    if (r.responseBody?.includes('"notifications"')) {
      log(`  ${r.friendly}: ${r.responseBody.slice(0, 500)}`)
    }
  }

  win.destroy()
  app.exit(0)
})
