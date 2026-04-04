/**
 * 通知ページのGraphQLクエリ doc_id を CDP でキャプチャしてファイルに書く
 * 使い方: electron scripts/capture-notif-docid.js
 */
const { app, BrowserWindow, session } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))

const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/threads_docid_capture.txt'

function log(msg) {
  process.stdout.write(msg + '\n')
  fs.appendFileSync(OUT_FILE, msg + '\n')
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT_FILE, '')  // クリア
  log('Starting CDP capture for notifications page...')

  const sess = session.fromPartition(`persist:account-${ACCOUNT_ID}`)

  const win = new BrowserWindow({
    width: 1280, height: 900,
    show: true,
    webPreferences: { session: sess, contextIsolation: true }
  })

  const wc = win.webContents
  const dbg = wc.debugger
  try { dbg.attach('1.3') } catch {}
  await dbg.sendCommand('Network.enable')

  const friendlyNames = new Map()
  const captured = []

  dbg.on('message', async (_event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      const fn = params.request?.headers?.['X-FB-Friendly-Name'] ?? ''
      if (fn) friendlyNames.set(params.requestId, fn)

      if (params.request?.url?.includes('graphql')) {
        const body = params.request?.postData ?? ''
        const docId = body.match(/doc_id=([^&]+)/)?.[1] ?? ''
        if (docId || fn) {
          log(`[REQ] ${fn || '?'} doc_id=${docId}`)
        }
      }
      return
    }

    if (method !== 'Network.responseReceived') return
    const url = params.response?.url ?? ''
    if (!url.includes('graphql')) return
    const requestId = params.requestId
    const fn = friendlyNames.get(requestId) ?? 'unknown'
    friendlyNames.delete(requestId)

    try {
      const result = await dbg.sendCommand('Network.getResponseBody', { requestId })
      const body = result.base64Encoded
        ? Buffer.from(result.body, 'base64').toString('utf8')
        : result.body

      log(`\n[RESP] ${fn} status=${params.response?.status} len=${body.length}`)
      if (fn.toLowerCase().includes('activity') || fn.toLowerCase().includes('notification') || fn === 'unknown') {
        log(`  body preview: ${body.slice(0, 500)}`)
        captured.push({ fn, body: body.slice(0, 3000) })
      }
    } catch (e) {
      log(`  getResponseBody error: ${e.message}`)
    }
  })

  log(`Loading https://www.threads.com/notifications/ ...`)
  await win.loadURL('https://www.threads.com/notifications/')

  // 25秒待機
  await new Promise(r => setTimeout(r, 25000))

  log('\n=== FINAL SUMMARY ===')
  if (captured.length === 0) {
    log('No activity/notification queries captured.')
  } else {
    for (const c of captured) {
      log(`\n--- ${c.fn} ---`)
      log(c.body)
    }
  }
  log(`\nOutput written to: ${OUT_FILE}`)
  app.exit(0)
})
