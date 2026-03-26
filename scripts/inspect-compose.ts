/**
 * Threads コンポーザー + 日時ピッカー調査スクリプト
 * Usage: npx tsx scripts/inspect-compose.ts
 */
import { chromium } from 'playwright'

const SESSION_DIR = '/Users/amasawa/Library/Application Support/threads-manager/sessions/account-1773645532878'
const THREADS_URL = 'https://www.threads.com'

async function main() {
  console.log('=== Threads Compose Inspector (datetime focus) ===')
  const ctx = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox'],
  })
  const pages = ctx.pages()
  const page = pages.length > 0 ? pages[0] : await ctx.newPage()

  // [1] ページ読み込み
  await page.goto(THREADS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(2000)
  console.log(`[1] URL: ${page.url()}`)

  // [2] コンポーザーを開く
  const trigger = await page.waitForSelector('[aria-label*="テキストフィールド"]', { timeout: 10_000 }).catch(() => null)
  if (!trigger) { console.log('[2] trigger not found'); await ctx.close(); return }
  await trigger.click()
  await page.waitForTimeout(1500)
  console.log('[2] Compose dialog opened')

  // [3] テキスト入力
  const editor = await page.waitForSelector('div[data-lexical-editor="true"]', { timeout: 10_000 }).catch(() => null)
  if (!editor) { console.log('[3] editor not found'); await ctx.close(); return }
  await editor.click()
  await page.waitForTimeout(300)
  await page.keyboard.type('テスト予約投稿', { delay: 30 })
  await page.waitForTimeout(500)
  console.log('[3] Typed text')

  // [4] ダイアログ内の「もっと見る」をクリック
  const moreBtn = await page.evaluate(`
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
  await page.waitForTimeout(1000)
  console.log(`[4] もっと見る clicked: ${moreBtn}`)

  // [5] 「日時を指定...」をクリック
  const scheduleItem = await page.$('[role="menuitem"]:has-text("日時を指定")').catch(() => null)
  if (!scheduleItem) { console.log('[5] 日時を指定 not found'); await ctx.close(); return }
  await scheduleItem.click()
  await page.waitForTimeout(2000)
  console.log('[5] Clicked 日時を指定...')

  // [6] 全インプット要素を取得
  console.log('\n[6] ALL inputs on page:')
  const allInputs = await page.evaluate(`
    JSON.stringify(
      Array.from(document.querySelectorAll('input, select')).map(el => ({
        tag: el.tagName, type: el.getAttribute('type'),
        ariaLabel: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('placeholder'),
        value: el.value?.slice(0, 30),
        name: el.getAttribute('name'),
        id: el.id,
      }))
    )
  `).catch(() => '[]')
  JSON.parse(allInputs as string).forEach((o: Record<string, string>) => console.log('  ', JSON.stringify(o)))

  // [7] 全ダイアログのテキスト
  console.log('\n[7] All dialog texts:')
  const dialogTexts = await page.evaluate(`
    JSON.stringify(
      Array.from(document.querySelectorAll('[role="dialog"]')).map((d, i) => ({
        index: i, text: (d.innerText || '').trim().slice(0, 400)
      }))
    )
  `).catch(() => '[]')
  JSON.parse(dialogTexts as string).forEach((o: Record<string, string>) => console.log('  ', JSON.stringify(o)))

  // [8] hh/mm 周辺HTML
  console.log('\n[8] HTML around hh input (5 levels up):')
  const hhHtml = await page.evaluate(`
    (() => {
      const inp = document.querySelector('input[placeholder="hh"]')
      if (!inp) return 'hh input not found'
      let el = inp
      for (let i = 0; i < 6; i++) { if (el.parentElement) el = el.parentElement }
      return el.innerHTML.slice(0, 4000)
    })()
  `).catch(() => 'error')
  console.log(hhHtml)

  // [9] 全ボタンのテキスト（確認ボタン探し）
  console.log('\n[9] All buttons/interactive elements:')
  const allBtns = await page.evaluate(`
    JSON.stringify(
      Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"]'))
        .map(el => ({ role: el.getAttribute('role'), text: (el.innerText||'').trim().slice(0,60), ariaLabel: el.getAttribute('aria-label') }))
        .filter(o => o.text || o.ariaLabel)
    )
  `).catch(() => '[]')
  JSON.parse(allBtns as string).forEach((o: Record<string, string>) => console.log('  ', JSON.stringify(o)))

  console.log('\n=== Done. Browser stays open. Ctrl+C to exit. ===')
  await new Promise(resolve => setTimeout(resolve, 120_000))
  await ctx.close()
}

main().catch(console.error)
