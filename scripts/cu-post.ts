/**
 * scripts/cu-post.ts
 *
 * Claude Computer Use PoC — Threads 自動投稿スクリプト
 *
 * Claude がスクリーンショットを撮りながら Threads UI を操作して投稿する。
 * Playwright でブラウザを起動し、アプリDBのセッション Cookie を流用する。
 *
 * 実行:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/cu-post.ts
 *   POST_TEXT="投稿テキスト" ACCOUNT_ID=3 npx tsx scripts/cu-post.ts
 */

import Anthropic from '@anthropic-ai/sdk'
import { chromium }  from 'playwright'
import { execSync }  from 'child_process'
import path          from 'path'
import os            from 'os'
import fs            from 'fs'

// ── 設定 ─────────────────────────────────────────────────────────────────────

const ACCOUNT_ID = Number(process.env.ACCOUNT_ID ?? 3)
const POST_TEXT  = process.env.POST_TEXT ?? 'Computer Use PoC テスト投稿 🤖'
const VIEWPORT   = { width: 1280, height: 800 }
const MAX_STEPS  = 30
const DB_PATH    = path.join(
  os.homedir(),
  'Library/Application Support/threads-manager/threads-manager.db',
)

// ── DB ヘルパー ───────────────────────────────────────────────────────────────

function dbQuery(sql: string): string {
  try {
    return execSync(`sqlite3 "${DB_PATH}" "${sql}"`, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

interface RawCookie {
  name: string; value: string; domain?: string | null; path?: string | null
  secure?: boolean | null; httpOnly?: boolean | null
  expirationDate?: number; sameSite?: string | null
}

function loadCookies(accountId: number): RawCookie[] {
  const raw = dbQuery(
    `SELECT value FROM app_settings WHERE key='session_cookies_${accountId}'`,
  )
  if (!raw) { console.warn('[DB] セッション Cookie なし'); return [] }
  return JSON.parse(raw) as RawCookie[]
}

function loadAccount(accountId: number) {
  const row = dbQuery(
    `SELECT proxy_url, proxy_username, proxy_password FROM accounts WHERE id=${accountId}`,
  )
  if (!row) return null
  const [proxy_url, proxy_username, proxy_password] = row.split('|')
  return { proxy_url: proxy_url || null, proxy_username: proxy_username || null, proxy_password: proxy_password || null }
}

function toSameSite(v?: string | null): 'Strict' | 'Lax' | 'None' {
  if (v === 'strict' || v === 'Strict') return 'Strict'
  if (v === 'lax'    || v === 'Lax')    return 'Lax'
  return 'None'
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY が未設定です')

  const anthropic = new Anthropic({ apiKey })
  const account   = loadAccount(ACCOUNT_ID)
  const cookies   = loadCookies(ACCOUNT_ID)

  console.log(`\nAccount ID : ${ACCOUNT_ID}`)
  console.log(`Proxy      : ${account?.proxy_url ?? 'なし'}`)
  console.log(`Cookies    : ${cookies.length} 件`)
  console.log(`投稿テキスト: "${POST_TEXT}"\n`)

  // ── Playwright 起動 ────────────────────────────────────────────────────────

  const browser = await chromium.launch({
    headless: false,          // 画面を表示して確認しやすくする
    slowMo: 50,
    ...(account?.proxy_url ? {
      proxy: {
        server:   account.proxy_url,
        username: account.proxy_username ?? undefined,
        password: account.proxy_password ?? undefined,
      },
    } : {}),
  })

  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/124.0.0.0 Safari/537.36',
  })

  if (cookies.length > 0) {
    const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
    await context.addCookies(
      cookies
        .filter((c) => c.name && c.value && c.domain)
        .map((c) => ({
          name:     c.name,
          value:    c.value,
          domain:   c.domain!,
          path:     c.path    ?? '/',
          secure:   c.secure  ?? true,
          httpOnly: c.httpOnly ?? false,
          expires:  c.expirationDate ?? expiry,
          sameSite: toSameSite(c.sameSite),
        })),
    )
    console.log('Cookie をブラウザにセットしました')
  }

  const page = await context.newPage()
  console.log('threads.com を開いています...')
  await page.goto('https://www.threads.com', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(2000)

  // スクリーンショットを screenshots/ に保存（デバッグ用）
  const ssDir = path.join(__dirname, 'screenshots')
  fs.mkdirSync(ssDir, { recursive: true })

  async function screenshot(label: string): Promise<string> {
    const buf  = await page.screenshot({ type: 'png', fullPage: false })
    const file = path.join(ssDir, `${label}.png`)
    fs.writeFileSync(file, buf)
    console.log(`  📸 ${file}`)
    return buf.toString('base64')
  }

  // ── Computer Use ループ ────────────────────────────────────────────────────

  type BetaMsg = Anthropic.Beta.BetaMessageParam

  const messages: BetaMsg[] = [
    {
      role: 'user',
      content:
        `Threadsに以下のテキストを投稿してください:\n\n"${POST_TEXT}"\n\n` +
        `手順:\n` +
        `1. まずスクリーンショットを撮り現在の画面を確認してください\n` +
        `2. 投稿ボタン（鉛筆アイコン、または画面下部の編集ボタン）をクリック\n` +
        `3. テキストエリアに投稿文を入力\n` +
        `4. 「投稿」ボタンをクリック\n` +
        `5. 投稿完了を確認したら「投稿完了」と返答してください\n` +
        `\nログアウト状態の場合はその旨を教えてください。`,
    },
  ]

  for (let step = 0; step < MAX_STEPS; step++) {
    console.log(`\n${'─'.repeat(50)}`)
    console.log(`Step ${step + 1} / ${MAX_STEPS}`)

    const response = await anthropic.beta.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: [{
        type:               'computer_20241022' as const,
        name:               'computer',
        display_width_px:   VIEWPORT.width,
        display_height_px:  VIEWPORT.height,
      }],
      betas:    ['computer-use-2024-10-22'],
      messages,
    })

    console.log(`stop_reason: ${response.stop_reason}`)

    // assistant の返答をメッセージ履歴に追加
    messages.push({ role: 'assistant', content: response.content as any })

    // テキスト部分をログ出力
    for (const block of response.content) {
      if (block.type === 'text') {
        console.log(`Claude: ${block.text}`)
        if (block.text.includes('投稿完了') || block.text.includes('完了しました')) {
          console.log('\n✅ 投稿完了！')
          await screenshot(`step${step + 1}_done`)
          await page.waitForTimeout(3000)
          await browser.close()
          return
        }
      }
    }

    if (response.stop_reason === 'end_turn') break
    if (response.stop_reason !== 'tool_use')  break

    // ── ツール実行 ─────────────────────────────────────────────────────────

    const toolResults: any[] = []

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue

      const input = block.input as any
      const loc   = input.coordinate
        ? `(${input.coordinate[0]}, ${input.coordinate[1]})`
        : input.text ? `"${String(input.text).slice(0, 60)}"` : ''
      console.log(`  → ${input.action} ${loc}`)

      let content: any

      try {
        switch (input.action) {

          case 'screenshot': {
            const data = await screenshot(`step${step + 1}`)
            content = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }]
            break
          }

          case 'left_click': {
            await page.mouse.click(input.coordinate[0], input.coordinate[1])
            await page.waitForTimeout(400)
            content = 'Clicked.'
            break
          }

          case 'double_click': {
            await page.mouse.dblclick(input.coordinate[0], input.coordinate[1])
            await page.waitForTimeout(400)
            content = 'Double-clicked.'
            break
          }

          case 'right_click': {
            await page.mouse.click(input.coordinate[0], input.coordinate[1], { button: 'right' })
            await page.waitForTimeout(300)
            content = 'Right-clicked.'
            break
          }

          case 'mouse_move': {
            await page.mouse.move(input.coordinate[0], input.coordinate[1])
            content = 'Mouse moved.'
            break
          }

          case 'left_click_drag': {
            const [sx, sy] = input.start_coordinate
            const [ex, ey] = input.coordinate
            await page.mouse.move(sx, sy)
            await page.mouse.down()
            await page.mouse.move(ex, ey, { steps: 10 })
            await page.mouse.up()
            content = 'Dragged.'
            break
          }

          case 'type': {
            await page.keyboard.type(String(input.text), { delay: 40 })
            await page.waitForTimeout(300)
            content = 'Typed.'
            break
          }

          case 'key': {
            await page.keyboard.press(String(input.text))
            await page.waitForTimeout(300)
            content = 'Key pressed.'
            break
          }

          case 'scroll': {
            const [x, y] = input.coordinate
            await page.mouse.move(x, y)
            const sign = (input.direction === 'up' || input.direction === 'left') ? -1 : 1
            const amt  = (input.amount ?? 3) * 120 * sign
            if (input.direction === 'left' || input.direction === 'right') {
              await page.mouse.wheel(amt, 0)
            } else {
              await page.mouse.wheel(0, amt)
            }
            content = 'Scrolled.'
            break
          }

          case 'cursor_position': {
            content = 'Cursor position tracking not available.'
            break
          }

          default:
            console.warn(`  Unknown action: ${input.action}`)
            content = `Unknown action: ${input.action}`
        }
      } catch (err) {
        console.error(`  Action error:`, err)
        content = `Error: ${err}`
      }

      toolResults.push({
        type:        'tool_result',
        tool_use_id: block.id,
        content,
      })
    }

    messages.push({ role: 'user', content: toolResults })
  }

  console.log('\n=== ループ終了 ===')
  await screenshot('final')
  await page.waitForTimeout(5000)
  await browser.close()
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
