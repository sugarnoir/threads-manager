/**
 * __s (Web Session ID) を HTMLから抽出して試す
 */
const { app, session } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/test_notif_result.txt'

function log(msg) {
  process.stdout.write(msg + '\n')
  fs.appendFileSync(OUT_FILE, msg + '\n')
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT_FILE, '')
  const sess = session.fromPartition(`persist:account-${ACCOUNT_ID}`)

  const html = await sess.fetch('https://www.threads.com/activity').then(r => r.text())
  const lsd = html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] ?? ''
  const dtsg = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1] ?? ''
  const allCookies = await sess.cookies.get({}).catch(() => [])
  const csrftoken = allCookies.find(c => c.name === 'csrftoken' && c.domain?.includes('threads.com'))?.value ?? ''

  // __s, __hsi, __rev を HTML から抽出
  const sessionId = html.match(/"__s"\s*:\s*"([^"]+)"/)?.[1] ?? ''
  const hsi       = html.match(/"__hsi"\s*:\s*"?(\d+)"?/)?.[1] ?? ''
  const rev       = html.match(/"__rev"\s*:\s*(\d+)/)?.[1] ?? ''
  const hs        = html.match(/"__hs"\s*:\s*"([^"]+)"/)?.[1] ?? ''
  const av        = html.match(/"actorID"\s*:\s*"(\d+)"/)?.[1]
                 ?? html.match(/"viewer_id"\s*:\s*"(\d+)"/)?.[1]
                 ?? '17841473407662286'

  log(`__s: ${sessionId || 'NOT FOUND'}`)
  log(`__hsi: ${hsi || 'NOT FOUND'}`)
  log(`__rev: ${rev || 'NOT FOUND'}`)
  log(`__hs: ${hs || 'NOT FOUND'}`)
  log(`av: ${av}`)

  const variables = {
    account_filters: null,
    after: '1772389653.495045:1774948063.2197633',
    category_filters: null,
    first: 10,
    '__relay_internal__pv__BarcelonaThreadsWebCachingImprovementsrelayprovider': false,
    '__relay_internal__pv__BarcelonaHasCommunityTopContributorsrelayprovider': false,
    '__relay_internal__pv__BarcelonaHasGhostPostEmojiActivationrelayprovider': false,
  }

  const bodyParams = {
    av: av,
    __user: '0',
    __a: '1',
    __req: 'a',
    __comet_req: '29',
    fb_dtsg: dtsg,
    lsd: lsd,
    __crn: 'comet.threads.BarcelonaActivityFeedColumnRoute',
    __spin_t: String(Math.floor(Date.now() / 1000)),
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'BarcelonaActivityFeedListPaginationQuery',
    server_timestamps: 'true',
    variables: JSON.stringify(variables),
    doc_id: '26652441151048593',
  }
  if (sessionId) { bodyParams['__s'] = sessionId; }
  if (hsi)       { bodyParams['__hsi'] = hsi; }
  if (rev)       { bodyParams['__rev'] = rev; bodyParams['__spin_r'] = rev; bodyParams['__spin_b'] = 'trunk'; }
  if (hs)        { bodyParams['__hs'] = hs; }

  const body = new URLSearchParams(bodyParams)
  log(`\nSending request with ${Object.keys(bodyParams).length} params...`)

  const r = await sess.fetch('https://www.threads.com/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': csrftoken,
      'X-FB-LSD': lsd,
      'X-FB-Friendly-Name': 'BarcelonaActivityFeedListPaginationQuery',
      'X-ASBD-ID': '359341',
      'X-IG-App-ID': '238260118697367',
      'X-BLOKS-VERSION-ID': '86eaac606b7c5e9b45f4357f86082d05eace8411e43d3f754d885bf54a759a71',
      'X-Root-Field-Name': 'xdt_api__v1__text_feed__notifications__connection',
      'X-Web-Session-ID': sessionId || '',
      'Referer': 'https://www.threads.com/activity',
    },
    body: body.toString(),
  })
  const text = await r.text()
  log(`\n=== STATUS: ${r.status} ===`)
  log(`BODY: ${text.slice(0, 1000)}`)

  log('\nDone.')
  app.exit(0)
})
