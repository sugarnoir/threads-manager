import { BrowserContext, Page } from 'playwright'
import { withContext, openLoginBrowser, ProxyConfig } from './browser-manager'
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
const TEXT_AREA = [
  'div[data-lexical-editor="true"]',                          // ✓ 確認済み（最優先）
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
        await page.waitForTimeout(1000)
      } else {
        // Lexical editor のインラインエリアをクリック → モーダルが開く
        const inlineArea = await page.waitForSelector(
          INLINE_COMPOSE.join(', '),
          { timeout: 12_000 }
        ).catch(() => null)

        if (inlineArea) {
          await inlineArea.click()
          // モーダルアニメーション完了を待機
          await page.waitForTimeout(1200)
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
 * Threads の「予約投稿」機能を使って投稿を予約する。
 * scheduledAt は JST の Date オブジェクトで渡す。
 */
export async function scheduleThread(
  accountId: number,
  content: string,
  scheduledAt: Date,
  mediaPaths: string[] = []
): Promise<PostResult> {
  console.log(`[scheduleThread] START account=${accountId} scheduledAt=${scheduledAt.toISOString()}`)

  // 全体タイムアウト: 120秒
  const timeoutPromise = new Promise<PostResult>((_, reject) =>
    setTimeout(() => reject(new Error('タイムアウト: 予約処理が120秒を超えました。ネットワーク接続またはPlaywrightの状態を確認してください。')), 120_000)
  )

  // 画像パスを事前解決（URL はダウンロード）
  const tmpPaths: string[] = []
  const resolvedMedia: string[] = []
  for (const p of mediaPaths) {
    const local = await resolveToLocalPath(p, tmpPaths)
    if (local) resolvedMedia.push(local)
  }
  console.log(`[scheduleThread] resolvedMedia=${resolvedMedia.length} (requested=${mediaPaths.length})`)

  const task = withContext(accountId, async (ctx) => {
    const page = await ctx.newPage()
    try {
      console.log(`[scheduleThread] page.goto ${THREADS_URL}`)
      await page.goto(THREADS_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 })

      const currentUrl = page.url()
      console.log(`[scheduleThread] loaded url=${currentUrl}`)

      if (!isLoggedInUrl(currentUrl)) {
        return { success: false, error: 'ログインが必要です' }
      }

      // ── Step 1: コンポーザーを開く ──────────────────────────────────────────
      console.log('[scheduleThread] Step1: opening composer')
      const composeNavBtn = await page.waitForSelector(
        COMPOSE_BTN.join(', '),
        { timeout: 5_000 }
      ).catch(() => null)

      if (composeNavBtn) {
        await composeNavBtn.click()
        await page.waitForTimeout(1000)
        console.log('[scheduleThread] Step1: compose btn clicked')
      } else {
        // Lexical editor のインラインエリアをクリック → モーダルが開く
        const inlineArea = await page.waitForSelector(
          INLINE_COMPOSE.join(', '),
          { timeout: 12_000 }
        ).catch(() => null)

        if (inlineArea) {
          const label = await inlineArea.getAttribute('aria-label').catch(() => '')
          console.log(`[scheduleThread] Step1: inline area found (aria-label="${label}"), clicking`)
          await inlineArea.click()
          // モーダルアニメーション完了を待機
          await page.waitForTimeout(1200)
          console.log('[scheduleThread] Step1: inline area clicked, waiting for modal')
        } else {
          console.log('[scheduleThread] Step1: navigating to /compose')
          await page.goto(`${THREADS_URL}/compose`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
          await page.waitForTimeout(1000)
        }
      }

      // ── Step 2: テキスト入力（高速モード） ───────────────────────────────────
      console.log('[scheduleThread] Step2: typing content')
      const textArea = await waitForAny(page, TEXT_AREA, 15_000)
      await textArea.click()
      await page.waitForTimeout(300)
      // ユーザー起動の操作なので humanType ではなく高速入力を使用
      await page.keyboard.type(content, { delay: 20 })
      console.log('[scheduleThread] Step2: content typed')

      // ── Step 3: 画像添付 ────────────────────────────────────────────────────
      if (resolvedMedia.length > 0) {
        console.log(`[scheduleThread] Step3: attaching ${resolvedMedia.length} image(s)`)
        for (const mediaPath of resolvedMedia) {
          const fileInput = await page.$('input[type="file"]').catch(() => null)
          if (fileInput) {
            await fileInput.setInputFiles(mediaPath)
            await page.waitForTimeout(1500)
            console.log(`[scheduleThread] Step3: attached ${mediaPath}`)
          } else {
            console.warn('[scheduleThread] Step3: file input not found, skipping image')
          }
        }
      }

      await page.waitForTimeout(400)

      // ── Step 4: dialog内の「もっと見る」をクリック → メニュー表示 ─────────
      console.log('[scheduleThread] Step4: clicking もっと見る in dialog')
      const moreBtnClicked = await page.evaluate(`
        (() => {
          const dialog = document.querySelector('[role="dialog"]')
          if (!dialog) return false
          const svg = Array.from(dialog.querySelectorAll('svg[aria-label="もっと見る"]'))[0]
          if (!svg) return false
          const btn = svg.closest('[role="button"]') || svg.parentElement
          if (btn) { btn.click(); return true }
          return false
        })()
      `)
      if (!moreBtnClicked) {
        return { success: false, error: '「もっと見る」ボタンが見つかりませんでした' }
      }
      await page.waitForTimeout(1000)
      console.log('[scheduleThread] Step4: もっと見る clicked')

      // ── Step 5: 「日時を指定」メニューアイテムをクリック ─────────────────
      console.log('[scheduleThread] Step5: clicking 日時を指定')
      const scheduleMenuItem = await page.waitForSelector(
        '[role="menuitem"]:has-text("日時を指定")',
        { timeout: 5_000 }
      ).catch(() => null)
      if (!scheduleMenuItem) {
        return { success: false, error: '「日時を指定」メニューが見つかりませんでした' }
      }
      await scheduleMenuItem.click()
      await page.waitForTimeout(2000)
      console.log('[scheduleThread] Step5: 日時を指定 clicked')

      // ── Step 6: カレンダーで日時を設定 ───────────────────────────────────
      console.log('[scheduleThread] Step6: setting datetime')
      await setScheduleDateTime(page, scheduledAt)
      console.log('[scheduleThread] Step6: datetime set')

      // ── Step 7: 「完了」ボタンをクリック ─────────────────────────────────
      console.log('[scheduleThread] Step7: clicking 完了')
      const doneBtn = await page.waitForSelector(
        'div[role="button"]:has-text("完了")',
        { timeout: 5_000 }
      ).catch(() => null)
      if (!doneBtn) {
        return { success: false, error: '「完了」ボタンが見つかりませんでした' }
      }
      await doneBtn.click()
      await page.waitForTimeout(1500)
      console.log('[scheduleThread] Step7: 完了 clicked')

      // ── Step 8: 投稿ボタンをクリック ────────────────────────────────────
      console.log('[scheduleThread] Step8: clicking 投稿')
      const postBtn = await page.waitForSelector(
        POST_BTN.join(', '),
        { timeout: 10_000 }
      ).catch(() => null)
      if (!postBtn) {
        return { success: false, error: '投稿ボタンが見つかりませんでした' }
      }
      await postBtn.click()
      await page.waitForTimeout(3000)

      console.log('[scheduleThread] SUCCESS')
      return { success: true }
    } finally {
      await page.close().catch(() => {})
    }
  })

  try {
    return await Promise.race([task, timeoutPromise])
  } finally {
    // ダウンロードした一時ファイルを削除
    for (const tmp of tmpPaths) {
      fs.unlink(tmp, () => {})
    }
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
  await page.waitForSelector('[role="grid"][aria-label="日付を選択"]', { timeout: 10_000 })

  // 現在表示中の月を読み取る（"2026年3月" 形式）
  const getDisplayedYearMonth = async (): Promise<{ year: number; month: number }> => {
    const text = await page.evaluate(`
      (() => {
        const el = document.querySelector('[aria-live="polite"] h2')
        return el ? el.textContent : ''
      })()
    `).catch(() => '') as string
    const m = text.match(/(\d+)年(\d+)月/)
    if (m) return { year: parseInt(m[1]), month: parseInt(m[2]) }
    return { year: 0, month: 0 }
  }

  // 目的の月まで前月/翌月ボタンで移動（最大24回）
  for (let i = 0; i < 24; i++) {
    const { year, month } = await getDisplayedYearMonth()
    if (year === targetYear && month === targetMonth) break

    const isBefore = year < targetYear || (year === targetYear && month < targetMonth)
    if (isBefore) {
      const nextBtn = await page.$('button[aria-label="翌月"]').catch(() => null)
      if (nextBtn) await nextBtn.click()
    } else {
      const prevBtn = await page.$('button[aria-label="前月"]').catch(() => null)
      if (prevBtn) await prevBtn.click()
    }
    await page.waitForTimeout(400)
  }

  // 目的の日付セルをクリック
  const dayClicked = await page.evaluate(`
    (() => {
      const cells = Array.from(document.querySelectorAll('[role="gridcell"]'))
      const target = '${targetDay}'
      for (const cell of cells) {
        const text = (cell.textContent || '').trim()
        if (text === target) { cell.click(); return true }
      }
      return false
    })()
  `)
  if (!dayClicked) {
    console.warn(`[setScheduleDateTime] day ${targetDay} not found in calendar`)
  }
  await page.waitForTimeout(500)

  // 時刻入力
  const hhInput = await page.$('input[placeholder="hh"]').catch(() => null)
  if (hhInput) {
    await hhInput.click({ clickCount: 3 })
    await hhInput.type(String(targetHour).padStart(2, '0'))
    await page.waitForTimeout(200)
  } else {
    console.warn('[setScheduleDateTime] hh input not found')
  }

  const mmInput = await page.$('input[placeholder="mm"]').catch(() => null)
  if (mmInput) {
    await mmInput.click({ clickCount: 3 })
    await mmInput.type(String(targetMin).padStart(2, '0'))
    await page.waitForTimeout(200)
  } else {
    console.warn('[setScheduleDateTime] mm input not found')
  }
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
