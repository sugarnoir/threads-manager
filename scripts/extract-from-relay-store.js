/**
 * ページのRelayストアまたはSSRデータから通知を抽出する
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/relay_store_data.txt'

function log(msg) {
  process.stdout.write(msg + '\n')
  fs.appendFileSync(OUT_FILE, msg + '\n')
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT_FILE, '')

  const win = new BrowserWindow({
    show: true,
    width: 1200,
    height: 900,
    webPreferences: {
      partition: `persist:account-${ACCOUNT_ID}`,
      contextIsolation: false,
    }
  })

  win.webContents.loadURL('https://www.threads.com/activity')
  await new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    setTimeout(resolve, 20000)
  })
  await new Promise(r => setTimeout(r, 5000))

  // Try to get data from Relay store
  const relayData = await win.webContents.executeJavaScript(`
    (function() {
      var out = { methods: [], data: null };

      // Try RelayRuntime Environment
      try {
        var relayRuntime = require('RelayRuntime') || require('relay-runtime');
        out.methods.push('RelayRuntime: ' + Object.keys(relayRuntime).join(',').slice(0, 100));
      } catch(e) { out.methods.push('RelayRuntime error: ' + e.message); }

      // Try to find the current Relay environment via React DevTools or window
      try {
        // Threads uses __RelayEnvironment__ or similar
        var env = window.__RelayEnvironment__ || window.relayEnvironment;
        if (env) {
          var store = env.getStore();
          out.methods.push('Found __RelayEnvironment__');
          var snapshot = store.getSource();
          out.data = JSON.stringify(snapshot).slice(0, 5000);
        }
      } catch(e) { out.methods.push('RelayEnv error: ' + e.message); }

      // Try to access __bbox or initial data
      try {
        var bbox = window.__bbox;
        if (bbox) out.methods.push('Found __bbox: ' + JSON.stringify(bbox).slice(0, 200));
      } catch(e) {}

      // Try require('__RelayBootstrap__')
      try {
        var bootstrap = require('__RelayBootstrap__');
        out.methods.push('Found __RelayBootstrap__');
        out.bootstrap = JSON.stringify(bootstrap).slice(0, 500);
      } catch(e) { out.methods.push('__RelayBootstrap__ error: ' + e.message); }

      // Try require('RelayNetworkHandler')
      try {
        var rnh = require('RelayNetworkHandler');
        out.methods.push('RelayNetworkHandler: ' + Object.keys(rnh).join(',').slice(0,100));
      } catch(e) {}

      // Try to find notification records in the Relay store via the module
      try {
        var relayEnvProvider = require('BarcelonaRelayEnvironment');
        out.methods.push('BarcelonaRelayEnvironment found');
        var env2 = relayEnvProvider?.default ?? relayEnvProvider;
        if (env2?.getStore) {
          var source = env2.getStore().getSource();
          var keys = source.getRecordIDs ? [...source.getRecordIDs()] : Object.keys(source._records || {});
          out.methods.push('Record count: ' + keys.length);
          // Find notification records
          var notifKeys = keys.filter(k => k.includes('notif') || k.includes('activ'));
          out.methods.push('Notif keys: ' + notifKeys.slice(0,5).join(', '));
          out.data = JSON.stringify({ sample: keys.slice(0,20) });
        }
      } catch(e) { out.methods.push('BarcelonaRelayEnv error: ' + e.message); }

      return out;
    })()
  `, false)

  log('=== Relay Store Exploration ===')
  for (const m of relayData.methods) log(`  ${m}`)
  if (relayData.data) log(`Data: ${relayData.data}`)
  if (relayData.bootstrap) log(`Bootstrap: ${relayData.bootstrap}`)

  // Try extracting from HTML
  const htmlData = await win.webContents.executeJavaScript(`
    (function() {
      // Look for relay bootstrap data in inline scripts
      var scripts = Array.from(document.querySelectorAll('script'));
      var found = [];
      for (var s of scripts) {
        var t = s.textContent;
        if (t.includes('BarcelonaActivityFeedStoryListContainerQuery') ||
            t.includes('notifications') && t.includes('icon_name')) {
          found.push(t.slice(0, 500));
          if (found.length >= 3) break;
        }
      }
      return found;
    })()
  `, false)

  log('\n=== Scripts with notifications data ===')
  for (const s of htmlData) {
    log(`  ${s.slice(0, 300)}`)
    log('---')
  }

  win.destroy()
  app.exit(0)
})
