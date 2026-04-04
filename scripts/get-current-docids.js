/**
 * 現在の doc_id を require() で取得する
 */
const { app, session, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/current_docids.txt'

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
      nodeIntegration: false,
    }
  })

  win.webContents.loadURL('https://www.threads.com/activity')

  await new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    setTimeout(resolve, 15000)
  })
  await new Promise(r => setTimeout(r, 3000))

  const result = await win.webContents.executeJavaScript(`
    (function() {
      var out = {};
      var queries = [
        'BarcelonaActivityFeedStoryListContainerQuery',
        'BarcelonaActivityFeedListPaginationQuery',
        'BarcelonaActivityFeedPageViewerQuery',
      ];
      for (var q of queries) {
        try {
          var params = require(q + '$Parameters');
          out[q] = params?.params?.id ?? 'NO_PARAMS';
        } catch(e) {
          try {
            var op = require(q + '_threadsRelayOperation');
            out[q] = op;
          } catch(e2) {
            out[q] = 'ERROR: ' + e.message;
          }
        }
      }
      // Also try fetching from module
      try {
        out['__rev'] = require('__betarev__') || 'n/a';
      } catch(e) { out['__rev'] = 'n/a'; }
      try {
        var uid = require('CurrentUserInitialData');
        out['USER_ID'] = uid.USER_ID;
        out['ACCOUNT_USER_ID'] = uid.ACCOUNT_USER_ID;
      } catch(e) { out['USER_ID'] = 'ERROR: ' + e; }
      try {
        var s = require('__SessionDataClientV2');
        out['__s'] = s?.session_id ?? JSON.stringify(s).slice(0,100);
      } catch(e) {
        try {
          var s2 = require('__SessionData');
          out['__s'] = s2?.session_id ?? JSON.stringify(s2).slice(0,100);
        } catch(e2) { out['__s'] = 'n/a'; }
      }
      return out;
    })()
  `, false)

  log('=== Current doc_ids ===')
  for (const [k, v] of Object.entries(result)) {
    log(`  ${k}: ${v}`)
  }

  win.destroy()
  app.exit(0)
})
