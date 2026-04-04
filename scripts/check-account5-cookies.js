const { app, session } = require('electron')
const os = require('os')
const path = require('path')

app.setPath('userData', path.join(os.homedir(), 'Library/Application Support/threads-manager'))
app.whenReady().then(async () => {
  for (const accountId of [3, 5]) {
    const sess = session.fromPartition(`persist:account-${accountId}`)
    const cookies = await sess.cookies.get({})
    const relevant = cookies.filter(c => c.domain?.includes('threads') || c.domain?.includes('instagram'))
    console.log(`\n=== Account ${accountId} ===`)
    for (const c of relevant) {
      const val = c.name === 'sessionid' ? c.value.slice(0, 30) + '...' : c.value.slice(0, 40)
      console.log(`  ${c.name}=${val} domain=${c.domain}`)
    }
  }
  app.exit(0)
})