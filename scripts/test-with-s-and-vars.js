/**
 * __s + relay provider variables で通知クエリ
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/test_s_and_vars.txt'

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

  let capturedParams = null
  dbg.on('message', (event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      const url = params.request?.url ?? ''
      const body = params.request?.postData ?? ''
      if (url.includes('/api/graphql') && body.includes('__s=') && !capturedParams) {
        const parsed = new URLSearchParams(body)
        capturedParams = {
          __s: parsed.get('__s') ?? '',
          __hsi: parsed.get('__hsi') ?? '',
          __rev: parsed.get('__rev') ?? '',
          __hs: parsed.get('__hs') ?? '',
          __dyn: parsed.get('__dyn') ?? '',
          __ccg: parsed.get('__ccg') ?? '',
        }
        log('Captured: ' + JSON.stringify(capturedParams).slice(0, 200))
      }
    }
  })

  win.webContents.loadURL('https://www.threads.com/activity')
  await new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    setTimeout(resolve, 15000)
  })
  await new Promise(r => setTimeout(r, 3000))

  const p = capturedParams || { __s: 'j30z3j:nht7i6:x4li01', __rev: '1036320730', __hsi: '7623350536558061464' }
  const sJs = JSON.stringify(p.__s)
  const revJs = JSON.stringify(p.__rev)
  const hsiJs = JSON.stringify(p.__hsi)
  const hsJs = JSON.stringify(p.__hs)
  const dynJs = JSON.stringify(p.__dyn)

  // Test 1: StoryListContainerQuery with relay provider vars AND __s
  const result1 = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        var fbDtsg = require('DTSGInitialData').token || '';
        var lsd = require('LSD').token || '';
        var s = ${sJs};
        var rev = ${revJs};
        var hsi = ${hsiJs};
        var hs = ${hsJs};
        var dyn = ${dynJs};
        var av = '17841473407662286';

        var variables = JSON.stringify({
          '__relay_internal__pv__BarcelonaThreadsWebCachingImprovementsrelayprovider': false,
          '__relay_internal__pv__BarcelonaHasCommunityTopContributorsrelayprovider': false,
          '__relay_internal__pv__BarcelonaHasGhostPostEmojiActivationrelayprovider': false,
        });

        var params = new URLSearchParams();
        params.set('av', av);
        params.set('__user', '0');
        params.set('__a', '1');
        params.set('__req', 'a');
        params.set('__hs', hs);
        params.set('dpr', '2');
        params.set('__ccg', 'EXCELLENT');
        params.set('__rev', rev);
        params.set('__s', s);
        params.set('__hsi', hsi);
        params.set('__dyn', dyn);
        params.set('__comet_req', '29');
        params.set('fb_dtsg', fbDtsg);
        params.set('lsd', lsd);
        params.set('__crn', 'comet.threads.BarcelonaActivityFeedColumnRoute');
        params.set('__spin_r', rev);
        params.set('__spin_b', 'trunk');
        params.set('__spin_t', String(Math.floor(Date.now() / 1000)));
        params.set('fb_api_caller_class', 'RelayModern');
        params.set('fb_api_req_friendly_name', 'BarcelonaActivityFeedStoryListContainerQuery');
        params.set('server_timestamps', 'true');
        params.set('variables', variables);
        params.set('doc_id', '26454287197535829');

        var resp = await fetch('https://www.threads.com/api/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-FB-LSD': lsd,
            'X-FB-Friendly-Name': 'BarcelonaActivityFeedStoryListContainerQuery',
            'X-ASBD-ID': '359341',
            'X-IG-App-ID': '238260118697367',
            'X-Root-Field-Name': 'xdt_api__v1__text_feed__notifications__connection',
            'Referer': 'https://www.threads.com/activity',
          },
          credentials: 'include',
          body: params.toString(),
        });
        var text = await resp.text();
        return { status: resp.status, body: text };
      } catch(e) {
        return { status: 0, body: '', error: e.message };
      }
    })()
  `, true)

  log(`\n=== StoryListContainerQuery (with __s + all params) ===`)
  log(`status: ${result1.status}`)
  log(`body: ${result1.body?.slice(0, 2000)}`)

  win.destroy()
  app.exit(0)
})
