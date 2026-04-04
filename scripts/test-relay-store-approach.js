/**
 * Relay ストアアプローチのテスト
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/test_relay_approach.txt'

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

  log('Loading /activity...')
  win.webContents.loadURL('https://www.threads.com/activity')
  await new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    setTimeout(resolve, 20000)
  })
  await new Promise(r => setTimeout(r, 5000))

  const raw = await win.webContents.executeJavaScript(`
    (function() {
      function resolveRec(source, id, depth) {
        if (depth > 3 || !id) return null;
        var rec = source.get(id);
        if (!rec) return null;
        var out = {};
        for (var k in rec) {
          var v = rec[k];
          if (v && typeof v === 'object' && v.__ref) {
            out[k] = resolveRec(source, v.__ref, depth + 1);
          } else if (v && typeof v === 'object' && v.__refs) {
            out[k] = v.__refs.map(function(r) { return resolveRec(source, r, depth + 1); }).filter(Boolean);
          } else {
            out[k] = v;
          }
        }
        return out;
      }
      try {
        var relayEnv = require('BarcelonaRelayEnvironment');
        var env = relayEnv && relayEnv.default ? relayEnv.default : relayEnv;
        var source = env.getStore().getSource();
        var conn = source.get('client:root:xdt_api__v1__text_feed__notifications__connection');
        if (!conn) return JSON.stringify({ error: 'no connection' });
        var edgeRefs = (conn.edges && conn.edges.__refs) ? conn.edges.__refs : [];
        var notifications = [];
        for (var i = 0; i < edgeRefs.length; i++) {
          var edge = source.get(edgeRefs[i]);
          if (!edge) continue;
          var nodeRef = edge.node && edge.node.__ref;
          if (!nodeRef) continue;
          var node = resolveRec(source, nodeRef, 0);
          if (!node) continue;
          var args = node.args || {};
          var extra = args.extra || {};
          var mediaDict = extra.media_dict || {};
          var title = extra.title || '';
          var usernameMatch = title.match(/\\{([^|]+)\\|/);
          notifications.push({
            notifId:   args.tuuid || node.__id,
            iconName:  extra.icon_name || '',
            mediaId:   mediaDict.pk || '',
            username:  usernameMatch ? usernameMatch[1] : '',
            content:   extra.content || '',
            context:   extra.context || '',
            timestamp: mediaDict.taken_at || 0,
          });
        }
        return JSON.stringify({ notifications: notifications });
      } catch(e) {
        return JSON.stringify({ error: e.message });
      }
    })()
  `, false)

  log('=== Result ===')
  try {
    const parsed = JSON.parse(raw)
    if (parsed.error) {
      log('ERROR: ' + parsed.error)
    } else {
      log(`Total notifications: ${parsed.notifications.length}`)
      for (const n of parsed.notifications) {
        log(`\n  iconName=${n.iconName} username=${n.username}`)
        log(`  mediaId=${n.mediaId} content=${n.content} context=${n.context}`)
        log(`  notifId=${n.notifId}`)
      }
      const replies = parsed.notifications.filter(n => n.iconName === 'reply')
      log(`\nReply notifications: ${replies.length}`)
    }
  } catch(e) {
    log('Parse error: ' + e)
    log(raw.slice(0, 500))
  }

  win.destroy()
  app.exit(0)
})
