/**
 * BarcelonaRelayEnvironment のストアから通知データを読み取る
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/relay_store_notifs.txt'

function log(msg) {
  process.stdout.write(msg + '\n')
  fs.appendFileSync(OUT_FILE, msg + '\n')
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT_FILE, '')

  const win = new BrowserWindow({
    show: false,
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

  const result = await win.webContents.executeJavaScript(`
    (function() {
      try {
        var relayEnv = require('BarcelonaRelayEnvironment');
        var env = relayEnv?.default ?? relayEnv;
        var source = env.getStore().getSource();

        // Get all record IDs
        var allIds = [];
        if (source.getRecordIDs) {
          allIds = [...source.getRecordIDs()];
        } else {
          allIds = Object.keys(source._records || {});
        }

        // Get the full store as a plain object
        var records = {};
        for (var id of allIds) {
          try {
            var record = source.get(id);
            if (record) records[id] = record;
          } catch(e) {}
        }

        return JSON.stringify(records);
      } catch(e) {
        return JSON.stringify({ error: e.message });
      }
    })()
  `, false)

  log('=== Relay Store Records ===')
  try {
    const records = JSON.parse(result)
    if (records.error) {
      log('ERROR: ' + records.error)
    } else {
      log(`Total records: ${Object.keys(records).length}`)
      // Show notification-related records
      for (const [id, record] of Object.entries(records)) {
        if (id.includes('notifications') || id.includes('notif')) {
          log(`\n[${id}]`)
          log(JSON.stringify(record, null, 2).slice(0, 1000))
        }
      }
      // Show edge records
      log('\n=== Edge Records ===')
      for (const [id, record] of Object.entries(records)) {
        if (id.match(/edges:\d+$/) || (record && record.__typename && record.__typename.includes('Notification'))) {
          log(`\n[${id}] type=${record.__typename}`)
          log(JSON.stringify(record, null, 2).slice(0, 500))
        }
      }
      // Show all record types
      log('\n=== All __typename values ===')
      const types = new Set()
      for (const r of Object.values(records)) {
        if (r && r.__typename) types.add(r.__typename)
      }
      log([...types].join(', '))
    }
  } catch(e) {
    log('Parse error: ' + e.message)
    log(result.slice(0, 500))
  }

  win.destroy()
  app.exit(0)
})
