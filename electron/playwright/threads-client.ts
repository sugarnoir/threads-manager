import { BrowserContext, Page } from 'playwright'
import { withContext, openLoginBrowser, ProxyConfig } from './browser-manager'
import { getAccountById } from '../db/repositories/accounts'
import { SPEED_PRESETS, SpeedPreset, randomDelay, shortDelay, humanType, randomScroll } from './human-behavior'
import fs from 'fs'

function getConfig(accountId: number) {
  const account = getAccountById(accountId)
  const preset: SpeedPreset = (account?.speed_preset ?? 'normal') as SpeedPreset
  return SPEED_PRESETS[preset] ?? SPEED_PRESETS.normal
}

// threads.net は threads.com へリダイレクトされる (2024年以降)
const THREADS_URL = 'https://www.threads.com'
const LOGIN_URL   = `${THREADS_URL}/login`

export interface LoginResult {
  success: boolean
  username?: string
  error?: string
}

export interface PostResult {
  success: boolean
  error?: string
}

export type EngagementStatus = 'done' | 'failed' | 'already_done'

export interface EngagementResult {
  status: EngagementStatus
  error?: string
}

function isThreadsDomain(hostname: string): boolean {
  // threads.com (現行) と threads.net (旧ドメイン、リダイレクト元) を両方受け入れる
  return hostname.includes('threads.com') || hostname.includes('threads.net')
}

function isLoggedInUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return isThreadsDomain(u.hostname) && !u.pathname.startsWith('/login')
  } catch {
    return false
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function openLoginWindow(
  sessionDir: string,
  proxy?: ProxyConfig
): Promise<LoginResult> {
  let context: BrowserContext | null = null
  try {
    context = await openLoginBrowser(sessionDir, proxy)

    // launchPersistentContext は起動時に1ページ持っている。
    // context.newPage() すると余分な2枚目タブが開くため、既存ページを再利用する。
    const pages = context.pages()
    const page = pages.length > 0 ? pages[0] : await context.newPage()

    // ウィンドウを前面に持ってくる
    await page.bringToFront().catch(() => {})

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    const username = await waitForLoginCompletion(page)
    await context.close()
    return { success: true, username }
  } catch (err) {
    await context?.close().catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

/**
 * Cookie ベースでログイン完了を検知する。
 * Threads ログイン後に sessionid Cookie が設定されることを利用する。
 */
async function waitForLoginCompletion(page: Page): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false
    let pollInterval: ReturnType<typeof setInterval> | null = null

    const timer = setTimeout(() => {
      if (!done) {
        done = true
        cleanup()
        reject(new Error(`ログインがタイムアウトしました (5分)\n最終URL: ${page.url()}`))
      }
    }, 5 * 60 * 1000)

    const cleanup = () => {
      clearTimeout(timer)
      if (pollInterval) clearInterval(pollInterval)
    }

    const checkCookies = async () => {
      if (done) return
      try {
        const cookies = await page.context().cookies()
        const hasSession = cookies.some(
          (c) =>
            c.name === 'sessionid' &&
            c.value.length > 0 &&
            (c.domain.includes('threads.com') || c.domain.includes('instagram.com'))
        )
        if (!hasSession) return

        done = true
        cleanup()
        try {
          await page.waitForLoadState('domcontentloaded').catch(() => {})
          await page.waitForTimeout(800)
          resolve(await extractUsername(page))
        } catch (err) {
          reject(err)
        }
      } catch { /* context not ready yet, retry */ }
    }

    // 1 秒ごとに Cookie を確認
    pollInterval = setInterval(checkCookies, 1000)

    // ナビゲーション時にも即時チェック
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) checkCookies()
    })

    // 既にセッションがある場合に対応
    checkCookies()
  })
}

async function extractUsername(page: Page): Promise<string> {
  // threads.com と threads.net 両方のドメインに対応
  const urlMatch = page.url().match(/threads\.(?:com|net)\/@([^/?#]+)/)
  if (urlMatch) return urlMatch[1]

  try {
    await page.waitForSelector('a[href*="/@"]', { timeout: 5_000 })
    const href = await page.$eval('a[href*="/@"]', (el) => el.getAttribute('href') ?? '')
    const match = href.match(/@([^/?#]+)/)
    if (match) return match[1]
  } catch { /* ignore */ }

  try {
    const title = await page.title()
    const m = title.match(/@([^\s|]+)/)
    if (m) return m[1]
  } catch { /* ignore */ }

  return 'unknown'
}

// ─── Login status ─────────────────────────────────────────────────────────────

export type AccountStatus = 'active' | 'needs_login' | 'frozen' | 'error'

export interface StatusCheckResult {
  status: AccountStatus
  message?: string
}

// Threads が凍結/制限時に表示するキーワード (英語・日本語)
const FROZEN_KEYWORDS = [
  'account has been disabled',
  'account was disabled',
  'suspended',
  'temporarily blocked',
  'temporarily restricted',
  'アカウントが無効',
  '一時的にブロック',
  '一時的に制限',
  'ご利用いただけません',
  'account disabled',
  'we suspended your account',
]

export async function checkAccountStatus(accountId: number): Promise<StatusCheckResult> {
  try {
    return await withContext(accountId, async (ctx) => {
      const pages = ctx.pages()
      const page = pages.length > 0 ? pages[0] : await ctx.newPage()
      const isNew = pages.length === 0

      try {
        await page.goto(THREADS_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      } catch {
        if (isNew) await page.close().catch(() => {})
        return { status: 'error', message: 'ページの読み込みに失敗しました' }
      }

      const url = page.url()

      // ログインページへリダイレクト → セッション切れ
      if (url.includes('/login')) {
        if (isNew) await page.close().catch(() => {})
        return { status: 'needs_login', message: 'セッションが切れています。再ログインが必要です。' }
      }

      // ページ本文で凍結キーワードを確認
      try {
        const bodyText = await page.evaluate('document.body?.innerText ?? ""') as string
        const isFrozen = FROZEN_KEYWORDS.some((kw) =>
          bodyText.toLowerCase().includes(kw.toLowerCase())
        )
        if (isFrozen) {
          if (isNew) await page.close().catch(() => {})
          return { status: 'frozen', message: 'アカウントが凍結または制限されています。' }
        }
      } catch { /* DOM未準備の場合は無視 */ }

      if (isNew) await page.close().catch(() => {})

      if (isLoggedInUrl(url)) {
        return { status: 'active' }
      }

      return { status: 'error', message: `予期しないURL: ${url}` }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', message: msg }
  }
}

/** 後方互換: boolean を返す旧インターフェース */
export async function checkLoginStatus(accountId: number): Promise<boolean> {
  const result = await checkAccountStatus(accountId)
  return result.status === 'active'
}

// ─── Selector helpers ─────────────────────────────────────────────────────────

/**
 * 複数セレクターを結合して最初に見つかった要素を返す。
 * 全て見つからなかった場合は試したセレクターをエラーメッセージに含める。
 */
async function waitForAny(
  page: Page,
  selectors: string[],
  timeout = 12_000
): Promise<import('playwright').ElementHandle> {
  const combined = selectors.join(', ')
  const el = await page.waitForSelector(combined, { timeout }).catch(() => null)
  if (el) return el
  throw new Error(`要素が見つかりません (${timeout}ms):\n  ${selectors.join('\n  ')}`)
}

// ナビゲーション投稿ボタン（コンポーザーを開く）
const COMPOSE_BTN = [
  '[aria-label="新しいスレッドを作成"]',
  '[aria-label="Create new thread"]',
  '[aria-label="新規スレッド"]',
  '[aria-label="New thread"]',
  '[aria-label="スレッドを作成"]',
  '[aria-label="Create a thread"]',
  'a[href="/compose"]',
  'a[href*="/compose"]',
]

// フィード上部のインライン投稿エリア（ナビボタンが見つからない場合の代替）
const INLINE_COMPOSE = [
  '[placeholder*="スレッドを開始"]',
  '[placeholder*="Start a thread"]',
  '[placeholder*="What\'s new"]',
  '[placeholder*="いま何"]',
  'div[contenteditable="true"][data-lexical-editor]',
]

// テキスト入力エリア（コンポーザー内）
const TEXT_AREA = [
  '[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
  'textarea[placeholder]',
]

// 投稿送信ボタン
const POST_BTN = [
  '[aria-label="投稿する"]',
  '[aria-label="Post"]',
  '[aria-label="投稿"]',
  'button:has-text("投稿する")',
  'button:has-text("投稿")',
  'div[role="button"]:has-text("投稿する")',
  'div[role="button"]:has-text("投稿")',
  'button:has-text("Post")',
]

// ─── Post ─────────────────────────────────────────────────────────────────────

export async function postThread(
  accountId: number,
  content: string,
  mediaPaths: string[] = []
): Promise<PostResult> {
  const cfg = getConfig(accountId)
  return withContext(accountId, async (ctx) => {
    const page = await ctx.newPage()
    try {
      await page.goto(THREADS_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 })

      if (!isLoggedInUrl(page.url())) {
        return { success: false, error: 'ログインが必要です' }
      }

      // ── 操作前ランダムスクロール & 待機 ─────────────────────────────────────
      await randomScroll(page, cfg)
      await randomDelay(page, cfg)

      // ── Step 1: コンポーザーを開く ──────────────────────────────────────────
      const composeNavBtn = await page.waitForSelector(
        COMPOSE_BTN.join(', '),
        { timeout: 8_000 }
      ).catch(() => null)

      if (composeNavBtn) {
        await composeNavBtn.click()
      } else {
        const inlineArea = await page.waitForSelector(
          INLINE_COMPOSE.join(', '),
          { timeout: 8_000 }
        ).catch(() => null)

        if (inlineArea) {
          await inlineArea.click()
        } else {
          await page.goto(`${THREADS_URL}/compose`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        }
      }

      // ── Step 2: テキストエリアにフォーカス後、人間らしくタイプ ───────────────
      const textArea = await waitForAny(page, TEXT_AREA, 12_000)
      await textArea.click()
      await shortDelay(page, cfg)
      await humanType(page, content, cfg)

      // ── Step 3: 画像添付 ────────────────────────────────────────────────────
      for (const mediaPath of mediaPaths) {
        if (fs.existsSync(mediaPath)) {
          const fileInput = await page.$('input[type="file"]')
          if (fileInput) {
            await fileInput.setInputFiles(mediaPath)
            await page.waitForTimeout(1500)
          }
        }
      }

      // ── 投稿前ランダム待機 ───────────────────────────────────────────────────
      await shortDelay(page, cfg)

      // ── Step 4: 投稿ボタンをクリック ────────────────────────────────────────
      const postBtn = await waitForAny(page, POST_BTN, 12_000)
      await postBtn.click()
      await page.waitForTimeout(3000)
      return { success: true }
    } finally {
      await page.close().catch(() => {})
    }
  })
}

// ─── Like ─────────────────────────────────────────────────────────────────────

export async function likePost(
  accountId: number,
  postUrl: string
): Promise<EngagementResult> {
  const cfg = getConfig(accountId)
  return withContext(accountId, async (ctx) => {
    const page = await ctx.newPage()
    try {
      console.log(`[likePost] account=${accountId} url=${postUrl}`)

      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

      const currentUrl = page.url()
      console.log(`[likePost] navigated to: ${currentUrl}`)

      if (!isLoggedInUrl(currentUrl)) {
        console.log(`[likePost] not logged in, url=${currentUrl}`)
        return { status: 'failed', error: 'ログインが必要です' }
      }

      await randomScroll(page, cfg)
      await randomDelay(page, cfg)

      // いいねボタンは div[role="button"] で aria-label を持たない。
      // 内部の svg[aria-label="Like"] / svg[aria-label*="いいね"] を手がかりに
      // :has() で親の div[role="button"] を特定してクリックする。
      const LIKE_BTN_SELECTOR = [
        'div[role="button"]:has(svg[aria-label="Like"])',
        'div[role="button"]:has(svg[aria-label="Unlike"])',
        'div[role="button"]:has(svg[aria-label*="いいね"])',
      ].join(', ')

      const likeBtn = await page.waitForSelector(LIKE_BTN_SELECTOR, { timeout: 12_000 }).catch(() => null)
      console.log(`[likePost] like button: ${likeBtn ? 'found' : 'not found'}`)

      if (!likeBtn) {
        console.log(`[likePost] FAILED: like button not found`)
        return { status: 'failed', error: `いいねボタンが見つかりません (URL: ${currentUrl})` }
      }

      // 内部 SVG の aria-label でいいね済みか判定
      const svgLabel = await likeBtn.evaluate((el) => {
        const svg = el.querySelector('svg[aria-label]')
        return svg ? svg.getAttribute('aria-label') ?? '' : ''
      }).catch(() => '')
      console.log(`[likePost] svg label="${svgLabel}"`)

      if (svgLabel.includes('Unlike') || svgLabel.includes('いいね済み')) {
        return { status: 'already_done' }
      }

      await likeBtn.click()
      await shortDelay(page, cfg)
      console.log(`[likePost] done`)
      return { status: 'done' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[likePost] exception: ${msg}`)
      return { status: 'failed', error: msg }
    } finally {
      await page.close().catch(() => {})
    }
  })
}

// ─── Repost ───────────────────────────────────────────────────────────────────

export async function repostPost(
  accountId: number,
  postUrl: string
): Promise<EngagementResult> {
  const cfg = getConfig(accountId)
  return withContext(accountId, async (ctx) => {
    const page = await ctx.newPage()
    try {
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

      if (!isLoggedInUrl(page.url())) {
        return { status: 'failed', error: 'ログインが必要です' }
      }

      // ── 操作前ランダムスクロール & 待機 ─────────────────────────────────────
      await randomScroll(page, cfg)
      await randomDelay(page, cfg)

      // リポストボタンも同様に div[role="button"]:has(svg[...]) で取得
      const REPOST_BTN_SELECTOR = [
        'div[role="button"]:has(svg[aria-label="Repost"])',
        'div[role="button"]:has(svg[aria-label="Undo repost"])',
        'div[role="button"]:has(svg[aria-label*="リポスト"])',
        'div[role="button"]:has(svg[aria-label*="再投稿"])',
      ].join(', ')

      const repostBtn = await page.waitForSelector(REPOST_BTN_SELECTOR, { timeout: 12_000 }).catch(() => null)

      if (!repostBtn) {
        return { status: 'failed', error: `リポストボタンが見つかりません (URL: ${page.url()})` }
      }

      const svgLabel = await repostBtn.evaluate((el) => {
        const svg = el.querySelector('svg[aria-label]')
        return svg ? svg.getAttribute('aria-label') ?? '' : ''
      }).catch(() => '')

      if (svgLabel.includes('Undo repost') || svgLabel.includes('リポスト済み')) {
        return { status: 'already_done' }
      }

      await repostBtn.click()

      // 確認モーダルが出る場合（モーダル内ボタンも同様の構造）
      try {
        const confirmBtn = await page.waitForSelector(
          'div[role="button"]:has(svg[aria-label="Repost"]), div[role="button"]:has(svg[aria-label*="リポスト"])',
          { timeout: 3_000 }
        )
        await confirmBtn.click()
      } catch { /* モーダルなし */ }

      await shortDelay(page, cfg)
      return { status: 'done' }
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
    } finally {
      await page.close().catch(() => {})
    }
  })
}
