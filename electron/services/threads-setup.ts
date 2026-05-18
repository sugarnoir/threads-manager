/**
 * Threads オンボーディング自動セットアップ
 *
 * Playwright の withContext でアカウントのブラウザを開き、
 * Threads のオンボーディングフローを自動完走させる。
 *
 * フロー:
 * 1. threads.com → ログインモーダル「Instagramでログイン」クリック
 * 2. /onboarding/ → プライバシー設定「次へ」
 * 3. Threadsのしくみ → 「Threadsに参加する」
 * 4. onboarding_complete=true → 完了
 */

import { withContext } from '../playwright/browser-manager'
import type { Page } from 'playwright'

export interface SetupResult {
  status: 'completed' | 'skipped' | 'failed'
  error?: string
}

/** タイムアウト時にデバッグ情報をログ出力 */
async function logDebugInfo(page: Page, accountId: number, step: string): Promise<void> {
  try {
    const url = page.url()
    const screenshotPath = `/tmp/threads-setup-${accountId}-${step}-${Date.now()}.png`
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
    console.error(`[threads-setup] DEBUG account=${accountId} step=${step} url=${url} screenshot=${screenshotPath}`)

    // クリック可能な要素を列挙
    const elements = await page.locator('[role="button"], button, a').all()
    const texts = await Promise.all(
      elements.slice(0, 20).map(async (el) => {
        const text = (await el.textContent().catch(() => '')) ?? ''
        const tag = await el.evaluate('e => e.tagName').catch(() => '?')
        const role = await el.getAttribute('role').catch(() => null)
        return `<${tag}${role ? ` role="${role}"` : ''}> "${text.trim().slice(0, 40)}"`
      })
    )
    console.error(`[threads-setup] DEBUG clickable elements:`, texts.join(' | '))
  } catch { /* ignore */ }
}

export async function setupThreadsAccount(accountId: number): Promise<SetupResult> {
  return await withContext(accountId, async (ctx) => {
    const page = await ctx.newPage()

    try {
      // 1. Threads にアクセス
      console.log(`[threads-setup] account=${accountId} navigating to threads.com`)
      await page.goto('https://www.threads.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      })
      await page.waitForTimeout(2000 + Math.random() * 3000)

      // 既に完了済み判定
      const url = page.url()
      if (url.includes('onboarding_complete=true') || url.match(/threads\.com\/@/)) {
        console.log(`[threads-setup] account=${accountId} already set up (url=${url})`)
        return { status: 'skipped' }
      }

      // フィード画面に居る → 既存 Threads 垢
      const hasNav = await page.locator('nav').isVisible({ timeout: 3000 }).catch(() => false)
      if (hasNav && !url.includes('/onboarding')) {
        console.log(`[threads-setup] account=${accountId} already has Threads (nav visible)`)
        return { status: 'skipped' }
      }

      // 2. ログインモーダル (tag非依存: text-based)
      console.log(`[threads-setup] account=${accountId} waiting for login modal`)
      const loginBtn = page.getByText(/Instagramでログイン|Log in with Instagram/).first()
      const hasLogin = await loginBtn.isVisible({ timeout: 15_000 }).catch(() => false)

      if (!hasLogin) {
        const bodyText = await page.textContent('body').catch(() => '') ?? ''
        if (/captcha|認証|verify|安全のため|challenge/i.test(bodyText)) {
          throw new Error('Security challenge detected')
        }
        if (url.includes('/onboarding')) {
          console.log(`[threads-setup] account=${accountId} already on onboarding page`)
        } else {
          await logDebugInfo(page, accountId, 'login-modal')
          throw new Error(`Login modal not found (url=${url})`)
        }
      } else {
        await page.waitForTimeout(1000 + Math.random() * 2000)
        await loginBtn.click({ force: true })
        console.log(`[threads-setup] account=${accountId} clicked login`)
      }

      // 3. プライバシー設定画面
      console.log(`[threads-setup] account=${accountId} waiting for onboarding`)
      await page.waitForURL(/\/onboarding/, { timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(2000 + Math.random() * 3000)

      const hasPrivacy = await page.getByText(/プライバシー設定|Privacy settings/).first()
        .isVisible({ timeout: 10_000 }).catch(() => false)

      if (hasPrivacy) {
        // 「次へ」: tag/role 非依存、テキストマッチ
        const nextBtn = page.getByText(/^次へ$|^Next$/).last()
        try {
          await page.waitForTimeout(1000 + Math.random() * 2000)
          await nextBtn.click({ force: true, timeout: 15_000 })
          console.log(`[threads-setup] account=${accountId} clicked next (privacy)`)
        } catch {
          await logDebugInfo(page, accountId, 'privacy-next')
          throw new Error('次へ button click failed on privacy page')
        }
      }

      // 4. 規約画面
      await page.waitForTimeout(2000 + Math.random() * 3000)

      const hasAbout = await page.getByText(/Threadsのしくみ|How Threads works/).first()
        .isVisible({ timeout: 10_000 }).catch(() => false)

      if (hasAbout) {
        const joinBtn = page.getByText(/Threadsに参加する|Join Threads/).first()
        try {
          await page.waitForTimeout(1000 + Math.random() * 2000)
          await joinBtn.click({ force: true, timeout: 15_000 })
          console.log(`[threads-setup] account=${accountId} clicked join`)
        } catch {
          await logDebugInfo(page, accountId, 'join-threads')
          throw new Error('Threadsに参加する button click failed')
        }
      }

      // 5. 完了判定
      try {
        await page.waitForURL(/onboarding_complete=true/, { timeout: 30_000 })
        console.log(`[threads-setup] account=${accountId} onboarding complete!`)
        return { status: 'completed' }
      } catch {
        const finalUrl = page.url()
        if (finalUrl.match(/threads\.com\/@/) || finalUrl === 'https://www.threads.com/') {
          console.log(`[threads-setup] account=${accountId} completed (feed reached)`)
          return { status: 'completed' }
        }
        await logDebugInfo(page, accountId, 'completion')
        throw new Error(`Onboarding did not complete (url=${finalUrl})`)
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const finalUrl = page.url().slice(0, 100)
      console.error(`[threads-setup] account=${accountId} error: ${msg} (url=${finalUrl})`)
      return { status: 'failed', error: `${msg} (url=${finalUrl})` }
    } finally {
      await page.close().catch(() => {})
    }
  })
}
