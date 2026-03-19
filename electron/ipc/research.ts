import { ipcMain, BrowserWindow, session } from 'electron'

const THREADS_URL   = 'https://www.threads.com'
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
      if (staleRounds >= 2) break
    } else {
      staleRounds = 0
    }
  }
}

// ── Extraction scripts ────────────────────────────────────────────────────────

/**
 * Shared post-extraction logic.
 * Returns all currently visible [data-pressable-container] posts with their data.
 *
 * Text extraction strategy:
 *   TreeWalker で生テキストノードを走査し、エンゲージメントエリア
 *   (button / [role="button"] / svg / time / ユーザーリンク) に含まれる
 *   ノードを丸ごとスキップする。span 単位でのフィルタよりも精度が高い。
 */
const EXTRACT_POSTS = /* js */ `
(function () {
  // True if a raw text value is engagement metadata (count, relative time, etc.)
  function _isMeta(t) {
    if (!t) return true
    if (/^[\\d,.]+$/.test(t)) return true                  // 純整数: "123", "1,234"
    if (/^\\d[\\d.]*[kKmMbB万千億]$/.test(t)) return true   // 省略形: "1.2K", "3万"
    if (/^\\d+[hdwmsy]$/i.test(t)) return true              // 相対時刻: "3h", "5d"
    return false
  }

  // True if a text value is an engagement count (number or abbreviated; excludes time).
  function _isCount(t) {
    if (!t) return false
    if (/^[\\d,.]+$/.test(t)) return true
    if (/^\\d[\\d.]*[kKmMbB万千億]$/.test(t)) return true
    return false
  }

  // Extract post body text using TreeWalker over raw text nodes.
  // Skips nodes whose ancestors are: button, [role="button"], svg, time, or user-profile links.
  function _extractText(root, userLinks) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    const parts = []
    const seen  = new Set()
    let node
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim()
      if (!t) continue
      // Walk up to root checking for skip-worthy ancestors
      let el = node.parentElement
      let skip = false
      while (el && el !== root) {
        const tag  = el.tagName.toLowerCase()
        const role = el.getAttribute('role') || ''
        if (tag === 'button' || tag === 'svg' || tag === 'time') { skip = true; break }
        if (role === 'button') { skip = true; break }
        if (userLinks.some(a => a === el || a.contains(el)))     { skip = true; break }
        el = el.parentElement
      }
      if (skip) continue
      if (_isMeta(t)) continue
      if (seen.has(t)) continue   // 重複テキストノードを除去
      seen.add(t)
      parts.push(t)
    }
    return parts.join('\\n').trim()
  }

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
    const text = _extractText(container, userLinks)
    if (!text) continue

    const userLink  = container.querySelector('a[href*="/@"]')
    const username  = userLink ? (userLink.href.match(/@([^/?]+)/) || [])[1] || '' : ''
    const timeEl    = container.querySelector('time')
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : null
    const imgEl     = Array.from(container.querySelectorAll('img'))
      .find(img => img.src && !img.src.startsWith('data:') && (img.naturalWidth > 50 || img.width > 50))
    const imageUrl  = imgEl ? imgEl.src : null

    // Engagement counts: leaf spans containing only count values.
    const nums = Array.from(container.querySelectorAll('span'))
      .filter(s => !s.querySelector('span') && _isCount(s.textContent.trim()))
      .map(s => s.textContent.trim())

    results.push({ username, text, url, timestamp, imageUrl,
      likes: nums[0] || '0', replies: nums[1] || '0', reposts: nums[2] || '0' })
  }
  return results
})()
`

/** Extract only profile header info (displayName / bio / followerCount). */
const EXTRACT_PROFILE_INFO = /* js */ `
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
  return { displayName, bio, followerCount }
})()
`

// ── Incremental scroll collector (for profile pages) ─────────────────────────

interface ProfilePost {
  url:       string
  text:      string
  likes:     string
  replies:   string
  reposts:   string
  imageUrl:  string | null
  timestamp: string | null
}

/**
 * Threads uses a virtualized list: as you scroll down, older DOM nodes are
 * removed.  A single extract-after-scroll misses everything above the fold.
 *
 * Strategy: extract visible posts, scroll, extract again, accumulate into a
 * Map<url, post> so duplicates are ignored and removals don't cause data loss.
 * Stop when we have >= target posts OR two consecutive scrolls yield nothing new.
 */
async function scrollAndCollectPosts(
  win: BrowserWindow,
  target  = 30,
  maxScrolls = 40,
): Promise<ProfilePost[]> {
  const collected = new Map<string, ProfilePost>()

  const harvest = async (): Promise<void> => {
    try {
      const posts: ProfilePost[] = await win.webContents.executeJavaScript(EXTRACT_POSTS)
      for (const p of posts) {
        if (p.url && !collected.has(p.url)) collected.set(p.url, p)
      }
    } catch { /* page may not be ready */ }
  }

  // Harvest before first scroll
  await harvest()

  let staleRounds = 0

  for (let i = 0; i < maxScrolls; i++) {
    if (collected.size >= target) break

    const before = collected.size

    // instant scroll avoids waiting for smooth-scroll animation
    await win.webContents.executeJavaScript(
      `window.scrollBy({ top: window.innerHeight * 2, behavior: 'instant' })`
    ).catch(() => {})

    // Poll for up to 3 s; stop early once new posts appear
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500))
      await harvest()
      if (collected.size > before) break
    }

    if (collected.size <= before) {
      staleRounds++
      if (staleRounds >= 2) break   // two consecutive dry scrolls → end of feed
    } else {
      staleRounds = 0
    }
  }

  return [...collected.values()]
}

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

        // Incremental scroll: collect posts one scroll at a time, accumulate by URL.
        // This handles Threads' virtual list (DOM nodes removed while scrolling).
        const recentPosts = await scrollAndCollectPosts(win, 30, 40)

        const profileInfo: { displayName: string | null; bio: string | null; followerCount: string | null } =
          await win.webContents.executeJavaScript(EXTRACT_PROFILE_INFO)

        const likeCounts = recentPosts.map((p) => parseInt(p.likes.replace(/\D/g, '')) || 0).filter(Boolean)
        const avgLikes = likeCounts.length
          ? Math.round(likeCounts.reduce((a, b) => a + b, 0) / likeCounts.length)
          : null

        return { success: true, data: { username, ...profileInfo, avgLikes, recentPosts } }
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
