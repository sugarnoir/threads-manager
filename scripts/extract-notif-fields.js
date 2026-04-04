/**
 * XDTActivityFeedStory の全フィールドを深く取得する
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/notif_fields.txt'

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
      function resolveRecord(source, id, depth) {
        if (depth > 3) return { __id: id };
        var record = source.get(id);
        if (!record) return null;
        var out = {};
        for (var k in record) {
          var v = record[k];
          if (v && typeof v === 'object') {
            if (v.__ref) {
              out[k] = resolveRecord(source, v.__ref, depth + 1);
            } else if (v.__refs) {
              out[k] = v.__refs.map(r => resolveRecord(source, r, depth + 1));
            } else {
              out[k] = v;
            }
          } else {
            out[k] = v;
          }
        }
        return out;
      }

      try {
        var relayEnv = require('BarcelonaRelayEnvironment');
        var env = relayEnv?.default ?? relayEnv;
        var source = env.getStore().getSource();

        var connectionId = 'client:root:xdt_api__v1__text_feed__notifications__connection';
        var connection = source.get(connectionId);
        var edgeRefs = connection?.edges?.__refs ?? [];

        var notifications = [];
        for (var edgeRef of edgeRefs) {
          var edge = source.get(edgeRef);
          var nodeRef = edge?.node?.__ref;
          if (!nodeRef) continue;
          var node = resolveRecord(source, nodeRef, 0);
          notifications.push(node);
        }
        return JSON.stringify(notifications);
      } catch(e) {
        return JSON.stringify({ error: e.message });
      }
    })()
  `, false)

  log('=== Notification Full Fields ===')
  try {
    const nodes = JSON.parse(result)
    if (!Array.isArray(nodes)) {
      log('ERROR: ' + JSON.stringify(nodes))
    } else {
      log(`Count: ${nodes.length}`)
      for (const n of nodes) {
        log(`\n--- ${n.__id} ---`)
        // Print flattened key fields
        const args = n.args || {}
        const extra = args.extra || {}
        log(`args.tuuid: ${args.tuuid}`)
        log(`args.icon_name: ${args.icon_name}`)
        log(`args.narrative_text: ${args.narrative_text}`)
        log(`args.notification_subtype: ${args.notification_subtype}`)
        log(`args.profile_user_ids: ${JSON.stringify(args.profile_user_ids)}`)
        log(`extra keys: ${Object.keys(extra).join(', ')}`)
        log(`extra.user: ${JSON.stringify(extra.user || extra.users)?.slice(0, 200)}`)
        log(`extra.media: ${JSON.stringify(extra.media || extra.context_media)?.slice(0, 200)}`)
        log(`extra.text: ${extra.text || extra.content || extra.comment_text || extra.thread_text || ''}`)
        log(`extra full: ${JSON.stringify(extra).slice(0, 500)}`)
        log(`top-level keys: ${Object.keys(n).join(', ')}`)
        log(`ALL top-level: ${JSON.stringify(n).slice(0, 1000)}`)
      }
    }
  } catch(e) {
    log('Parse error: ' + e)
    log(result.slice(0, 500))
  }

  win.destroy()
  app.exit(0)
})
