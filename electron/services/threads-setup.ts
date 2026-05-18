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

export interface SetupResult {
  status: 'completed' | 'skipped' | 'failed'
  error?: string
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

      // 2. ログインモーダル
      console.log(`[threads-setup] account=${accountId} waiting for login modal`)
      const loginBtn = page.locator('text=Instagramでログイン').first()
        .or(page.locator('text=Log in with Instagram').first())
      const hasLogin = await loginBtn.isVisible({ timeout: 15_000 }).catch(() => false)

      if (!hasLogin) {
        // セキュリティチャレンジ検出
        const bodyText = await page.textContent('body').catch(() => '') ?? ''
        if (/captcha|認証|verify|安全のため|challenge/i.test(bodyText)) {
          throw new Error('Security challenge detected')
        }
        // オンボーディングに直接居る場合
        if (url.includes('/onboarding')) {
          console.log(`[threads-setup] account=${accountId} already on onboarding page`)
        } else {
          throw new Error(`Login modal not found (url=${url})`)
        }
      } else {
        await page.waitForTimeout(1000 + Math.random() * 2000)
        await loginBtn.click()
        console.log(`[threads-setup] account=${accountId} clicked login`)
      }

      // 3. プライバシー設定画面
      console.log(`[threads-setup] account=${accountId} waiting for onboarding`)
      await page.waitForURL(/\/onboarding/, { timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(2000 + Math.random() * 3000)

      const privacyTitle = page.locator('text=プライバシー設定').first()
        .or(page.locator('text=Privacy settings').first())
      const hasPrivacy = await privacyTitle.isVisible({ timeout: 10_000 }).catch(() => false)

      if (hasPrivacy) {
        const nextBtn = page.locator('button:has-text("次へ")').last()
          .or(page.locator('button:has-text("Next")').last())
        await page.waitForTimeout(1000 + Math.random() * 2000)
        await nextBtn.click()
        console.log(`[threads-setup] account=${accountId} clicked next (privacy)`)
      }

      // 4. 規約画面
      await page.waitForTimeout(2000 + Math.random() * 3000)

      const aboutTitle = page.locator('text=Threadsのしくみ').first()
        .or(page.locator('text=How Threads works').first())
      const hasAbout = await aboutTitle.isVisible({ timeout: 10_000 }).catch(() => false)

      if (hasAbout) {
        const joinBtn = page.locator('button:has-text("Threadsに参加する")').first()
          .or(page.locator('button:has-text("Join Threads")').first())
        await page.waitForTimeout(1000 + Math.random() * 2000)
        await joinBtn.click()
        console.log(`[threads-setup] account=${accountId} clicked join`)
      }

      // 5. 完了判定
      try {
        await page.waitForURL(/onboarding_complete=true/, { timeout: 30_000 })
        console.log(`[threads-setup] account=${accountId} onboarding complete!`)
        return { status: 'completed' }
      } catch {
        // URL判定失敗でもフィードに居れば成功
        const finalUrl = page.url()
        if (finalUrl.match(/threads\.com\/@/) || finalUrl === 'https://www.threads.com/') {
          console.log(`[threads-setup] account=${accountId} completed (feed reached)`)
          return { status: 'completed' }
        }
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
