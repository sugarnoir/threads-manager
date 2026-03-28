import { BrowserContext, Page } from 'playwright'
import { withContext, withContextDirect, closeContext, openLoginBrowser, ProxyConfig } from './browser-manager'
import { getAccountById } from '../db/repositories/accounts'
import { SPEED_PRESETS, SpeedPreset, randomDelay, shortDelay, humanType, randomScroll } from './human-behavior'
import fs from 'fs'
import os from 'os'
import path from 'path'

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
 * 複数セレクターを順番に試して最初に見つかった要素を返す。
 *
 * 先頭セレクターを優先（timeout の大半を割り当て）し、
 * 見つからなければ残りのセレクターを短いフォールバックタイムアウトで試す。
 * `waitForSelector('A, B')` はDOM上の出現順で返すため優先度を保証できないが、
 * この実装は配列先頭を確実に優先する。
 */
async function waitForAny(
  page: Page,
  selectors: string[],
  timeout = 12_000
): Promise<import('playwright').ElementHandle> {
  if (selectors.length === 0) throw new Error('waitForAny: セレクターが空です')

  // 先頭セレクターを優先: タイムアウトの大半を使って待つ
  const primaryTimeout = Math.max(timeout - 3_000, Math.floor(timeout * 0.8))
  const primary = await page.waitForSelector(selectors[0], { timeout: primaryTimeout }).catch(() => null)
  if (primary) return primary

  // フォールバック: 残りのセレクターを結合して短いタイムアウトで試す
  if (selectors.length > 1) {
    const fallback = selectors.slice(1).join(', ')
    const el = await page.waitForSelector(fallback, { timeout: 3_000 }).catch(() => null)
    if (el) return el
  }

  throw new Error(`要素が見つかりません (${timeout}ms):\n  ${selectors.join('\n  ')}`)
}

/**
 * Playwright の pointer-event interception チェックを回避するための JS クリック。
 * 上位要素がポインターイベントを横取りする場合に .click() の代わりに使用する。
 * evaluate にブラウザ側コードを文字列で渡して Node.js tsconfig の DOM 型エラーを回避。
 */
async function jsClick(el: import('playwright').ElementHandle): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (el as any).evaluate('node => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }))')
}

/**
 * input 要素を JS でフォーカス・全選択してから Playwright でタイプする。
 * pointer interception を回避するため click({ clickCount: 3 }) の代わりに使用する。
 */
async function jsFocusAndType(el: import('playwright').ElementHandle, text: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (el as any).evaluate('node => { node.focus(); node.select(); }')
  await el.type(text, { delay: 30 })
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

// フィード上部のインライン投稿エリア（クリックでコンポーザーモーダルが開く）
// 調査済み: クリック前は contenteditable 属性なし
// → [aria-label*="テキストフィールド"] が唯一確実に動作するセレクター
const INLINE_COMPOSE = [
  '[aria-label*="テキストフィールド"]',                        // ✓ 確認済み（日本語UI）
  '[aria-label*="text field" i]',                             // 英語UI
  '[aria-label*="Start a thread"]',
  '[aria-label*="スレッドを開始"]',
  'div[data-lexical-editor="true"]',                          // フォールバック（既にモーダルが開いている場合）
  '[contenteditable="true"][role="textbox"]',
]

// テキスト入力エリア（コンポーザーモーダル内）
// 調査済み: data-lexical-editor="true" が確実
// ダイアログ内を優先: モーダルが開いた後もホームのインライン入力欄が DOM に残っており
// dialog スコープなしだと DOM 順でインライン欄が先にマッチしてしまうケースがある
const TEXT_AREA = [
  '[role="dialog"] div[data-lexical-editor="true"]',          // ✓ 最優先: ダイアログ内
  'div[data-lexical-editor="true"]',                          // フォールバック: /compose ページ等
  '[role="dialog"] [contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][aria-placeholder*="今なにしてる"]',
  '[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
  'textarea[placeholder]',
]

// 投稿送信ボタン
// 調査済み: div[role="button"]:has-text("投稿") が確実
const POST_BTN = [
  'div[role="button"]:has-text("投稿する")',
  'div[role="button"]:has-text("投稿")',                      // ✓ 確認済み
  'div[role="button"]:has-text("Post")',
  '[aria-label="投稿する"]',
  '[aria-label="Post"]',
  'button:has-text("投稿する")',
  'button:has-text("投稿")',
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
        { timeout: 5_000 }
      ).catch(() => null)

      if (composeNavBtn) {
        await composeNavBtn.click()
        await page.waitForSelector('[contenteditable="true"]', { timeout: 8_000 }).catch(() => {})
      } else {
        // Lexical editor のインラインエリアをクリック → モーダルが開く
        const inlineArea = await page.waitForSelector(
          INLINE_COMPOSE.join(', '),
          { timeout: 12_000 }
        ).catch(() => null)

        if (inlineArea) {
          await inlineArea.click()
          await page.waitForSelector('[contenteditable="true"]', { timeout: 8_000 }).catch(() => {})
        } else {
          await page.goto(`${THREADS_URL}/compose`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
          await page.waitForTimeout(1000)
        }
      }

      // ── Step 2: テキストエリアにフォーカス後、人間らしくタイプ ───────────────
      const textArea = await waitForAny(page, TEXT_AREA, 15_000)
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

// ─── Proxy error detection ────────────────────────────────────────────────────

/** プロキシ接続失敗を示すエラーメッセージかどうか判定する */
function isProxyError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('err_tunnel_connection_failed') ||
    msg.includes('err_proxy_connection_failed') ||
    msg.includes('err_socks_connection_failed') ||
    msg.includes('err_connection_timed_out') ||
    msg.includes('err_connection_refused') ||
    msg.includes('chrome-error://')
  )
}

// ─── Schedule Post ────────────────────────────────────────────────────────────
// 調査済みフロー:
//   1. [aria-label*="テキストフィールド"] → click → compose modal
//   2. div[data-lexical-editor="true"] → type
//   3. dialog内 svg[aria-label="もっと見る"] の parent[role="button"] → click → menu
//   4. [role="menuitem"]:has-text("日時を指定") → click → calendar picker
//   5. カレンダーで日付選択 + input[placeholder="hh"]/input[placeholder="mm"] で時刻入力
//   6. div[role="button"]:has-text("完了") → click
//   7. div[role="button"]:has-text("投稿") → click → scheduled!

/**
 * 画像パス/URLをローカルファイルパスに解決する。
 * - file://... → プレフィックスを除去
 * - http/https → 一時ファイルにダウンロード（呼び出し元が tmpPaths に追加して後で削除する）
 * - ローカルパス → そのまま
 * 解決できない場合は null を返す。
 */
async function resolveToLocalPath(urlOrPath: string, tmpPaths: string[]): Promise<string | null> {
  if (!urlOrPath) return null

  // file:// → strip prefix
  if (urlOrPath.startsWith('file://')) {
    const local = decodeURIComponent(urlOrPath.replace(/^file:\/\//, ''))
    return fs.existsSync(local) ? local : null
  }

  // http/https → download to temp file
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    try {
      const res = await fetch(urlOrPath)
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      const ext = path.extname(new URL(urlOrPath).pathname) || '.jpg'
      const tmpPath = path.join(os.tmpdir(), `threads-media-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
      fs.writeFileSync(tmpPath, buf)
      tmpPaths.push(tmpPath)
      return tmpPath
    } catch (err) {
      console.warn('[resolveToLocalPath] download failed:', err)
      return null
    }
  }

  // local path
  return fs.existsSync(urlOrPath) ? urlOrPath : null
}

/**
 * scheduleThread のページ操作コア。
 * withContext / withContextDirect どちらからも呼べるよう分離している。
 */
async function scheduleThreadCore(
  page: Page,
  content: string,
  scheduledAt: Date,
  resolvedMedia: string[],
  ctxLabel: string  // ログ識別用 ('proxy' | 'direct')
): Promise<PostResult> {
  console.log(`[scheduleThread/${ctxLabel}] page.goto ${THREADS_URL}`)
  try {
    await page.goto(THREADS_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isProxyError(e)) throw new Error(`PROXY_ERROR: ${msg}`)
    throw e
  }

  const currentUrl = page.url()
  console.log(`[scheduleThread/${ctxLabel}] loaded url=${currentUrl}`)

  // chrome-error:// はプロキシ/ネットワーク障害を示す
  if (currentUrl.startsWith('chrome-error://')) {
    throw new Error(`PROXY_ERROR: navigation failed (${currentUrl})`)
  }

  if (!isLoggedInUrl(currentUrl)) {
    return { success: false, error: 'ログインが必要です' }
  }

  // ── Step 1: コンポーザーを開く ────────────────────────────────────────────
  console.log(`[scheduleThread/${ctxLabel}] Step1: opening composer`)
  const composeNavBtn = await page.waitForSelector(
    COMPOSE_BTN.join(', '),
    { timeout: 5_000 }
  ).catch(() => null)

  if (composeNavBtn) {
    await composeNavBtn.click()
    await page.waitForSelector('[contenteditable="true"]', { timeout: 8_000 }).catch(() => {})
    console.log(`[scheduleThread/${ctxLabel}] Step1: compose btn clicked`)
  } else {
    const inlineArea = await page.waitForSelector(
      INLINE_COMPOSE.join(', '),
      { timeout: 12_000 }
    ).catch(() => null)

    if (inlineArea) {
      const ariaLabel = await inlineArea.getAttribute('aria-label').catch(() => '')
      console.log(`[scheduleThread/${ctxLabel}] Step1: inline area found (aria-label="${ariaLabel}"), clicking`)
      await inlineArea.click()
      await page.waitForSelector('[contenteditable="true"]', { timeout: 8_000 }).catch(() => {})
      console.log(`[scheduleThread/${ctxLabel}] Step1: inline area clicked, waiting for modal`)
    } else {
      console.log(`[scheduleThread/${ctxLabel}] Step1: navigating to /compose`)
      await page.goto(`${THREADS_URL}/compose`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    }
  }

  // ── Step 2: テキスト入力（動的スキャン） ──────────────────────────────────
  console.log(`[scheduleThread/${ctxLabel}] Step2: scanning contenteditable elements`)

  const ceElements = await page.evaluate(`
    (() => {
      return Array.from(document.querySelectorAll('[contenteditable]')).map((el, i) => ({
        index: i,
        tag: el.tagName,
        contenteditable: el.getAttribute('contenteditable'),
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        ariaPlaceholder: el.getAttribute('aria-placeholder'),
        dataLexical: el.getAttribute('data-lexical-editor'),
        inDialog: !!el.closest('[role="dialog"]'),
        visible: el.offsetParent !== null || el.getBoundingClientRect().width > 0,
        text: (el.textContent || '').trim().slice(0, 30),
      }))
    })()
  `) as Array<{
    index: number; tag: string; contenteditable: string | null; role: string | null
    ariaLabel: string | null; ariaPlaceholder: string | null; dataLexical: string | null
    inDialog: boolean; visible: boolean; text: string
  }>

  console.log(`[scheduleThread/${ctxLabel}] Step2: contenteditable elements found:`, JSON.stringify(ceElements, null, 2))

  const best =
    ceElements.find(e => e.inDialog && e.dataLexical === 'true' && e.contenteditable === 'true') ??
    ceElements.find(e => e.inDialog && e.contenteditable === 'true') ??
    ceElements.find(e => e.visible && e.dataLexical === 'true' && e.contenteditable === 'true') ??
    ceElements.find(e => e.visible && e.contenteditable === 'true')

  if (!best) {
    console.warn(`[scheduleThread/${ctxLabel}] Step2: dynamic scan found nothing, falling back to waitForAny`)
    const textArea = await waitForAny(page, TEXT_AREA, 8_000)
    await jsClick(textArea)
    await page.waitForTimeout(100)
    await page.keyboard.type(content, { delay: 20 })
  } else {
    console.log(`[scheduleThread/${ctxLabel}] Step2: using element index=${best.index} inDialog=${best.inDialog} lexical=${best.dataLexical}`)
    const textArea = await page.evaluateHandle(
      `document.querySelectorAll('[contenteditable]')[${best.index}]`
    )
    await (textArea as import('playwright').ElementHandle).click().catch(() => {})
    await page.waitForTimeout(100)
    await page.keyboard.type(content, { delay: 20 })
  }
  console.log(`[scheduleThread/${ctxLabel}] Step2: content typed`)

  // ── Step 3: 画像添付 ────────────────────────────────────────────────────────
  if (resolvedMedia.length > 0) {
    console.log(`[scheduleThread/${ctxLabel}] Step3: attaching ${resolvedMedia.length} image(s)`)
    for (const mediaPath of resolvedMedia) {
      const fileInput = await page.$('input[type="file"]').catch(() => null)
      if (fileInput) {
        await fileInput.setInputFiles(mediaPath)
        await page.waitForTimeout(500)
      } else {
        console.warn(`[scheduleThread/${ctxLabel}] Step3: file input not found, skipping image`)
      }
    }
  }

  // ── Step 4: 「もっと見る / More」をクリック → メニュー表示 ─────────────────
  console.log(`[scheduleThread/${ctxLabel}] Step4: clicking More/もっと見る`)
  const moreBtnClicked = await page.evaluate(`
    (() => {
      const dialog = document.querySelector('[role="dialog"]')
      if (!dialog) return false
      const svg = Array.from(dialog.querySelectorAll('svg[aria-label="もっと見る"], svg[aria-label="More"]'))[0]
      if (!svg) return false
      const btn = svg.closest('[role="button"]') || svg.parentElement
      if (btn) { btn.click(); return true }
      return false
    })()
  `)
  if (!moreBtnClicked) {
    return { success: false, error: '「もっと見る / More」ボタンが見つかりませんでした' }
  }
  await page.waitForSelector('[role="menuitem"]', { timeout: 3_000 }).catch(() => {})
  console.log(`[scheduleThread/${ctxLabel}] Step4: More/もっと見る clicked`)

  // ── Step 5: 「日時を指定 / Schedule」メニューアイテムをクリック ───────────
  console.log(`[scheduleThread/${ctxLabel}] Step5: clicking 日時を指定/Schedule`)
  const scheduleMenuItem = await page.waitForSelector(
    '[role="menuitem"]:has-text("日時を指定"), [role="menuitem"]:has-text("Schedule")',
    { timeout: 5_000 }
  ).catch(() => null)
  if (!scheduleMenuItem) {
    return { success: false, error: '「日時を指定 / Schedule」メニューが見つかりませんでした' }
  }
  await scheduleMenuItem.click()
  await page.waitForSelector('[role="grid"]', { timeout: 5_000 }).catch(() => {})
  console.log(`[scheduleThread/${ctxLabel}] Step5: Schedule/日時を指定 clicked`)

  // ── Step 6: カレンダーで日時を設定 ─────────────────────────────────────────
  console.log(`[scheduleThread/${ctxLabel}] Step6: setting datetime`)
  await setScheduleDateTime(page, scheduledAt)
  console.log(`[scheduleThread/${ctxLabel}] Step6: datetime set`)

  // ── Step 7: 「完了 / Done」ボタンをクリック ─────────────────────────────────
  // カレンダーの完了ボタンは <button> 要素（div[role="button"] ではない）。
  // [role="menu"] 内に限定してトースト通知の「完了」と混在しないようにする。
  console.log(`[scheduleThread/${ctxLabel}] Step7: clicking 完了/Done`)
  const doneBtn = await page.waitForSelector(
    '[role="menu"] div[role="button"]:has-text("完了"), [role="menu"] div[role="button"]:has-text("Done")',
    { timeout: 5_000 }
  ).catch(() => null)
  if (!doneBtn) {
    return { success: false, error: '「完了 / Done」ボタンが見つかりませんでした（[role="menu"] 内）' }
  }
  await doneBtn.click({ force: true })
  // カレンダーが閉じるまで待つ（最大5秒）
  await page.waitForSelector('[role="grid"]', { state: 'hidden', timeout: 5_000 }).catch(() => {
    console.warn(`[scheduleThread/${ctxLabel}] Step7: [role="grid"] still visible after 完了 click`)
  })
  await page.waitForTimeout(800)
  console.log(`[scheduleThread/${ctxLabel}] Step7: 完了/Done clicked`)

  // ── Step 8: 予約確定ボタンをクリック ─────────────────────────────────────
  // スケジュール設定後のコンポーズモーダルでは「投稿」ボタンが「日時を指定」に変わる。
  // 「日時を指定」ボタン（右下、通常の「投稿」と同じ位置）をクリックして予約確定する。
  console.log(`[scheduleThread/${ctxLabel}] Step8: clicking schedule/post btn`)

  const SCHEDULE_BTN = [
    '[role="dialog"] div[role="button"]:has-text("日時を指定")',
    '[role="dialog"] div[role="button"]:has-text("Schedule")',
    '[role="dialog"] div[role="button"]:has-text("スケジュール")',
    '[role="dialog"] div[role="button"]:has-text("予約投稿")',
    '[role="dialog"] div[role="button"]:has-text("投稿する")',
    '[role="dialog"] div[role="button"]:has-text("Post")',
  ]
  const postBtn = await page.waitForSelector(
    SCHEDULE_BTN.join(', '),
    { timeout: 10_000 }
  ).catch(() => null)
  if (!postBtn) {
    const btnText = await page.evaluate(`
      (() => Array.from(document.querySelectorAll('[role="button"]'))
        .map(el => (el.innerText || '').trim()).filter(Boolean).join(' / ')
      )()
    `).catch(() => 'eval error')
    console.error(`[scheduleThread/${ctxLabel}] Step8: schedule btn not found. All buttons: ${btnText}`)
    return { success: false, error: `予約確定ボタンが見つかりませんでした。ボタン一覧: ${btnText}` }
  }
  const foundText = await postBtn.evaluate((el) => (el as any).innerText?.trim() ?? '').catch(() => '')
  console.log(`[scheduleThread/${ctxLabel}] Step8: found btn text="${foundText}"`)
  await page.waitForTimeout(500)
  await postBtn.click({ force: true })
  await page.waitForTimeout(3000)

  console.log(`[scheduleThread/${ctxLabel}] SUCCESS`)
  return { success: true }
}

/**
 * Threads の「予約投稿」機能を使って投稿を予約する。
 * scheduledAt は JST の Date オブジェクトで渡す。
 * プロキシ接続失敗時はプロキシなし直接接続でリトライする。
 */
export async function scheduleThread(
  accountId: number,
  content: string,
  scheduledAt: Date,
  mediaPaths: string[] = []
): Promise<PostResult> {
  const acct = getAccountById(accountId)
  console.log(
    `[scheduleThread] START account=${accountId} scheduledAt=${scheduledAt.toISOString()} ` +
    `proxy=${acct?.proxy_url ?? 'none'}`
  )

  // 画像パスを事前解決（URL はダウンロード）
  const tmpPaths: string[] = []
  const resolvedMedia: string[] = []
  for (const p of mediaPaths) {
    const local = await resolveToLocalPath(p, tmpPaths)
    if (local) resolvedMedia.push(local)
  }
  console.log(`[scheduleThread] resolvedMedia=${resolvedMedia.length} (requested=${mediaPaths.length})`)

  const cleanup = () => { for (const tmp of tmpPaths) fs.unlink(tmp, () => {}) }

  // 全体タイムアウト: 120秒
  const makeTimeout = () => new Promise<PostResult>((_, reject) =>
    setTimeout(() => reject(new Error('タイムアウト: 予約処理が120秒を超えました')), 120_000)
  )

  try {
    // ── 1st try: プロキシあり（通常）─────────────────────────────────────────
    const task = withContext(accountId, async (ctx) => {
      const page = await ctx.newPage()
      try {
        return await scheduleThreadCore(page, content, scheduledAt, resolvedMedia, 'proxy')
      } finally {
        await page.close().catch(() => {})
      }
    })

    try {
      return await Promise.race([task, makeTimeout()])
    } catch (err) {
      if (!isProxyError(err)) throw err

      // ── 2nd try: プロキシなし直接接続（フォールバック）──────────────────────
      console.warn(`[scheduleThread] proxy error detected, retrying without proxy: ${err instanceof Error ? err.message : err}`)
      await closeContext(accountId)

      const directTask = withContextDirect(accountId, async (ctx) => {
        const page = await ctx.newPage()
        try {
          return await scheduleThreadCore(page, content, scheduledAt, resolvedMedia, 'direct')
        } finally {
          await page.close().catch(() => {})
        }
      })

      return await Promise.race([directTask, makeTimeout()])
    }
  } finally {
    cleanup()
  }
}

/**
 * Threads のカレンダー日時ピッカーに scheduledAt を設定するヘルパー。
 *
 * 調査済み UI:
 *   - カレンダーグリッド: [role="grid"][aria-label="日付を選択"]
 *   - 表示中の月: [aria-live="polite"] h2 → "2026年3月" 形式
 *   - 前月/翌月: button[aria-label="前月"] / button[aria-label="翌月"]
 *   - 日付セル: [role="gridcell"] (textContent = "1"〜"31")
 *   - 時刻入力: input[placeholder="hh"] / input[placeholder="mm"]
 */
async function setScheduleDateTime(page: Page, dt: Date): Promise<void> {
  const targetYear  = dt.getFullYear()
  const targetMonth = dt.getMonth() + 1  // 1-12
  const targetDay   = dt.getDate()
  const targetHour  = dt.getHours()
  const targetMin   = dt.getMinutes()

  // カレンダーグリッドが表示されるまで待機
  // 実際の aria-label="日付を選択"（日本語UI確認済み）、aria-label なしの場合も含む
  await page.waitForSelector('[role="grid"]', { timeout: 8_000 })

  // 現在表示中の月を読み取る
  // 日本語: "2026年3月" / 英語: "March 2026"
  const getDisplayedYearMonth = async (): Promise<{ year: number; month: number }> => {
    const text = await page.evaluate(`
      (() => {
        const el = document.querySelector('[aria-live="polite"] h2')
        return el ? el.textContent : ''
      })()
    `).catch(() => '') as string
    // 日本語形式: "2026年3月"
    const jaMatch = text.match(/(\d+)年(\d+)月/)
    if (jaMatch) return { year: parseInt(jaMatch[1]), month: parseInt(jaMatch[2]) }
    // 英語形式: "March 2026" / "March, 2026"
    const enMonths = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const enMatch = text.match(/([A-Za-z]+)[,\s]+(\d{4})/)
    if (enMatch) {
      const monthIdx = enMonths.findIndex(m => m.toLowerCase() === enMatch[1].toLowerCase())
      if (monthIdx >= 0) return { year: parseInt(enMatch[2]), month: monthIdx + 1 }
    }
    return { year: 0, month: 0 }
  }

  // 目的の月まで前月/翌月ボタンで移動（最大24回）
  for (let i = 0; i < 24; i++) {
    const { year, month } = await getDisplayedYearMonth()
    if (year === targetYear && month === targetMonth) break

    const isBefore = year < targetYear || (year === targetYear && month < targetMonth)
    if (isBefore) {
      // 日本語: "翌月" / 英語: "Next month" / "Next Month"
      const nextBtn = await page.$('button[aria-label="翌月"], button[aria-label="Next month"], button[aria-label="Next Month"]').catch(() => null)
      if (nextBtn) await nextBtn.click()
    } else {
      // 日本語: "前月" / 英語: "Previous month" / "Previous Month"
      const prevBtn = await page.$('button[aria-label="前月"], button[aria-label="Previous month"], button[aria-label="Previous Month"]').catch(() => null)
      if (prevBtn) await prevBtn.click()
    }
    await page.waitForTimeout(200)
  }

  // 目的の日付セルをクリック
  // gridcell の textContent は "Friday, March 27, 2026, selected27" のような形式なので
  // disabled でないセルの中から目的の日付を探してクリック
  // gridcell の textContent 形式:
  //   英語: "Friday, March 27, 2026, selected27" / "Saturday, March 28, 2026"
  //   日本語: "2026年3月27日金曜日、選択済み27" / "2026年3月28日土曜日28"
  const dayClicked = await page.evaluate(`
    (() => {
      const target = String(${targetDay})
      // 正規表現: target が非数字の後に来る末尾一致（1桁日 vs 11,21日 の誤マッチを防ぐ）
      const endRe = new RegExp('(\\\\D|^)' + target + '$')
      const cells = Array.from(document.querySelectorAll('[role="gridcell"]:not([aria-disabled="true"])'))
      for (const cell of cells) {
        // まず葉要素でテキストが target のみのものを探す（最も確実）
        const spans = Array.from(cell.querySelectorAll('*'))
        const numEl = spans.find(el => (el.textContent || '').trim() === target && !el.children.length)
        if (numEl) { cell.click(); return true }
        // フォールバック: textContent が正規表現で target で終わる
        const text = (cell.textContent || '').trim()
        if (text === target || endRe.test(text)) {
          cell.click(); return true
        }
      }
      return false
    })()
  `)
  if (!dayClicked) {
    console.warn(`[setScheduleDateTime] day ${targetDay} not found in calendar`)
  }
  await page.waitForTimeout(200)

  // 時刻入力
  // fill() は Playwright が React に正しく onChange を発火させる最も確実な方法。
  // type() は keydown/keyup を発火するが controlled input の state が更新されない場合がある。
  // Tab で次フィールドに移動することで blur/change イベントを確実に発火させる。
  const hhVal = String(targetHour).padStart(2, '0')
  const mmVal = String(targetMin).padStart(2, '0')

  const hhInput = await page.$('input[placeholder="hh"]').catch(() => null)
  if (hhInput) {
    await hhInput.click({ force: true })
    await hhInput.fill(hhVal)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(100)
  } else {
    console.warn('[setScheduleDateTime] hh input not found')
  }

  const mmInput = await page.$('input[placeholder="mm"]').catch(() => null)
  if (mmInput) {
    await mmInput.click({ force: true })
    await mmInput.fill(mmVal)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(100)
  } else {
    console.warn('[setScheduleDateTime] mm input not found')
  }

  // 入力値確認ログ
  const hhActual = await page.$eval('input[placeholder="hh"]', (el: Element) => (el as any).value).catch(() => '?')
  const mmActual = await page.$eval('input[placeholder="mm"]', (el: Element) => (el as any).value).catch(() => '?')
  console.log(`[setScheduleDateTime] time input values: hh="${hhActual}" mm="${mmActual}" (expected ${hhVal}:${mmVal})`)
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
