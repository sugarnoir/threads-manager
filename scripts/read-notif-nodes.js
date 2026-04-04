/**
 * Relayストアのnotification nodeを読み取る
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/notif_nodes.txt'

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

        var allIds = [];
        if (source.getRecordIDs) allIds = [...source.getRecordIDs()];
        else allIds = Object.keys(source._records || {});

        // Get edge node refs
        var connectionId = 'client:root:xdt_api__v1__text_feed__notifications__connection';
        var connection = source.get(connectionId);
        if (!connection) return JSON.stringify({ error: 'connection not found' });

        var edgeRefs = connection.edges?.__refs ?? [];
        var notifications = [];

        for (var edgeRef of edgeRefs) {
          var edge = source.get(edgeRef);
          if (!edge) continue;
          var nodeRef = edge.node?.__ref;
          if (!nodeRef) continue;
          var node = source.get(nodeRef);
          if (!node) continue;

          // Build notification object, resolving refs
          var notif = { __id: nodeRef, __typename: node.__typename };

          // Copy all fields
          for (var k in node) {
            var v = node[k];
            if (v && typeof v === 'object' && v.__ref) {
              // Resolve single ref
              var sub = source.get(v.__ref);
              notif[k] = sub ? Object.assign({}, sub) : v;
            } else if (v && typeof v === 'object' && v.__refs) {
              // Array of refs
              notif[k] = v.__refs.map(r => {
                var sub = source.get(r);
                return sub ? Object.assign({}, sub) : r;
              });
            } else {
              notif[k] = v;
            }
          }
          notifications.push(notif);
        }

        return JSON.stringify(notifications, null, 2);
      } catch(e) {
        return JSON.stringify({ error: e.message, stack: e.stack });
      }
    })()
  `, false)

  log('=== Notification Nodes ===')
  try {
    const nodes = JSON.parse(result)
    if (nodes.error) {
      log('ERROR: ' + nodes.error)
    } else {
      log(`Count: ${nodes.length}`)
      for (const n of nodes) {
        log(`\n--- ${n.__typename} (${n.__id}) ---`)
        log(JSON.stringify(n, null, 2).slice(0, 800))
      }
    }
  } catch(e) {
    log('Parse error: ' + e)
    log(result.slice(0, 500))
  }

  win.destroy()
  app.exit(0)
})
