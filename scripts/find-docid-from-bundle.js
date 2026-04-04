/**
 * Threads.com のチャンクマップから全JSバンドルを取得し doc_id を探す
 * 使い方: electron scripts/find-docid-from-bundle.js
 */
const { app, session } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))

const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/threads_docid_search.txt'

function log(msg) {
  process.stdout.write(msg + '\n')
  fs.appendFileSync(OUT_FILE, msg + '\n')
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT_FILE, '')
  const sess = session.fromPartition(`persist:account-${ACCOUNT_ID}`)

  log('Fetching notifications page...')
  let html = ''
  try {
    const r = await sess.fetch('https://www.threads.com/notifications/')
    html = await r.text()
    log(`HTML length: ${html.length}`)
  } catch (e) {
    log(`Error: ${e}`)
    app.exit(1)
    return
  }

  // HTMLから全rsrc.php URLを収集 (チャンクマップ含む)
  const jsUrls = new Set()
  for (const m of html.matchAll(/"(https:\/\/static\.cdninstagram\.com\/rsrc\.php\/[^"\\]+)"/g)) {
    if (m[1].includes('.js') || !m[1].includes('.')) jsUrls.add(m[1])
  }
  // 直接記述されているrsrc.php URL
  for (const m of html.matchAll(/https:\/\/static\.cdninstagram\.com\/rsrc\.php\/[^\s"'\\,>]+/g)) {
    jsUrls.add(m[0].replace(/['"\\>]+$/, ''))
  }

  log(`Found ${jsUrls.size} candidate URLs`)

  // 各バンドルで __d("cr:16051" の実際定義 (id含む) を探す
  const TARGET_CRS = ['cr:16050', 'cr:16051', 'cr:16052']

  let found = false
  const processed = new Set()

  for (const url of jsUrls) {
    if (processed.has(url)) continue
    processed.add(url)

    let text = ''
    try {
      const r = await sess.fetch(url)
      text = await r.text()
    } catch { continue }

    for (const crKey of TARGET_CRS) {
      // Pass-through は `i.exports=n("cr:XXXX")` パターン — スキップ
      const allDefs = [...text.matchAll(new RegExp(`__d\\("${crKey.replace(':', '\\:')}",`, 'g'))]
      for (const def of allDefs) {
        const snippet = text.slice(def.index, def.index + 1000)
        if (snippet.includes('i.exports=n(')) continue  // pass-through

        log(`\n★ REAL IMPL: ${crKey} in ${url.slice(0, 100)}`)
        log(`  snippet: ${snippet.replace(/\s+/g, ' ').slice(0, 600)}`)

        const idM = snippet.match(/"?id"?\s*[:=]\s*"?(\d{10,25})"?/)
        const nameM = snippet.match(/"?name"?\s*[:=]\s*"?([A-Za-z0-9_]{10,80})"?/)
        log(`  id: ${idM?.[1] ?? '(not found)'}`)
        log(`  name: ${nameM?.[1] ?? '(not found)'}`)
        found = true
      }
    }

    // BarcelonaActivityFeedStoryListContainerQuery の実装を直接探す (params.id)
    if (text.includes('BarcelonaActivityFeedStoryListContainerQuery') && text.includes('"id"')) {
      const re = /BarcelonaActivityFeedStoryListContainerQuery[^)]{0,1000}?"id"\s*:\s*"(\d{10,25})"/
      const m = text.match(re)
      if (m) {
        log(`\n★ Found by name pattern: BarcelonaActivityFeedStoryListContainerQuery id=${m[1]}`)
        log(`  url: ${url.slice(0, 100)}`)
        found = true
      }
    }
  }

  if (!found) {
    log('\nNot found in initial 9 bundles. Trying to find chunk map...')

    // チャンクマップ: HTML内のJSで定義されているURL配列を探す
    // Threadsは `__requireChunk` や `webpackChunks` 形式を使う可能性
    for (const m of html.matchAll(/["']rsrc\.php\/[^"']+\.js[^"']{0,500}/g)) {
      const urlChunk = 'https://static.cdninstagram.com/' + m[0].slice(1).replace(/['"\\]+$/, '')
      if (!jsUrls.has(urlChunk) && urlChunk.length < 300) {
        jsUrls.add(urlChunk)
      }
    }

    // 追加バンドルを処理
    for (const url of jsUrls) {
      if (processed.has(url)) continue
      processed.add(url)
      let text = ''
      try {
        const r = await sess.fetch(url)
        text = await r.text()
      } catch { continue }

      for (const crKey of TARGET_CRS) {
        const allDefs = [...text.matchAll(new RegExp(`__d\\("${crKey.replace(':', '\\:')}",`, 'g'))]
        for (const def of allDefs) {
          const snippet = text.slice(def.index, def.index + 1000)
          if (snippet.includes('i.exports=n(')) continue
          log(`\n★ REAL IMPL: ${crKey} in ${url.slice(0, 100)}`)
          log(`  snippet: ${snippet.replace(/\s+/g, ' ').slice(0, 600)}`)
          const idM = snippet.match(/"?id"?\s*[:=]\s*"?(\d{10,25})"?/)
          log(`  id: ${idM?.[1] ?? '(not found)'}`)
          found = true
        }
      }
    }
  }

  log(`\nTotal bundles scanned: ${processed.size}`)
  log(`Output: ${OUT_FILE}`)
  app.exit(0)
})
