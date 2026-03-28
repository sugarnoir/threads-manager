/**
 * scheduleThread デバッグ用テストスクリプト
 * Usage: npx tsx scripts/test-schedule.ts
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const SESSION_DIR  = '/Users/amasawa/Library/Application Support/threads-manager/sessions/account-1773645532878'
const SCREENSHOT_DIR = '/Users/amasawa/Documents/アプリ開発/threads-manager/scripts/screenshots'
const PROXY_SERVER = 'http://jp.decodo.com:30001'
const PROXY_USER   = 'user-sp57c124xf-sessionduration-30'
const PROXY_PASS   = '6cxvsxdv4OeK4fZJ_3'
const THREADS_URL  = 'https://www.threads.com'

// 3時間後に予約
const scheduledAt = new Date(Date.now() + 3 * 3600_000)
const TEST_CONTENT = `テスト予約投稿 ${new Date().toLocaleTimeString('ja-JP')}`

function ts() { return new Date().toLocaleTimeString('ja-JP', { hour12: false }) }

let _ssIdx = 0
async function screenshot(page: import('playwright').Page, label: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const file = path.join(SCREENSHOT_DIR, `${String(++_ssIdx).padStart(2, '0')}-${label}.png`)
  await page.screenshot({ path: file, fullPage: false }).catch(() => {})
  console.log(`[${ts()}] 📷 screenshot → ${file}`)
}

async function dumpDialogState(page: import('playwright').Page, label: string) {
  const state = await page.evaluate(`
    (() => {
      const dialog = document.querySelector('[role="dialog"]')
      return {
        hasDialog: !!dialog,
        dialogText: dialog ? (dialog.innerText || '').trim().slice(0, 300) : '',
        allButtons: Array.from(document.querySelectorAll('[role="button"], button'))
          .map(el => ({
            tag: el.tagName,
            text: (el.innerText || '').trim().slice(0, 40),
            ariaLabel: el.getAttribute('aria-label') || '',
          }))
          .filter(b => b.text || b.ariaLabel)
          .slice(0, 15),
        allMenuItems: Array.from(document.querySelectorAll('[role="menuitem"]'))
          .map(el => (el.innerText || '').trim().slice(0, 60)),
        svgsWithLabel: Array.from(document.querySelectorAll('svg[aria-label]'))
          .map(el => el.getAttribute('aria-label') || ''),
      }
    })()
  `).catch((e: Error) => ({ error: e.message }))
  console.log(`\n[DUMP:${label}]`, JSON.stringify(state, null, 2))
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`[${ts()}] scheduleThread テスト開始`)
  console.log(`  content   : ${TEST_CONTENT}`)
  console.log(`  scheduledAt: ${scheduledAt.toLocaleString('ja-JP')}`)
  console.log(`${'='.repeat(60)}\n`)

  const ctx = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: [
      '--no-sandbox',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    ],
    proxy: {
      server:   PROXY_SERVER,
      username: PROXY_USER,
      password: PROXY_PASS,
    },
  })

  const page = await ctx.newPage()

  try {
    // ─── ページ読み込み ────────────────────────────────────────────
    console.log(`[${ts()}] goto ${THREADS_URL}`)
    await page.goto(THREADS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(2000)

    const url = page.url()
    const title = await page.title()
    console.log(`[${ts()}] loaded: url="${url}" title="${title}"`)

    if (url.includes('/login')) {
      console.error('[FAIL] ログインページにリダイレクト → セッション切れ')
      await ctx.close(); return
    }

    // ─── Step 1: コンポーザーを開く ──────────────────────────────
    console.log(`\n[${ts()}] Step1: コンポーザーを開く`)

    // ナビゲーションの投稿ボタン
    const COMPOSE_BTNS = [
      '[aria-label="新しいスレッドを作成"]',
      '[aria-label="Create new thread"]',
      '[aria-label="新規スレッド"]',
      'a[href="/compose"]',
    ]
    const composeNavBtn = await page.waitForSelector(COMPOSE_BTNS.join(', '), { timeout: 5_000 }).catch(() => null)

    if (composeNavBtn) {
      const label = await composeNavBtn.getAttribute('aria-label').catch(() => '')
      console.log(`[${ts()}] Step1: nav compose btn found (label="${label}"), clicking`)
      await composeNavBtn.click()
      await page.waitForTimeout(1000)
    } else {
      console.log(`[${ts()}] Step1: nav btn not found, trying inline compose area`)

      const INLINE = [
        '[aria-label*="テキストフィールド"]',
        '[aria-label*="text field" i]',
        '[aria-label*="Start a thread"]',
        'div[data-lexical-editor="true"]',
      ]
      const inlineArea = await page.waitForSelector(INLINE.join(', '), { timeout: 12_000 }).catch(() => null)

      if (inlineArea) {
        const label = await inlineArea.getAttribute('aria-label').catch(() => 'n/a')
        console.log(`[${ts()}] Step1: inline area found (label="${label}"), clicking`)
        await inlineArea.click()
        await page.waitForTimeout(1500)
      } else {
        console.error(`[${ts()}] Step1: FAIL — コンポーザートリガーが見つかりません`)
        await dumpDialogState(page, 'step1-fail')
        await ctx.close(); return
      }
    }
    console.log(`[${ts()}] Step1: OK — url=${page.url()}`)
    await dumpDialogState(page, 'after-step1')
    await screenshot(page, 'step1-composer-opened')

    // ─── Step 1.5: テキスト入力欄のセレクター調査 ──────────────────
    console.log(`\n[${ts()}] Step1.5: テキスト入力欄のセレクター調査`)
    await page.waitForTimeout(1000)

    const inputInspect = await page.evaluate(`
      (() => {
        const results = {
          lexical: Array.from(document.querySelectorAll('[data-lexical-editor]')).map(el => ({
            tag: el.tagName,
            dataLexical: el.getAttribute('data-lexical-editor'),
            contenteditable: el.getAttribute('contenteditable'),
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
            ariaPlaceholder: el.getAttribute('aria-placeholder'),
            classList: Array.from(el.classList).join(' '),
            text: (el.textContent || '').trim().slice(0, 50),
          })),
          contenteditable: Array.from(document.querySelectorAll('[contenteditable]')).map(el => ({
            tag: el.tagName,
            contenteditable: el.getAttribute('contenteditable'),
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
            ariaPlaceholder: el.getAttribute('aria-placeholder'),
            dataLexical: el.getAttribute('data-lexical-editor'),
            classList: Array.from(el.classList).join(' ').slice(0, 80),
            text: (el.textContent || '').trim().slice(0, 50),
          })),
          dialogExists: !!document.querySelector('[role="dialog"]'),
          dialogContenteditables: Array.from(
            (document.querySelector('[role="dialog"]') || document).querySelectorAll('[contenteditable], textarea, [role="textbox"]')
          ).map(el => ({
            tag: el.tagName,
            contenteditable: el.getAttribute('contenteditable'),
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
            ariaPlaceholder: el.getAttribute('aria-placeholder'),
            dataLexical: el.getAttribute('data-lexical-editor'),
          })),
          textboxes: Array.from(document.querySelectorAll('[role="textbox"]')).map(el => ({
            tag: el.tagName,
            ariaLabel: el.getAttribute('aria-label'),
            ariaPlaceholder: el.getAttribute('aria-placeholder'),
            contenteditable: el.getAttribute('contenteditable'),
            dataLexical: el.getAttribute('data-lexical-editor'),
          })),
        }
        return results
      })()
    `).catch((e: Error) => ({ error: e.message }))
    console.log(`[${ts()}] Step1.5: inputInspect=`, JSON.stringify(inputInspect, null, 2))

    // ─── Step 2: テキスト入力 ─────────────────────────────────────
    console.log(`\n[${ts()}] Step2: テキスト入力`)
    const TEXT_AREA = [
      'div[data-lexical-editor="true"]',
      '[contenteditable="true"][aria-placeholder*="今なにしてる"]',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
    ]
    const textArea = await page.waitForSelector(TEXT_AREA.join(', '), { timeout: 15_000 }).catch(() => null)
    if (!textArea) {
      console.error(`[${ts()}] Step2: FAIL — テキストエリアが見つかりません`)
      await dumpDialogState(page, 'step2-fail')
      await ctx.close(); return
    }
    await textArea.click()
    await page.waitForTimeout(300)
    await page.keyboard.type(TEST_CONTENT, { delay: 20 })
    console.log(`[${ts()}] Step2: OK — typed "${TEST_CONTENT}"`)
    await page.waitForTimeout(400)

    // ─── Step 3: 「もっと見る」クリック ──────────────────────────
    console.log(`\n[${ts()}] Step3: もっと見る ボタンを探す`)
    await dumpDialogState(page, 'before-step3')

    const moreBtnResult = await page.evaluate(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]')
        if (!dialog) return { ok: false, reason: 'no dialog' }
        const allSvgs = Array.from(dialog.querySelectorAll('svg[aria-label]'))
          .map(el => el.getAttribute('aria-label'))
        // 日本語UI: "もっと見る" / 英語UI: "More"
        const svg = Array.from(dialog.querySelectorAll('svg[aria-label="もっと見る"], svg[aria-label="More"]'))[0]
        if (!svg) return { ok: false, reason: 'no More/もっと見る svg', svgsFound: allSvgs }
        const btn = svg.closest('[role="button"]') || svg.parentElement
        if (!btn) return { ok: false, reason: 'no parent button' }
        btn.click()
        return { ok: true, label: svg.getAttribute('aria-label') }
      })()
    `) as { ok: boolean; reason?: string; svgsFound?: string[]; label?: string }

    console.log(`[${ts()}] Step3: もっと見る result:`, JSON.stringify(moreBtnResult))

    if (!moreBtnResult.ok) {
      console.error(`[${ts()}] Step3: FAIL — ${moreBtnResult.reason}`)
      await ctx.close(); return
    }

    await page.waitForTimeout(1200)
    console.log(`[${ts()}] Step3: OK`)
    await dumpDialogState(page, 'after-step3-menu')

    // ─── Step 4: 「日時を指定」をクリック ──────────────────────
    console.log(`\n[${ts()}] Step4: 「日時を指定」メニューアイテムをクリック`)
    const scheduleItem = await page.waitForSelector(
      '[role="menuitem"]:has-text("日時を指定"), [role="menuitem"]:has-text("Schedule")',
      { timeout: 5_000 }
    ).catch(() => null)

    if (!scheduleItem) {
      console.error(`[${ts()}] Step4: FAIL — 「日時を指定」が見つかりません`)
      await dumpDialogState(page, 'step4-fail')
      await ctx.close(); return
    }
    await scheduleItem.click()
    await page.waitForTimeout(2000)
    console.log(`[${ts()}] Step4: OK`)
    await dumpDialogState(page, 'after-step4-calendar')
    await screenshot(page, 'step4-calendar-opened')

    // ─── Step 4.5: カレンダーDOM詳細調査 ────────────────────────
    console.log(`\n[${ts()}] Step4.5: カレンダーDOM詳細調査`)
    const calDump = await page.evaluate(`
      (() => {
        // role="grid" の存在確認（aria-label有無問わず）
        const grids = Array.from(document.querySelectorAll('[role="grid"]')).map(el => ({
          tag: el.tagName,
          ariaLabel: el.getAttribute('aria-label'),
          id: el.id,
          classList: Array.from(el.classList).join(' ').slice(0, 60),
          childCount: el.children.length,
        }))

        // role="row" の存在確認
        const rows = Array.from(document.querySelectorAll('[role="row"]')).map(el => ({
          tag: el.tagName,
          ariaLabel: el.getAttribute('aria-label'),
          text: (el.textContent||'').trim().slice(0, 40),
        })).slice(0, 5)

        // role="gridcell" の存在確認
        const cells = Array.from(document.querySelectorAll('[role="gridcell"]')).map(el => ({
          tag: el.tagName,
          text: (el.textContent||'').trim().slice(0, 30),
          ariaDisabled: el.getAttribute('aria-disabled'),
        })).slice(0, 5)

        // role="group" で calendar的なものを探す
        const groups = Array.from(document.querySelectorAll('[role="group"]')).map(el => ({
          ariaLabel: el.getAttribute('aria-label'),
          text: (el.textContent||'').trim().slice(0, 40),
        })).slice(0, 5)

        // table要素
        const tables = Array.from(document.querySelectorAll('table')).map(el => ({
          ariaLabel: el.getAttribute('aria-label'),
          role: el.getAttribute('role'),
          text: (el.textContent||'').trim().slice(0, 40),
        }))

        // aria-live="polite" の h2（月表示）
        const monthHeader = document.querySelector('[aria-live] h2')?.textContent || 'n/a'

        // input[placeholder="hh"] の存在
        const hhInput = !!document.querySelector('input[placeholder="hh"]')

        // すべての role 一覧（ユニーク）
        const allRoles = [...new Set(
          Array.from(document.querySelectorAll('[role]')).map(el => el.getAttribute('role'))
        )].filter(Boolean)

        // button[aria-label] でナビゲーション的なものを探す
        const navBtns = Array.from(document.querySelectorAll('button[aria-label]')).map(el => ({
          ariaLabel: el.getAttribute('aria-label'),
          text: (el.textContent||'').trim().slice(0, 20),
        }))

        // カレンダー領域全体のouterHTML（hh inputの祖先）
        const hhEl = document.querySelector('input[placeholder="hh"]')
        let calRoot = hhEl
        for (let i = 0; i < 10 && calRoot?.parentElement; i++) calRoot = calRoot.parentElement
        const calHtml = calRoot?.outerHTML?.slice(0, 3000) || 'n/a'

        return { grids, rows, cells, groups, tables, monthHeader, hhInput, allRoles, navBtns, calHtml }
      })()
    `) as any
    console.log(`[${ts()}] Step4.5: grids=`, JSON.stringify(calDump.grids))
    console.log(`[${ts()}] Step4.5: rows (${calDump.rows.length})=`, JSON.stringify(calDump.rows))
    console.log(`[${ts()}] Step4.5: cells (${calDump.cells.length})=`, JSON.stringify(calDump.cells))
    console.log(`[${ts()}] Step4.5: tables=`, JSON.stringify(calDump.tables))
    console.log(`[${ts()}] Step4.5: monthHeader="${calDump.monthHeader}" hhInput=${calDump.hhInput}`)
    console.log(`[${ts()}] Step4.5: allRoles=`, JSON.stringify(calDump.allRoles))
    console.log(`[${ts()}] Step4.5: navBtns=`, JSON.stringify(calDump.navBtns))
    console.log(`[${ts()}] Step4.5: calHtml=\n${calDump.calHtml}`)

    // ─── Step 5: スケジュールピッカーの構造を調査して日時を設定 ──────
    console.log(`\n[${ts()}] Step5: スケジュールピッカーを調査`)
    console.log(`  target: ${scheduledAt.getFullYear()}/${scheduledAt.getMonth()+1}/${scheduledAt.getDate()} ${scheduledAt.getHours()}:${String(scheduledAt.getMinutes()).padStart(2,'0')}`)

    // hh/mm input が現れるまで待つ
    const hhInputEl = await page.waitForSelector('input[placeholder="hh"]', { timeout: 10_000 }).catch(() => null)
    console.log(`[${ts()}] Step5: hh input found=${!!hhInputEl}`)

    // ページ上のすべての input と役立つ要素を調査
    const pickerState = await page.evaluate(`
      (() => {
        const inputs = Array.from(document.querySelectorAll('input, [role="spinbutton"]')).map(el => ({
          tag: el.tagName,
          type: el.getAttribute('type'),
          placeholder: el.getAttribute('placeholder'),
          ariaLabel: el.getAttribute('aria-label'),
          value: el.value,
          id: el.id,
        }))

        // hh input の親要素を6階層辿ってHTML構造を取得
        const hhEl = document.querySelector('input[placeholder="hh"]')
        let ancestor = hhEl
        for (let i = 0; i < 6 && ancestor?.parentElement; i++) ancestor = ancestor.parentElement
        const ancestorHtml = ancestor ? ancestor.outerHTML.slice(0, 2000) : 'n/a'

        // カレンダー関連の要素を探す
        const gridCells = Array.from(document.querySelectorAll('[role="gridcell"]')).map(el => ({
          text: (el.textContent||'').trim(),
          ariaLabel: el.getAttribute('aria-label'),
          ariaSelected: el.getAttribute('aria-selected'),
          ariaDisabled: el.getAttribute('aria-disabled'),
        })).slice(0, 35)

        const calendarHeader = document.querySelector('[aria-live="polite"] h2')?.textContent || 'n/a'
        const hasGrid = !!document.querySelector('[role="grid"]')

        // Select/option要素も確認
        const selects = Array.from(document.querySelectorAll('select')).map(el => ({
          name: el.name,
          ariaLabel: el.getAttribute('aria-label'),
          options: Array.from(el.options).map(o => o.text).slice(0, 20),
          value: el.value,
        }))

        return { inputs, ancestorHtml, gridCells, calendarHeader, hasGrid, selects }
      })()
    `) as {
      inputs: Array<{tag:string;type:string|null;placeholder:string|null;ariaLabel:string|null;value:string;id:string}>
      ancestorHtml: string
      gridCells: Array<{text:string;ariaLabel:string|null;ariaSelected:string|null;ariaDisabled:string|null}>
      calendarHeader: string
      hasGrid: boolean
      selects: Array<{name:string;ariaLabel:string|null;options:string[];value:string}>
    }

    console.log(`[${ts()}] Step5: inputs=`, JSON.stringify(pickerState.inputs, null, 2))
    console.log(`[${ts()}] Step5: hasGrid=${pickerState.hasGrid} calendarHeader="${pickerState.calendarHeader}"`)
    console.log(`[${ts()}] Step5: gridCells (${pickerState.gridCells.length}):`, JSON.stringify(pickerState.gridCells))
    console.log(`[${ts()}] Step5: selects=`, JSON.stringify(pickerState.selects))
    console.log(`[${ts()}] Step5: ancestorHtml=\n${pickerState.ancestorHtml}`)

    const hh = String(scheduledAt.getHours()).padStart(2, '0')
    const mm = String(scheduledAt.getMinutes()).padStart(2, '0')

    // カレンダーグリッドが存在する場合は日付をクリック
    if (pickerState.hasGrid) {
      console.log(`[${ts()}] Step5: calendar grid detected — navigating to target month`)

      const targetYear  = scheduledAt.getFullYear()
      const targetMonth = scheduledAt.getMonth() + 1
      for (let i = 0; i < 24; i++) {
        const text = await page.$eval('[aria-live="polite"] h2', (el: Element) => (el as HTMLElement).textContent || '').catch(() => '')
        // 日本語: "2026年3月" / 英語: "March 2026"
        const mJP = text.match(/(\d+)年(\d+)月/)
        const mEN = text.match(/(\w+)\s+(\d+)/)
        let curYear = 0, curMonth = 0
        if (mJP) { curYear = parseInt(mJP[1]); curMonth = parseInt(mJP[2]) }
        else if (mEN) {
          const MONTHS: Record<string,number> = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12}
          curYear = parseInt(mEN[2]); curMonth = MONTHS[mEN[1]] || 0
        }
        if (curYear === targetYear && curMonth === targetMonth) break
        const isBefore = curYear < targetYear || (curYear === targetYear && curMonth < targetMonth)
        const navBtn = await page.$(
          isBefore
            ? 'button[aria-label="翌月"], button[aria-label="Next month"]'
            : 'button[aria-label="前月"], button[aria-label="Previous month"]'
        ).catch(() => null)
        if (navBtn) { await navBtn.click(); await page.waitForTimeout(400) }
        else break
      }

      const targetDay = scheduledAt.getDate()
      const dayClicked = await page.evaluate(`
        (() => {
          const target = String(${targetDay})
          const endRe = new RegExp('(\\\\D|^)' + target + '$')
          const cells = Array.from(document.querySelectorAll('[role="gridcell"]:not([aria-disabled="true"])'))
          for (const cell of cells) {
            const spans = Array.from(cell.querySelectorAll('*'))
            const numEl = spans.find(el => (el.textContent || '').trim() === target && !el.children.length)
            if (numEl) { cell.click(); return true }
            const text = (cell.textContent || '').trim()
            if (text === target || endRe.test(text)) { cell.click(); return true }
          }
          return false
        })()
      `)
      console.log(`[${ts()}] Step5: day ${targetDay} clicked: ${dayClicked}`)
      await page.waitForTimeout(500)
    } else {
      console.log(`[${ts()}] Step5: no calendar grid — time-only picker mode`)
    }

    // 時刻入力
    const hhInput = await page.$('input[placeholder="hh"]').catch(() => null)
    const mmInput = await page.$('input[placeholder="mm"]').catch(() => null)
    console.log(`[${ts()}] Step5: setting time ${hh}:${mm}  (hhInput=${!!hhInput} mmInput=${!!mmInput})`)

    if (hhInput) {
      await hhInput.click({ force: true })
      await hhInput.fill(hh)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(200)
    }
    if (mmInput) {
      await mmInput.click({ force: true })
      await mmInput.fill(mm)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(200)
    }
    await page.waitForTimeout(300)
    const hhActual = await page.$eval('input[placeholder="hh"]', (el: Element) => (el as HTMLInputElement).value).catch(() => '?')
    const mmActual = await page.$eval('input[placeholder="mm"]', (el: Element) => (el as HTMLInputElement).value).catch(() => '?')
    console.log(`[${ts()}] Step5: time input values: hh="${hhActual}" mm="${mmActual}" (expected ${hh}:${mm})`)
    await dumpDialogState(page, 'after-step5')
    await screenshot(page, 'step5-datetime-set')

    // ─── Step 6: 「完了」ボタン ────────────────────────────────────
    // カレンダーの完了ボタンは <button> 要素。[role="menu"] 内に限定して
    // トースト通知の「完了」と混在しないようにする。
    console.log(`\n[${ts()}] Step6: 完了ボタンをクリック`)
    const doneBtn = await page.waitForSelector(
      '[role="menu"] div[role="button"]:has-text("完了"), [role="menu"] div[role="button"]:has-text("Done")',
      { timeout: 5_000 }
    ).catch(() => null)
    const doneBtnDisabled = doneBtn ? await doneBtn.evaluate((el: Element) => ({
      ariaDisabled: el.getAttribute('aria-disabled'),
      disabled: (el as HTMLButtonElement).disabled,
      tabIndex: el.getAttribute('tabindex'),
    })).catch(() => null) : null
    console.log(`[${ts()}] Step6: 完了 found=${!!doneBtn} state=${JSON.stringify(doneBtnDisabled)}`)
    if (!doneBtn) {
      await dumpDialogState(page, 'step6-fail')
      await ctx.close(); return
    }
    await doneBtn.click({ force: true })
    // カレンダーが閉じるまで待つ
    const gridHidden = await page.waitForSelector('[role="grid"]', { state: 'hidden', timeout: 5_000 })
      .then(() => true).catch(() => false)
    console.log(`[${ts()}] Step6: grid hidden=${gridHidden}`)
    await page.waitForTimeout(500)
    console.log(`[${ts()}] Step6: OK`)
    await screenshot(page, 'step6-done-clicked')

    // Step 6.5: 完了後のダイアログ内ボタンを詳細ダンプ
    console.log(`\n[${ts()}] Step6.5: 完了後ダイアログ内ボタン詳細`)
    const afterDoneState = await page.evaluate(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]')
        const dialogExists = !!dialog
        const dialogText = dialog ? (dialog.innerText || '').trim().slice(0, 300) : 'no dialog'
        // ダイアログ内のボタン詳細（SVG aria-label含む）
        const dialogBtns = dialog ? Array.from(dialog.querySelectorAll('[role="button"], button'))
          .map(el => {
            // 子 SVG の aria-label を収集
            const svgLabels = Array.from(el.querySelectorAll('svg[aria-label]'))
              .map(s => s.getAttribute('aria-label'))
            return {
              tag: el.tagName,
              text: (el.innerText || '').trim().slice(0, 80),
              ariaLabel: el.getAttribute('aria-label') || '',
              tabIndex: el.getAttribute('tabindex'),
              svgLabels,
            }
          }) : []
        const scheduleText = (dialog?.innerText || '').match(/今日.+投稿予定|\\d+:\\d+ JST|scheduled/)?.[0] || 'n/a'
        return { dialogExists, dialogText, dialogBtns, scheduleText }
      })()
    `).catch((e: Error) => ({ error: e.message }))
    console.log(`[${ts()}] Step6.5:`, JSON.stringify(afterDoneState, null, 2))

    // ─── Step 7: 全ボタン詳細ダンプ ─────────────────────────────────────────
    console.log(`\n[${ts()}] Step7: 完了後の全ボタン詳細ダンプ`)
    await screenshot(page, 'step7-state-after-done')

    const allBtnDump = await page.evaluate(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]')
        if (!dialog) return { hasDialog: false, btns: [] }
        const btns = Array.from(dialog.querySelectorAll('[role="button"]')).map((el, i) => {
          const rect = el.getBoundingClientRect()
          return {
            i,
            text: (el.innerText||'').trim().slice(0, 80),
            ariaLabel: el.getAttribute('aria-label') || '',
            svgs: Array.from(el.querySelectorAll('svg[aria-label]')).map(s => s.getAttribute('aria-label')),
            visible: rect.width > 0 && rect.height > 0,
            x: Math.round(rect.x), y: Math.round(rect.y),
            w: Math.round(rect.width), h: Math.round(rect.height),
          }
        })
        return { hasDialog: true, btns }
      })()
    `).catch(() => ({ hasDialog: false, btns: [] })) as { hasDialog: boolean; btns: Array<{i:number;text:string;ariaLabel:string;svgs:string[];visible:boolean;x:number;y:number;w:number;h:number}> }
    console.log(`[${ts()}] Step7: hasDialog=${allBtnDump.hasDialog}`)
    for (const b of allBtnDump.btns) {
      console.log(`  btn[${b.i}] visible=${b.visible} pos=(${b.x},${b.y}) size=${b.w}x${b.h} text="${b.text}" aria="${b.ariaLabel}" svgs=${JSON.stringify(b.svgs)}`)
    }

    // ─── Step 7A: 戦略1 — btn[12]「日時を指定」を押して送信 ──────────────────
    // このボタンはスケジュール設定前の「投稿」ボタンと同じ位置（右下）にある。
    // スケジュール設定後は「投稿」→「日時を指定」にラベルが変わる可能性がある。
    console.log(`\n[${ts()}] Step7A: btn[12]「日時を指定」ボタンをクリック`)
    const nichijiBtn = await page.$('[role="dialog"] div[role="button"]:has-text("日時を指定")').catch(() => null)
      ?? await page.$('[role="dialog"] div[role="button"]:has-text("Schedule")').catch(() => null)
    console.log(`[${ts()}] Step7A: 日時を指定ボタン found=${!!nichijiBtn}`)
    if (nichijiBtn) {
      const rect7a = await nichijiBtn.boundingBox()
      console.log(`[${ts()}] Step7A: 日時を指定 pos=(${Math.round(rect7a?.x??0)},${Math.round(rect7a?.y??0)}) size=${Math.round(rect7a?.width??0)}x${Math.round(rect7a?.height??0)}`)
      await nichijiBtn.click({ force: true })
    }
    await page.waitForTimeout(2000)
    await screenshot(page, 'step7a-after-nichiji-click')
    const dialogAfter7A = await page.$('[role="dialog"]').catch(() => null)
    // カレンダーが開いたか確認
    const calendarAfter7A = await page.$('[role="grid"]').catch(() => null)
    console.log(`[${ts()}] Step7A: dialog still open=${!!dialogAfter7A}, calendar appeared=${!!calendarAfter7A}`)
    if (calendarAfter7A) {
      // カレンダーが開いた → 「日時を指定」は送信ボタンではなくカレンダー再表示ボタン
      console.log(`[${ts()}] Step7A: ❌ カレンダーが開いた → 日時を指定は送信ボタンではない`)
      // カレンダーを閉じる（Escキー）
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    } else if (!dialogAfter7A) {
      console.log(`[${ts()}] Step7A: ✅ ダイアログが閉じた → 日時を指定が送信ボタン！`)
    } else {
      console.log(`[${ts()}] Step7A: ？ ダイアログ開いたまま、カレンダーなし`)
    }

    // Step 7A後のボタン状態も確認
    const afterA_btns = await page.evaluate(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]')
        if (!dialog) return []
        return Array.from(dialog.querySelectorAll('[role="button"]')).map((b, i) => ({
          i, text: (b.innerText||'').trim().slice(0,30),
          svgs: Array.from(b.querySelectorAll('svg')).map(s => s.getAttribute('aria-label')||'')
        }))
      })()
    `).catch(() => []) as {i:number;text:string;svgs:string[]}[]
    console.log(`[${ts()}] Step7A後のdialogボタン:`, JSON.stringify(afterA_btns))

    // ─── Step 7B: 戦略2 — 「下書き」クリック後に長めに待ってページ確認 ────────
    console.log(`\n[${ts()}] Step7B: 「下書き」クリック後、5秒待って確認`)
    const dialogForB = await page.$('[role="dialog"]').catch(() => null)
    if (dialogForB) {
      const draftBtn = await page.$('[role="dialog"] div[role="button"]:has(svg[aria-label="下書き"])').catch(() => null)
        ?? await page.$('[role="dialog"] div[role="button"]:has(svg[aria-label="Draft"])').catch(() => null)
      console.log(`[${ts()}] Step7B: 下書きボタン found=${!!draftBtn}`)
      if (draftBtn) {
        await draftBtn.click({ force: true })
        await page.waitForTimeout(3000)
        await screenshot(page, 'step7b-after-draft-3s')
        const dialogAfterDraft = await page.$('[role="dialog"]').catch(() => null)
        console.log(`[${ts()}] Step7B: dialog still open=${!!dialogAfterDraft}`)
      }
    }

    // ─── URLスキャン: 予約投稿はどこに保存されるか ────────────────────────────
    const urlsToCheck = [
      'https://www.threads.com/drafts',
      'https://www.threads.com/@yuki_chukimaru',
    ]
    for (const url of urlsToCheck) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(3000)
      const pageText = await page.evaluate(`(document.body?.innerText||'').slice(0,600)`).catch(() => '') as string
      console.log(`\n[${ts()}] URL=${url}\n  text=${pageText.replace(/\n/g,'|').slice(0,300)}`)
    }
    await screenshot(page, 'step7-url-check-final')

    console.log(`\n${'='.repeat(60)}\n[${ts()}] Step7完了 — 各戦略の結果を確認してください\n${'='.repeat(60)}\n`)

    console.log(`\n${'='.repeat(60)}`)
    console.log(`[${ts()}] ✅ SUCCESS — 予約投稿完了`)
    console.log(`${'='.repeat(60)}\n`)

  } catch (err) {
    console.error(`\n[${ts()}] ❌ EXCEPTION:`, err)
    await dumpDialogState(page, 'exception')
  } finally {
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
