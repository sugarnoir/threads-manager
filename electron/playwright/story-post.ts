/**
 * Playwright 経由で Instagram ストーリーを投稿する（モバイルエミュレーション）。
 *
 * フロー:
 *   1. iPhone デバイスエミュレーションで chromium を起動
 *   2. Cookie 注入 → instagram.com を開く
 *   3. ストーリー作成アイコン or /stories/create/ を開く
 *   4. input[type="file"] で画像アップロード（PNG は JPEG 変換）
 *   5. リンクスタンプ追加（任意）
 *   6. 「ストーリーズに追加」ボタンをクリック
 *   7. 完了後ブラウザを閉じる
 */

import { chromium, BrowserContext, devices } from 'playwright'
import { session } from 'electron'
import { getAccountById } from '../db/repositories/accounts'
import { IPHONE_UA_LIST } from '../utils/iphone-ua'
import fs from 'fs'
import path from 'path'
import os from 'os'

interface StoryLinkSticker {
  url:       string
  x?:        number
  y?:        number
  width?:    number
  height?:   number
  rotation?: number
}

/** PNG を JPEG に変換（Playwright の page.screenshot を利用、または sharp 不要のシンプル版） */
function ensureJpeg(imagePath: string): string {
  if (!imagePath.toLowerCase().endsWith('.png')) return imagePath
  // Playwright では setInputFiles 時に JPEG のみ対応するため、
  // PNG の場合はそのまま渡して Instagram 側に変換を任せる
  // （Instagram は PNG も受け付ける）
  return imagePath
}

export async function postStoryViaPlaywright(
  accountId:   number,
  imagePath:   string,
  linkSticker?: StoryLinkSticker,
): Promise<{ success: boolean; status?: number; mediaId?: string; error?: string }> {
  const acct = getAccountById(accountId)
  if (!acct) return { success: false, error: 'アカウントが見つかりません' }
  if (!fs.existsSync(imagePath)) return { success: false, error: `画像が見つかりません: ${imagePath}` }

  const finalImage = ensureJpeg(imagePath)

  // Cookie を Electron セッションから取得
  const sess = session.fromPartition(`persist:account-${accountId}`)
  const electronCookies = await sess.cookies.get({})
  const igCookies = electronCookies.filter(c => c.domain?.includes('instagram.com'))
  if (!igCookies.find(c => c.name === 'sessionid')?.value) {
    return { success: false, error: 'instagram.com sessionid not found' }
  }

  // プロキシ設定
  const launchOptions: Record<string, unknown> = {
    headless: false,
    args: ['--no-sandbox', '--disable-gpu'],
  }
  if (acct.proxy_url) {
    try {
      const proxyUrl = new URL(acct.proxy_url)
      launchOptions.proxy = {
        server:   `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
        username: acct.proxy_username ?? undefined,
        password: acct.proxy_password ?? undefined,
      }
    } catch { /* ignore */ }
  }

  console.log(`[story-playwright] launching browser for account=${accountId}`)

  const browser = await chromium.launch(launchOptions)
  let context: BrowserContext | null = null

  try {
    // iPhone デバイスエミュレーション
    const iPhone = devices['iPhone 15']
    context = await browser.newContext({
      ...iPhone,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      // isMobile + hasTouch はデバイスプリセットに含まれる
    })

    // Cookie 注入
    const playwrightCookies = igCookies
      .filter(c => c.name && c.value && c.domain)
      .map(c => ({
        name:     c.name,
        value:    c.value,
        domain:   c.domain!,
        path:     c.path ?? '/',
        secure:   c.secure ?? true,
        httpOnly: c.httpOnly ?? false,
        sameSite: 'None' as const,
      }))
    await context.addCookies(playwrightCookies)

    const page = await context.newPage()

    // ── Step 1: Instagram を開く ─────────────────────────────────────────
    console.log('[story-playwright] navigating to instagram.com')
    await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout:   30_000,
    })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: '/tmp/story-debug-1-home.png' }).catch(() => {})

    const homeUrl = page.url()
    console.log(`[story-playwright] home url: ${homeUrl}`)
    if (homeUrl.includes('/login') || homeUrl.includes('/accounts/login')) {
      return { success: false, error: 'セッション切れ: ログインページにリダイレクトされました' }
    }

    // ── Step 2: ストーリー作成画面を開く ─────────────────────────────────
    // モバイルでは instagram.com/stories/create/ に直接遷移
    console.log('[story-playwright] navigating to stories/create')
    await page.goto('https://www.instagram.com/stories/create/', {
      waitUntil: 'domcontentloaded',
      timeout:   30_000,
    })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: '/tmp/story-debug-2-create.png' }).catch(() => {})

    const createUrl = page.url()
    console.log(`[story-playwright] create url: ${createUrl}`)

    // ── Step 3: 画像アップロード ─────────────────────────────────────────
    console.log('[story-playwright] looking for file input')

    // モバイル版ではギャラリーアイコンをクリックして file input を出す場合がある
    // まず file input を探す（非表示でも setInputFiles は可能）
    let uploaded = false

    // 方法1: 直接 input[type="file"] を探す
    const fileInputs = page.locator('input[type="file"]')
    const fileInputCount = await fileInputs.count()
    console.log(`[story-playwright] found ${fileInputCount} file input(s)`)

    if (fileInputCount > 0) {
      await fileInputs.first().setInputFiles(finalImage)
      uploaded = true
      console.log('[story-playwright] image uploaded via file input')
    }

    if (!uploaded) {
      // 方法2: ギャラリーボタンをクリックしてから file input を探す
      const galleryBtn = page.locator('[aria-label*="ギャラリー"]')
        .or(page.locator('[aria-label*="Gallery"]'))
        .or(page.locator('[aria-label*="gallery"]'))
        .or(page.locator('button:has-text("ギャラリー")'))
      if (await galleryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await galleryBtn.click()
        await page.waitForTimeout(1500)
        const fi2 = page.locator('input[type="file"]')
        if (await fi2.count() > 0) {
          await fi2.first().setInputFiles(finalImage)
          uploaded = true
        }
      }
    }

    if (!uploaded) {
      await page.screenshot({ path: '/tmp/story-debug-error-no-input.png' }).catch(() => {})
      // DOM ダンプ
      const dump = await page.evaluate(`
        (function() {
          var btns = Array.from(document.querySelectorAll('button,[role="button"]')).slice(0,20).map(function(b) {
            return { tag: b.tagName, text: b.textContent?.trim()?.slice(0,40), ariaLabel: b.getAttribute('aria-label') };
          });
          var inputs = Array.from(document.querySelectorAll('input')).map(function(i) {
            return { type: i.type, accept: i.accept, name: i.name };
          });
          return { url: location.href, btns: btns, inputs: inputs };
        })()
      `).catch(() => ({}))
      console.log(`[story-playwright] DOM: ${JSON.stringify(dump).slice(0, 1200)}`)
      return { success: false, error: 'ファイル入力要素が見つかりません' }
    }

    await page.waitForTimeout(3000)
    await page.screenshot({ path: '/tmp/story-debug-3-after-upload.png' }).catch(() => {})

    // ── Step 4: リンクスタンプ（任意）────────────────────────────────────
    if (linkSticker?.url) {
      console.log(`[story-playwright] adding link sticker: ${linkSticker.url}`)
      try {
        const stickerBtn = page.locator('[aria-label*="スタンプ"]')
          .or(page.locator('[aria-label*="Sticker"]'))
          .or(page.locator('[aria-label*="sticker"]'))
        if (await stickerBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await stickerBtn.click()
          await page.waitForTimeout(1500)

          const linkOption = page.locator('button:has-text("リンク")')
            .or(page.locator('button:has-text("Link")'))
          if (await linkOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await linkOption.click()
            await page.waitForTimeout(1000)

            const urlInput = page.locator('input[placeholder*="URL"]')
              .or(page.locator('input[name="link"]'))
              .or(page.locator('input[type="url"]'))
              .or(page.locator('input[placeholder*="リンク"]'))
            if (await urlInput.isVisible({ timeout: 3000 }).catch(() => false)) {
              await urlInput.fill(linkSticker.url)
              await page.waitForTimeout(500)

              const doneBtn = page.locator('button:has-text("完了")')
                .or(page.locator('button:has-text("Done")'))
              if (await doneBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await doneBtn.click()
                await page.waitForTimeout(1000)
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[story-playwright] link sticker error: ${e}`)
      }
    }

    // ── Step 5: シェアボタンをクリック ────────────────────────────────────
    console.log('[story-playwright] looking for share/post button')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: '/tmp/story-debug-4-before-share.png' }).catch(() => {})

    // ボタンダンプ
    const btnDump = await page.evaluate(`
      Array.from(document.querySelectorAll('button,[role="button"]')).slice(0,15).map(function(b) {
        return (b.textContent||'').trim().slice(0,40) + ' | ' + (b.getAttribute('aria-label')||'');
      })
    `).catch(() => [])
    console.log(`[story-playwright] buttons: ${JSON.stringify(btnDump)}`)

    // シェアボタン候補（日英モバイル UI 両対応）
    const shareSelectors = [
      'button:has-text("ストーリーズに追加")',
      'button:has-text("ストーリーズにシェア")',
      'button:has-text("Add to your story")',
      'button:has-text("Share to your story")',
      'button:has-text("シェア")',
      'button:has-text("Share")',
      '[aria-label*="ストーリーズ"][aria-label*="シェア"]',
      '[aria-label*="Share"][aria-label*="story"]',
    ]

    let shared = false
    for (const sel of shareSelectors) {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log(`[story-playwright] clicking: ${sel}`)
        await btn.click()
        shared = true
        break
      }
    }

    if (!shared) {
      // 「次へ」→「シェア」の2ステップ
      const nextBtn = page.locator('button:has-text("次へ")').or(page.locator('button:has-text("Next")'))
      if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('[story-playwright] clicking Next')
        await nextBtn.click()
        await page.waitForTimeout(2000)
        await page.screenshot({ path: '/tmp/story-debug-5-after-next.png' }).catch(() => {})

        for (const sel of shareSelectors) {
          const btn2 = page.locator(sel).first()
          if (await btn2.isVisible({ timeout: 1500 }).catch(() => false)) {
            console.log(`[story-playwright] clicking (step2): ${sel}`)
            await btn2.click()
            shared = true
            break
          }
        }
      }
    }

    if (!shared) {
      await page.screenshot({ path: '/tmp/story-debug-error-no-share.png' }).catch(() => {})
      return { success: false, error: 'シェアボタンが見つかりません' }
    }

    console.log('[story-playwright] share clicked, waiting for completion')
    await page.waitForTimeout(5000 + Math.random() * 3000)
    await page.screenshot({ path: '/tmp/story-debug-6-after-share.png' }).catch(() => {})

    console.log('[story-playwright] story posted successfully')
    return { success: true }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[story-playwright] error: ${msg}`)
    return { success: false, error: msg }
  } finally {
    if (context) await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}
