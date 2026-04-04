/**
 * /activity ページをロードして通知APIレスポンスをCDPでキャプチャする
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/capture_notif_response.txt'

function log(msg) {
  process.stdout.write(msg + '\n')
  fs.appendFileSync(OUT_FILE, msg + '\n')
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT_FILE, '')

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: `persist:account-${ACCOUNT_ID}`,
      contextIsolation: false,
    }
  })

  const dbg = win.webContents.debugger
  dbg.attach('1.3')
  dbg.sendCommand('Network.enable').catch(() => {})

  const requests = new Map()
  const graphqlRequests = []

  dbg.on('message', async (event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      const url = params.request?.url ?? ''
      if (url.includes('/api/graphql')) {
        requests.set(params.requestId, {
          url,
          body: params.request?.postData ?? '',
          responseBody: null,
        })
        const friendly = params.request?.headers?.['X-FB-Friendly-Name'] ?? ''
        log(`[REQ] ${params.requestId} friendly=${friendly}`)
        log(`  body: ${(params.request?.postData ?? '').slice(0, 300)}`)
      }
    }
    if (method === 'Network.responseReceived') {
      const req = requests.get(params.requestId)
      if (req) {
        req.status = params.response?.status
        req.responseHeaders = params.response?.headers
        log(`[RES] ${params.requestId} status=${params.response?.status}`)
      }
    }
    if (method === 'Network.loadingFinished') {
      const req = requests.get(params.requestId)
      if (req) {
        try {
          const bodyResult = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId })
          req.responseBody = bodyResult.body
          log(`[BODY] ${params.requestId}: ${bodyResult.body.slice(0, 500)}`)
          graphqlRequests.push(req)
        } catch (e) {
          log(`[BODY_ERR] ${params.requestId}: ${e.message}`)
        }
      }
    }
  })

  log('Loading /activity...')
  win.webContents.loadURL('https://www.threads.com/activity')

  // Wait for page to settle
  await new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    setTimeout(resolve, 20000)
  })
  await new Promise(r => setTimeout(r, 5000))

  log(`\nTotal graphql requests captured: ${graphqlRequests.length}`)
  log('\nFinal URL: ' + win.webContents.getURL())

  win.destroy()
  app.exit(0)
})
