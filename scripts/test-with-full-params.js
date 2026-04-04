/**
 * CDPキャプチャした __s, __rev, __hsi 等を使って通知クエリを試す
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/test_full_params.txt'

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

  // Capture params from the page's own requests
  let capturedParams = null
  dbg.on('message', (event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      const url = params.request?.url ?? ''
      const body = params.request?.postData ?? ''
      if (url.includes('/api/graphql') && body.includes('__s=') && !capturedParams) {
        // Parse key params from body
        const parsed = new URLSearchParams(body)
        capturedParams = {
          av: parsed.get('av') ?? '',
          __s: parsed.get('__s') ?? '',
          __hsi: parsed.get('__hsi') ?? '',
          __rev: parsed.get('__rev') ?? '',
          __hs: parsed.get('__hs') ?? '',
          __dyn: parsed.get('__dyn') ?? '',
          __ccg: parsed.get('__ccg') ?? '',
        }
        log('Captured params from page:')
        for (const [k, v] of Object.entries(capturedParams)) {
          log(`  ${k}: ${v.slice(0, 80)}`)
        }
      }
    }
  })

  log('Loading /activity...')
  win.webContents.loadURL('https://www.threads.com/activity')

  await new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    setTimeout(resolve, 15000)
  })
  await new Promise(r => setTimeout(r, 3000))

  if (!capturedParams?.__s) {
    // Try to get __s from page context
    const sessionData = await win.webContents.executeJavaScript(`
      (function() {
        var out = {};
        try {
          var env = require('__SessionDataClientV2') || require('__SessionData');
          out.__s = env?.session_id ?? '';
        } catch(e) {}
        try { out.__rev = String(require('__betarev__') || ''); } catch(e) {}
        try {
          var siteData = require('SiteData');
          out.__hsi = String(siteData?.haste_session_id ?? '');
          out.__hs = siteData?.__hs ?? '';
        } catch(e) {}
        // Try from __PagesManager or window
        try { out.__s = out.__s || window.__s || ''; } catch(e) {}
        return out;
      })()
    `, false).catch(() => ({}))
    log('\nFrom page JS modules:')
    for (const [k, v] of Object.entries(sessionData)) {
      log(`  ${k}: ${v}`)
    }
    if (sessionData.__s) capturedParams = { ...capturedParams, ...sessionData }
  }

  // Now get tokens via page JS
  const tokens = await win.webContents.executeJavaScript(`
    (function() {
      var fbDtsg = '', lsd = '', csrftoken = '';
      try {
        fbDtsg = require('DTSGInitialData').token || '';
      } catch(e) {}
      try {
        lsd = require('LSD').token || '';
      } catch(e) {}
      // csrftoken from cookies
      try {
        var cookies = document.cookie.split(';');
        for (var c of cookies) {
          var parts = c.trim().split('=');
          if (parts[0] === 'csrftoken') csrftoken = parts[1] || '';
        }
      } catch(e) {}
      return { fbDtsg, lsd, csrftoken };
    })()
  `, false)

  log(`\nTokens: dtsg=${tokens.fbDtsg ? 'ok' : 'MISSING'} lsd=${tokens.lsd ? 'ok' : 'MISSING'} csrf=${tokens.csrftoken ? 'ok' : 'MISSING'}`)

  // Now make the notification query using executeJavaScript (same origin, with cookies)
  const p = capturedParams || {}
  const result = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        var fbDtsg = require('DTSGInitialData').token || '';
        var lsd = require('LSD').token || '';
        var av = '17841473407662286';
        var s = '', hsi = '', rev = '', hs = '';
        try {
          var sd = require('__SessionDataClientV2') || require('__SessionData');
          s = sd?.session_id ?? '';
        } catch(e) {}
        try { rev = String(require('__betarev__') || ''); } catch(e) {}

        var params = new URLSearchParams();
        params.set('av', av);
        params.set('__user', '0');
        params.set('__a', '1');
        params.set('__comet_req', '29');
        params.set('fb_dtsg', fbDtsg);
        params.set('lsd', lsd);
        params.set('__crn', 'comet.threads.BarcelonaActivityFeedColumnRoute');
        params.set('__spin_t', String(Math.floor(Date.now() / 1000)));
        params.set('fb_api_caller_class', 'RelayModern');
        params.set('fb_api_req_friendly_name', 'BarcelonaActivityFeedStoryListContainerQuery');
        params.set('server_timestamps', 'true');
        params.set('variables', '{}');
        params.set('doc_id', '26454287197535829');
        if (s) params.set('__s', s);
        if (rev) { params.set('__rev', rev); params.set('__spin_r', rev); params.set('__spin_b', 'trunk'); }

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

  log(`\n=== GraphQL Result (from page context, empty variables) ===`)
  log(`status: ${result.status}`)
  log(`body: ${result.body?.slice(0, 1000)}`)

  win.destroy()
  app.exit(0)
})
