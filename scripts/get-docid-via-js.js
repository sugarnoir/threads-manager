/**
 * BarcelonaActivityFeedColumn.entrypoint の variables を抽出する
 */
const { app, session } = require('electron')
const path = require('path')
const os = require('os')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3

app.whenReady().then(async () => {
  const sess = session.fromPartition(`persist:account-${ACCOUNT_ID}`)
  const r = await sess.fetch('https://www.threads.com/notifications/')
  const html = await r.text()

  const jsUrls = new Set()
  for (const m of html.matchAll(/"(https:\/\/static\.cdninstagram\.com\/rsrc\.php\/[^"]+\.js[^"]*)"/g)) jsUrls.add(m[1])

  for (const url of jsUrls) {
    let text = ''
    try { const r2 = await sess.fetch(url); text = await r2.text() } catch { continue }
    if (!text.includes('BarcelonaActivityFeedColumn.entrypoint')) continue

    // __d("BarcelonaActivityFeedColumn.entrypoint", ...) の定義を取得
    const defIdx = text.indexOf('"BarcelonaActivityFeedColumn.entrypoint"')
    if (defIdx < 0) continue
    const defSnippet = text.slice(defIdx, defIdx + 2000)
    process.stdout.write(`\n=== BarcelonaActivityFeedColumn.entrypoint definition ===\n`)
    process.stdout.write(defSnippet.replace(/\s+/g, ' ') + '\n')
  }

  process.stdout.write('Done.\n')
  app.exit(0)
})
