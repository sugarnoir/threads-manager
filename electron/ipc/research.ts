import { ipcMain, BrowserWindow, session } from 'electron'

const THREADS_URL  = 'https://www.threads.com'
const LOAD_TIMEOUT  = 20_000
const POLL_MS       = 400
const TARGET_POSTS  = 30
const MAX_SCROLLS   = 6
const SCROLL_WAIT   = 3_000

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Create a hidden BrowserWindow sharing the account's session.
 * show:false gives a full rendering pipeline (React/JS works) without being visible.
 */
function makeScrapeWindow(accountId: number): BrowserWindow {
  const sess = session.fromPartition(`persist:account-${accountId}`)
  return new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      session: sess,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
}

/** Navigate and wait for did-finish-load, with timeout. */
function loadURL(win: BrowserWindow, url: string): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', resolve)
      win.webContents.once('did-fail-load', (_e, code, desc) => {
        if (code === -3) resolve()  // ERR_ABORTED = redirect, treat as ok
        else reject(new Error(`読み込みエラー: ${desc} (${code})`))
      })
      win.webContents.loadURL(url).catch(reject)
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`タイムアウト: ${LOAD_TIMEOUT / 1000}秒以内に読み込めませんでした`)),
        LOAD_TIMEOUT
      )
    ),
  ])
}

/** Poll until selector matches, or give up gracefully after ms. */
async function waitForContent(win: BrowserWindow, selector: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const found: boolean = await win.webContents.executeJavaScript(
        `document.querySelectorAll(${JSON.stringify(selector)}).length > 0`
      )
      if (found) return
    } catch { /* page not ready yet */ }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

/**
 * Scroll down repeatedly to trigger lazy loading until we have targetCount
 * containers or we hit maxScrolls with no new content appearing.
 */
async function scrollToLoad(win: BrowserWindow, targetCount = TARGET_POSTS, maxScrolls = MAX_SCROLLS): Promise<void> {
  let staleRounds = 0
  for (let i = 0; i < maxScrolls; i++) {
    const before: number = await win.webContents.executeJavaScript(
      `document.querySelectorAll('[data-pressable-container]').length`
    ).catch(() => 0)

    if (before >= targetCount) break

    // Scroll to bottom
    await win.webContents.executeJavaScript(
      `window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })`
    ).catch(() => {})

    // Wait up to SCROLL_WAIT ms for new containers to appear
    const deadline = Date.now() + SCROLL_WAIT
    let after = before
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      after = await win.webContents.executeJavaScript(
        `document.querySelectorAll('[data-pressable-container]').length`
      ).catch(() => before)
      if (after > before) break
    }

    if (after <= before) {
      staleRounds++
      if (staleRounds >= 2) break  // two consecutive scrolls with no new content → give up
    } else {
      staleRounds = 0
    }
  }
}

// ── Extraction scripts ────────────────────────────────────────────────────────

/**
 * Use [data-pressable-container] as the post container (confirmed from DOM debug).
 * Each has exactly one a[href*="/post/"] and one time element.
 * Deduplicate by URL to avoid nested containers.
 */
const EXTRACT_POSTS = /* js */ `
(function () {
  const results = []
  const seenUrls = new Set()

  // Get all pressable containers that have a post link
  const containers = Array.from(document.querySelectorAll('[data-pressable-container]'))
    .filter(el => el.querySelector('a[href*="/post/"]'))

  for (const container of containers) {
    const postLink = container.querySelector('a[href*="/post/"]')
    const url = postLink ? postLink.href : ''
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)

    // Text: collect span[dir="auto"] that are NOT inside a[href*="/@"] (exclude usernames)
    const userLinks = Array.from(container.querySelectorAll('a[href*="/@"]'))
    const textParts = Array.from(container.querySelectorAll('span[dir="auto"]'))
      .filter(span => !userLinks.some(a => a.contains(span)))
      .map(s => s.textContent.trim())
      .filter(Boolean)
    const text = textParts.join(' ')
    if (!text) continue

    const userLink = container.querySelector('a[href*="/@"]')
    const username = userLink ? (userLink.href.match(/@([^/?]+)/) || [])[1] || '' : ''
    const timeEl = container.querySelector('time')
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : null

    // Leaf spans (no child spans) containing only digits = engagement counts
    const nums = Array.from(container.querySelectorAll('span'))
      .filter(s => !s.querySelector('span') && /^\\d[\\d,.]*$/.test(s.textContent.trim()))
      .map(s => s.textContent.trim())

    results.push({ username, text, url, timestamp,
      likes: nums[0] || '0', replies: nums[1] || '0', reposts: nums[2] || '0' })

    if (results.length >= 50) break
  }
  return results
})()
`

const EXTRACT_PROFILE = /* js */ `
(function () {
  const h1 = document.querySelector('h1')
  const displayName = h1 ? h1.textContent.trim() : null

  const possibleBio = [
    document.querySelector('[data-testid="user-description"]'),
    document.querySelector('header p'),
    document.querySelector('main section p'),
  ].find(Boolean)
  const bio = possibleBio ? possibleBio.textContent.trim() : null

  let followerCount = null
  for (const a of Array.from(document.querySelectorAll('a'))) {
    if (/followers/i.test(a.href) || /フォロワー/i.test(a.textContent || '')) {
      const sp = a.querySelector('span')
      const cand = sp ? sp.textContent.trim() : a.textContent.trim()
      if (cand && /[\\d万kKmM]/.test(cand)) { followerCount = cand; break }
    }
  }

  // Recent posts via [data-pressable-container]
  const results = []
  const seenUrls = new Set()
  const containers = Array.from(document.querySelectorAll('[data-pressable-container]'))
    .filter(el => el.querySelector('a[href*="/post/"]'))

  for (const container of containers) {
    const postLink = container.querySelector('a[href*="/post/"]')
    const url = postLink ? postLink.href : ''
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)
    const userLinks = Array.from(container.querySelectorAll('a[href*="/@"]'))
    const textParts = Array.from(container.querySelectorAll('span[dir="auto"]'))
      .filter(span => !userLinks.some(a => a.contains(span)))
      .map(s => s.textContent.trim()).filter(Boolean)
    const text = textParts.join(' ')
    if (!text) continue
    const nums = Array.from(container.querySelectorAll('span'))
      .filter(s => !s.querySelector('span') && /^\\d[\\d,.]*$/.test(s.textContent.trim()))
      .map(s => s.textContent.trim())
    results.push({ text, url, likes: nums[0] || '0', replies: nums[1] || '0', reposts: nums[2] || '0' })
    if (results.length >= 30) break
  }

  return { displayName, bio, followerCount, recentPosts: results }
})()
`

// ── IPC handlers ──────────────────────────────────────────────────────────────

export function registerResearchHandlers(): void {

  // ── DOM debug ───────────────────────────────────────────────────────────────
  ipcMain.handle(
    'research:debug',
    async (_event, data: { accountId: number; keyword: string }) => {
      console.log('[research:debug] start', data)
      const win = makeScrapeWindow(data.accountId)
      try {
        const url = `${THREADS_URL}/search?q=${encodeURIComponent(data.keyword)}&serp_type=default`
        console.log('[research:debug] loadURL:', url)
        await loadURL(win, url)
        console.log('[research:debug] did-finish-load fired, waiting 5s...')
        await new Promise((r) => setTimeout(r, 5000))

        const info = await win.webContents.executeJavaScript(`
          (function() {
            const q = s => document.querySelectorAll(s).length
            const first = s => { const e = document.querySelector(s); return e ? e.textContent.trim().slice(0, 100) : null }
            return {
              url:           location.href,
              title:         document.title,
              article:       q('article'),
              roleArticle:   q('[role="article"]'),
              dataPressable: q('[data-pressable-container]'),
              spanDirAuto:   q('span[dir="auto"]'),
              firstSpanText: first('span[dir="auto"]'),
              aPostLinks:    q('a[href*="/post/"]'),
              aUserLinks:    q('a[href*="/@"]'),
              timeEls:       q('time'),
              bodySnippet:   document.body.innerHTML.slice(0, 2000),
            }
          })()
        `)
        console.log('[research:debug] result:', JSON.stringify(info).slice(0, 600))
        return { success: true, data: info }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[research:debug] error:', msg)
        return { success: false, error: msg }
      } finally {
        win.destroy()
      }
    }
  )

  // ── Keyword search ──────────────────────────────────────────────────────────
  ipcMain.handle(
    'research:keyword',
    async (_event, data: { accountId: number; keyword: string }) => {
      const win = makeScrapeWindow(data.accountId)
      try {
        const url = `${THREADS_URL}/search?q=${encodeURIComponent(data.keyword)}&serp_type=default`
        await loadURL(win, url)
        await waitForContent(win, '[data-pressable-container]')
        await scrollToLoad(win)
        const posts = await win.webContents.executeJavaScript(EXTRACT_POSTS)
        return { success: true, data: posts }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        win.destroy()
      }
    }
  )

  // ── Hashtag search ──────────────────────────────────────────────────────────
  ipcMain.handle(
    'research:hashtag',
    async (_event, data: { accountId: number; hashtag: string }) => {
      const win = makeScrapeWindow(data.accountId)
      try {
        const tag = data.hashtag.startsWith('#') ? data.hashtag.slice(1) : data.hashtag
        const url = `${THREADS_URL}/search?q=%23${encodeURIComponent(tag)}&serp_type=default`
        await loadURL(win, url)
        await waitForContent(win, '[data-pressable-container]')
        await scrollToLoad(win)
        const posts: { text: string; url: string; likes: string }[] = await win.webContents.executeJavaScript(EXTRACT_POSTS)
        return {
          success: true,
          data: { hashtag: `#${tag}`, topPosts: posts.map((p) => ({ text: p.text, likes: '0', url: p.url })) },
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        win.destroy()
      }
    }
  )

  // ── Account analysis ────────────────────────────────────────────────────────
  ipcMain.handle(
    'research:account',
    async (_event, data: { accountId: number; targetUsername: string }) => {
      const win = makeScrapeWindow(data.accountId)
      try {
        const username = data.targetUsername.startsWith('@') ? data.targetUsername.slice(1) : data.targetUsername
        await loadURL(win, `${THREADS_URL}/@${username}`)
        await waitForContent(win, 'h1, [data-pressable-container]')
        await scrollToLoad(win)
        const profile: {
          displayName: string | null; bio: string | null; followerCount: string | null
          recentPosts: { text: string; likes: string; replies: string; reposts: string; url: string }[]
        } = await win.webContents.executeJavaScript(EXTRACT_PROFILE)

        const likeCounts = profile.recentPosts.map((p) => parseInt(p.likes.replace(/\D/g, '')) || 0).filter(Boolean)
        const avgLikes = likeCounts.length
          ? Math.round(likeCounts.reduce((a, b) => a + b, 0) / likeCounts.length)
          : null

        return { success: true, data: { username, ...profile, avgLikes } }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        win.destroy()
      }
    }
  )

  // ── Competitive analysis ────────────────────────────────────────────────────
  ipcMain.handle(
    'research:competitive',
    async (_event, data: { accountId: number; keyword: string }) => {
      const win = makeScrapeWindow(data.accountId)
      try {
        const url = `${THREADS_URL}/search?q=${encodeURIComponent(data.keyword)}&serp_type=default`
        await loadURL(win, url)
        await waitForContent(win, '[data-pressable-container]')
        await scrollToLoad(win)
        const raw: { username: string; text: string; likes: string; reposts: string; replies: string; url: string }[] =
          await win.webContents.executeJavaScript(EXTRACT_POSTS)

        const ranked = raw
          .map((p) => {
            const likes   = parseInt(p.likes.replace(/\D/g, ''))   || 0
            const reposts = parseInt(p.reposts.replace(/\D/g, '')) || 0
            const replies = parseInt(p.replies.replace(/\D/g, '')) || 0
            return { username: p.username, text: p.text, likes, reposts, replies, url: p.url, score: likes + reposts * 2 + replies }
          })
          .sort((a, b) => b.score - a.score)

        return { success: true, data: ranked }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        win.destroy()
      }
    }
  )
}
