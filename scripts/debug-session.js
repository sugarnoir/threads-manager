/**
 * セッション状態をデバッグ: cookies, viewer_id, etc.
 */
const { app, session } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/debug_session.txt'

function log(msg) {
  process.stdout.write(msg + '\n')
  fs.appendFileSync(OUT_FILE, msg + '\n')
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT_FILE, '')
  const sess = session.fromPartition(`persist:account-${ACCOUNT_ID}`)

  // 1. Cookies
  const allCookies = await sess.cookies.get({}).catch(() => [])
  log('=== Cookies ===')
  for (const c of allCookies) {
    if (c.domain?.includes('threads') || c.domain?.includes('instagram')) {
      log(`  ${c.name}=${c.value.slice(0, 30)}... domain=${c.domain}`)
    }
  }

  // 2. Fetch /activity with full response headers
  const r = await sess.fetch('https://www.threads.com/activity', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    }
  })
  const html = await r.text()
  log(`\nHTML length: ${html.length}, status: ${r.status}, url: ${r.url}`)

  // Extract all tokens
  const lsd   = html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] ?? ''
  const dtsg  = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1] ?? ''
  const av1   = html.match(/"actorID"\s*:\s*"(\d+)"/)?.[1] ?? ''
  const av2   = html.match(/"viewer_id"\s*:\s*"(\d+)"/)?.[1] ?? ''
  const av3   = html.match(/"USER_ID"\s*:\s*"(\d+)"/)?.[1] ?? ''
  const viewerId = html.match(/"viewerID"\s*:\s*"(\d+)"/)?.[1] ?? ''
  const userId = html.match(/"userID"\s*:\s*"(\d+)"/)?.[1] ?? ''
  const s = html.match(/"__s"\s*:\s*"([^"]+)"/)?.[1] ?? ''
  const hsi = html.match(/"__hsi"\s*:\s*"?(\d+)"?/)?.[1] ?? ''

  log(`\n=== Tokens ===`)
  log(`  lsd: ${lsd ? lsd.slice(0, 20) : 'MISSING'}`)
  log(`  dtsg: ${dtsg ? dtsg.slice(0, 20) : 'MISSING'}`)
  log(`  actorID: ${av1 || 'NOT FOUND'}`)
  log(`  viewer_id: ${av2 || 'NOT FOUND'}`)
  log(`  USER_ID: ${av3 || 'NOT FOUND'}`)
  log(`  viewerID: ${viewerId || 'NOT FOUND'}`)
  log(`  userID: ${userId || 'NOT FOUND'}`)
  log(`  __s: ${s || 'NOT FOUND'}`)
  log(`  __hsi: ${hsi || 'NOT FOUND'}`)

  // Show all numeric IDs in HTML
  const allIds = [...html.matchAll(/"(?:id|ID|userId|actorId|viewerId|actor_id|viewer_id)"\s*:\s*"(\d{10,20})"/gi)]
  const uniqueIds = [...new Set(allIds.map(m => m[1]))]
  log(`\nAll long numeric IDs in HTML: ${uniqueIds.join(', ')}`)

  // Show ig_did cookie
  const igDid = allCookies.find(c => c.name === 'ig_did')?.value ?? 'NOT FOUND'
  log(`\nig_did: ${igDid.slice(0, 30)}`)

  // Try request WITH full browser headers
  const csrftoken = allCookies.find(c => c.name === 'csrftoken' && c.domain?.includes('threads.com'))?.value ?? ''
  const av = av1 || av2 || av3 || '17841473407662286'
  log(`\nUsing av=${av} for test request`)

  const bodyParams = new URLSearchParams({
    av: av,
    __user: '0',
    __a: '1',
    __comet_req: '29',
    fb_dtsg: dtsg,
    lsd: lsd,
    __crn: 'comet.threads.BarcelonaActivityFeedColumnRoute',
    __spin_t: String(Math.floor(Date.now() / 1000)),
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'BarcelonaActivityFeedStoryListContainerQuery',
    server_timestamps: 'true',
    variables: JSON.stringify({
      '__relay_internal__pv__BarcelonaThreadsWebCachingImprovementsrelayprovider': false,
      '__relay_internal__pv__BarcelonaHasCommunityTopContributorsrelayprovider': false,
      '__relay_internal__pv__BarcelonaHasGhostPostEmojiActivationrelayprovider': false,
    }),
    doc_id: '26454287197535829',
  })

  const r2 = await sess.fetch('https://www.threads.com/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': csrftoken,
      'X-FB-LSD': lsd,
      'X-FB-Friendly-Name': 'BarcelonaActivityFeedStoryListContainerQuery',
      'X-ASBD-ID': '359341',
      'X-IG-App-ID': '238260118697367',
      'X-Root-Field-Name': 'xdt_api__v1__text_feed__notifications__connection',
      'Referer': 'https://www.threads.com/activity',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'ja-JP,ja;q=0.9',
      'Origin': 'https://www.threads.com',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: bodyParams.toString(),
  })
  const text2 = await r2.text()
  log(`\n=== GraphQL Request (with UA) ===`)
  log(`STATUS: ${r2.status}`)
  log(`BODY: ${text2.slice(0, 1000)}`)

  log('\nDone.')
  app.exit(0)
})
