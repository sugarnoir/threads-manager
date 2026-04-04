/**
 * BarcelonaActivityFeedStoryListContainerQuery (初回クエリ) を試す
 * doc_id: 26454287197535829
 */
const { app, session } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/test_initial_query.txt'

function log(msg) {
  process.stdout.write(msg + '\n')
  fs.appendFileSync(OUT_FILE, msg + '\n')
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT_FILE, '')
  const sess = session.fromPartition(`persist:account-${ACCOUNT_ID}`)

  const html = await sess.fetch('https://www.threads.com/activity').then(r => r.text())
  const lsd   = html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] ?? ''
  const dtsg  = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1] ?? ''
  const av    = html.match(/"actorID"\s*:\s*"(\d+)"/)?.[1]
             ?? html.match(/"viewer_id"\s*:\s*"(\d+)"/)?.[1]
             ?? '17841473407662286'
  const allCookies = await sess.cookies.get({}).catch(() => [])
  const csrftoken = allCookies.find(c => c.name === 'csrftoken' && c.domain?.includes('threads.com'))?.value ?? ''

  log(`av: ${av}, lsd: ${lsd ? 'ok' : 'MISSING'}, dtsg: ${dtsg ? 'ok' : 'MISSING'}`)

  // Test 1: BarcelonaActivityFeedStoryListContainerQuery (初回・エントリポイントクエリ)
  // relay provider vars は page で確認したものを使用
  const variables1 = {
    '__relay_internal__pv__BarcelonaThreadsWebCachingImprovementsrelayprovider': false,
    '__relay_internal__pv__BarcelonaHasCommunityTopContributorsrelayprovider': false,
    '__relay_internal__pv__BarcelonaHasGhostPostEmojiActivationrelayprovider': false,
  }

  const body1 = new URLSearchParams({
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
    variables: JSON.stringify(variables1),
    doc_id: '26454287197535829',
  })

  log('\n--- Test 1: BarcelonaActivityFeedStoryListContainerQuery ---')
  const r1 = await sess.fetch('https://www.threads.com/api/graphql', {
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
    },
    body: body1.toString(),
  })
  const text1 = await r1.text()
  log(`STATUS: ${r1.status}`)
  log(`BODY: ${text1.slice(0, 2000)}`)

  // Test 2: ListPaginationQuery with null after (最初のページ)
  const variables2 = {
    account_filters: null,
    after: null,
    category_filters: null,
    first: 10,
    '__relay_internal__pv__BarcelonaThreadsWebCachingImprovementsrelayprovider': false,
    '__relay_internal__pv__BarcelonaHasCommunityTopContributorsrelayprovider': false,
    '__relay_internal__pv__BarcelonaHasGhostPostEmojiActivationrelayprovider': false,
  }
  const body2 = new URLSearchParams({
    av: av,
    __user: '0',
    __a: '1',
    __comet_req: '29',
    fb_dtsg: dtsg,
    lsd: lsd,
    __crn: 'comet.threads.BarcelonaActivityFeedColumnRoute',
    __spin_t: String(Math.floor(Date.now() / 1000)),
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'BarcelonaActivityFeedListPaginationQuery',
    server_timestamps: 'true',
    variables: JSON.stringify(variables2),
    doc_id: '26652441151048593',
  })

  log('\n--- Test 2: ListPaginationQuery with after=null ---')
  const r2 = await sess.fetch('https://www.threads.com/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': csrftoken,
      'X-FB-LSD': lsd,
      'X-FB-Friendly-Name': 'BarcelonaActivityFeedListPaginationQuery',
      'X-ASBD-ID': '359341',
      'X-IG-App-ID': '238260118697367',
      'X-Root-Field-Name': 'xdt_api__v1__text_feed__notifications__connection',
      'Referer': 'https://www.threads.com/activity',
    },
    body: body2.toString(),
  })
  const text2 = await r2.text()
  log(`STATUS: ${r2.status}`)
  log(`BODY: ${text2.slice(0, 2000)}`)

  log('\nDone.')
  app.exit(0)
})
