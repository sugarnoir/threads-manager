/**
 * executeAutoReply フローをそのまま再現してログを取る
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
const ACCOUNT_ID = 3
const OUT_FILE = '/tmp/auto_reply_flow.txt'

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  process.stdout.write(line + '\n')
  fs.appendFileSync(OUT_FILE, line + '\n')
}

app.whenReady().then(async () => {
  fs.writeFileSync(OUT_FILE, '')
  log('=== Auto Reply Flow Test ===')

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: `persist:account-${ACCOUNT_ID}`,
      contextIsolation: false,
    }
  })

  // 既存ページをシミュレート (threads.comの任意ページ)
  log('Loading threads.com home...')
  win.webContents.loadURL('https://www.threads.com/')
  await new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    setTimeout(resolve, 15000)
  })
  await new Promise(r => setTimeout(r, 2000))
  log(`Current URL before: ${win.webContents.getURL()}`)

  // fetchNotificationsViaGraphQL をそのまま実行
  log('Starting fetchNotificationsViaGraphQL...')

  const prevUrl = win.webContents.getURL() ?? ''
  const isOnActivity = prevUrl.includes('/activity')
  log(`isOnActivity=${isOnActivity} prevUrl=${prevUrl}`)

  if (!isOnActivity) {
    log('Navigating to /activity...')
    await new Promise(resolve => {
      const onLoad = () => resolve()
      win.webContents.once('did-finish-load', onLoad)
      win.webContents.loadURL('https://www.threads.com/activity')
      setTimeout(() => { win.webContents.off('did-finish-load', onLoad); resolve() }, 15000)
    })
    log('Waiting 3s for Relay hydration...')
    await new Promise(r => setTimeout(r, 3000))
  }

  log('Reading Relay store...')
  let raw
  try {
    raw = await win.webContents.executeJavaScript(`
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
          return JSON.stringify({ error: e.message, stack: e.stack });
        }
      })()
    `, false)
  } catch (e) {
    log(`executeJavaScript ERROR: ${e.message}`)
    raw = JSON.stringify({ error: e.message })
  }

  log(`Raw result: ${raw?.slice(0, 500)}`)

  try {
    const parsed = JSON.parse(raw)
    if (parsed.error) {
      log(`ERROR from JS: ${parsed.error}`)
      if (parsed.stack) log(`Stack: ${parsed.stack}`)
    } else {
      const notifs = parsed.notifications || []
      log(`Total notifications: ${notifs.length}`)
      for (const n of notifs) {
        log(`  iconName=${n.iconName} username=${n.username} mediaId=${n.mediaId} content=${n.content.slice(0,50)}`)
      }
      const replies = notifs.filter(n => n.iconName === 'reply')
      log(`Reply count: ${replies.length}`)
    }
  } catch(e) {
    log(`JSON parse error: ${e.message}`)
  }

  // navigate back
  if (!isOnActivity && prevUrl) {
    log(`Navigating back to ${prevUrl}`)
    win.webContents.loadURL(prevUrl).catch(() => {})
  }

  log('Done.')
  win.destroy()
  app.exit(0)
})
