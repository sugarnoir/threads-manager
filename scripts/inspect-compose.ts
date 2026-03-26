/**
 * Threadsのコンポーザー入力欄セレクターを調査するスクリプト
 * Usage: npx tsx scripts/inspect-compose.ts
 */
import { chromium } from 'playwright'

const SESSION_DIR = '/Users/amasawa/Library/Application Support/threads-manager/sessions/account-1773645532878'
const THREADS_URL = 'https://www.threads.com'

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

async function main() {
  console.log('Launching headful browser...')
  const ctx = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox'],
  })

  const pages = ctx.pages()
  const page = pages.length > 0 ? pages[0] : await ctx.newPage()

  console.log(`Navigating to ${THREADS_URL}...`)
  await page.goto(THREADS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  // JS heavy SPA なので networkidle まで追加待機
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(3000)
  console.log(`URL: ${page.url()}`)

  // コンポーザーボタンを探す
  console.log('\n--- Trying compose buttons ---')
  for (const sel of COMPOSE_BTN) {
    const el = await page.$(sel).catch(() => null)
    if (el) {
      console.log(`FOUND: ${sel}`)
    }
  }

  // ナビゲーション内の全ボタンをリストアップ
  console.log('\n--- All buttons/links with aria-label ---')
  const btns = await page.evaluate(`
    Array.from(document.querySelectorAll('[aria-label]'))
      .filter(el => ['BUTTON','A','DIV'].includes(el.tagName))
      .map(el => el.tagName + ' aria-label="' + el.getAttribute('aria-label') + '"')
  `) as string[]
  console.log(btns.join('\n'))

  // コンポーザーを開く: まず既知のボタンを試し、なければインラインエリアをクリック
  console.log('\n--- Opening composer ---')
  const composeBtn = await page.waitForSelector(COMPOSE_BTN.join(', '), { timeout: 5000 }).catch(() => null)
  if (composeBtn) {
    console.log('Found COMPOSE_BTN, clicking...')
    await composeBtn.click()
  } else {
    // インラインコンポーズエリア（フィード上部の入力欄）を探してクリック
    const inlineSelectors = [
      '[aria-label*="テキストフィールドが空"]',
      '[aria-label*="新しい投稿"]',
      '[aria-label*="スレッドを開始"]',
      '[aria-label*="Start a thread"]',
      '[placeholder*="スレッドを開始"]',
      '[placeholder*="Start a thread"]',
      'div[contenteditable]',
    ]
    const inlineEl = await page.waitForSelector(inlineSelectors.join(', '), { timeout: 8000 }).catch(() => null)
    if (inlineEl) {
      const label = await inlineEl.getAttribute('aria-label').catch(() => '')
      console.log(`Found inline area: aria-label="${label}", clicking...`)
      await inlineEl.click()
    } else {
      console.log('No inline area found either, navigating to /compose')
      await page.goto(`${THREADS_URL}/compose`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    }
  }

  // エディターが開くまで待機
  await page.waitForTimeout(3000)
  console.log(`URL after open: ${page.url()}`)

  // モーダル/ダイアログが開いたか確認
  const modal = await page.$('[role="dialog"], [aria-modal="true"]').catch(() => null)
  console.log(`Modal/dialog found: ${!!modal}`)

  // contenteditable 要素を全て探す
  console.log('\n--- contenteditable elements ---')
  const editables = await page.evaluate(`
    Array.from(document.querySelectorAll('[contenteditable]'))
      .map(el => {
        const attrs = Array.from(el.attributes).map(a => a.name + '="' + a.value + '"').join(' ')
        return el.tagName + '[' + attrs + ']'
      })
  `) as string[]
  console.log(editables.join('\n'))

  // textarea を全て探す
  console.log('\n--- textarea elements ---')
  const textareas = await page.evaluate(`
    Array.from(document.querySelectorAll('textarea'))
      .map(el => {
        const attrs = Array.from(el.attributes).map(a => a.name + '="' + a.value + '"').join(' ')
        return 'TEXTAREA[' + attrs + ']'
      })
  `) as string[]
  console.log(textareas.join('\n'))

  // input[type="text"] を探す
  console.log('\n--- input[type=text] elements ---')
  const inputs = await page.evaluate(`
    Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
      .map(el => {
        const attrs = Array.from(el.attributes).map(a => a.name + '="' + a.value + '"').join(' ')
        return 'INPUT[' + attrs + ']'
      })
  `) as string[]
  console.log(inputs.join('\n'))

  // data-lexical 要素を探す
  console.log('\n--- data-lexical / editor elements ---')
  const lexical = await page.evaluate(`
    Array.from(document.querySelectorAll('[data-lexical-editor], [data-editor], [class*="editor"], [class*="compose"], [class*="text-input"]'))
      .slice(0, 10)
      .map(el => {
        const attrs = Array.from(el.attributes).map(a => a.name + '="' + a.value + '"').join(' ')
        return el.tagName + '[' + attrs.slice(0, 200) + ']'
      })
  `) as string[]
  console.log(lexical.join('\n'))

  // コンポーザーダイアログ内のHTML全体（最初の2000文字）
  console.log('\n--- Composer dialog HTML (first 2000 chars) ---')
  const dialogHtml = await page.evaluate(`
    const dialog = document.querySelector('[role="dialog"], [aria-modal="true"], form')
    dialog ? dialog.innerHTML.slice(0, 2000) : 'no dialog found'
  `) as string
  console.log(dialogHtml)

  console.log('\nBrowser will stay open for manual inspection. Press Ctrl+C to exit.')
  // ブラウザを開いたまま待機
  await new Promise(resolve => setTimeout(resolve, 120_000))
  await ctx.close()
}

main().catch(console.error)
