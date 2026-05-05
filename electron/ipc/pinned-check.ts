/**
 * ピン留め投稿の生存チェック IPC ハンドラ
 *
 * 全垢のプロフィールからピン留め投稿を検出し、
 * 削除されていないか確認する。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getAllAccounts, updatePinnedPostStatus } from '../db/repositories/accounts'
import { withContext } from '../playwright/browser-manager'

const THREADS_BASE = 'https://www.threads.com'

/**
 * プロフィールページからピン留め投稿のURLを取得する。
 * ピンがなければ null を返す。
 */
async function detectPinnedPost(accountId: number, username: string): Promise<string | null> {
  try {
    return await withContext(accountId, async (ctx) => {
      const page = ctx.pages()[0] || await ctx.newPage()
      const isNew = ctx.pages().length === 1 && !page.url().includes('threads.com')

      try {
        await page.goto(`${THREADS_BASE}/@${username}`, {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        })
        await page.waitForTimeout(2000)

        // ピン留めアイコンを持つ投稿のリンクを探す
        const pinnedUrl = await page.evaluate(`(function() {
          // 方法1: ピンアイコンの aria-label で検出
          var pinIcons = document.querySelectorAll('[aria-label*="ピン留め"], [aria-label*="Pinned"], [aria-label*="pinned"]');
          for (var i = 0; i < pinIcons.length; i++) {
            var el = pinIcons[i];
            for (var j = 0; j < 10; j++) {
              el = el ? el.parentElement : null;
              if (!el) break;
              var link = el.querySelector('a[href*="/post/"]');
              if (link) return link.href;
            }
          }
          // 方法2: data-pinned 属性
          var pinned = document.querySelector('[data-pinned="true"]');
          if (pinned) {
            var l = pinned.querySelector('a[href*="/post/"]');
            if (l) return l.href;
          }
          // 方法3: 最初の投稿にピン表示があるか
          var firstPost = document.querySelector('article a[href*="/post/"], div[data-pressable-container] a[href*="/post/"]');
          if (firstPost) {
            var container = firstPost.closest('article') || firstPost.closest('[data-pressable-container]');
            if (container && (container.textContent || '').match(/ピン留め|Pinned/)) {
              return firstPost.href;
            }
          }
          return null;
        })()`) as string | null

        return pinnedUrl
      } finally {
        if (isNew) await page.close().catch(() => {})
      }
    })
  } catch (err) {
    console.error(`[pinnedCheck] detectPinnedPost account=${accountId} error: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/**
 * ピン留め投稿の URL にアクセスして生存確認する。
 */
async function checkPostAlive(accountId: number, postUrl: string): Promise<'alive' | 'deleted' | 'unknown'> {
  try {
    return await withContext(accountId, async (ctx) => {
      const page = ctx.pages()[0] || await ctx.newPage()
      const isNew = ctx.pages().length === 1

      try {
        const resp = await page.goto(postUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        })

        if (!resp) return 'unknown'

        const status = resp.status()
        const finalUrl = page.url()

        // 404 or ログインページリダイレクト → 削除
        if (status === 404) return 'deleted'
        if (finalUrl.includes('/login')) return 'deleted'

        // ページ内に「投稿が見つかりません」等のメッセージがあるか確認
        const isDeleted = await page.evaluate(`(function() {
          var body = (document.body && document.body.textContent) || '';
          return body.indexOf('このページは利用できません') >= 0 ||
                 body.indexOf('ページが見つかりません') >= 0 ||
                 body.indexOf("this page isn't available") >= 0 ||
                 body.indexOf('Sorry, this page') >= 0 ||
                 body.indexOf('このスレッドは利用できません') >= 0;
        })()`).catch(() => false)

        if (isDeleted) return 'deleted'
        if (status >= 200 && status < 400) return 'alive'
        return 'unknown'
      } finally {
        if (isNew) await page.close().catch(() => {})
      }
    })
  } catch {
    return 'unknown'
  }
}

export function registerPinnedCheckHandlers(): void {
  // 全垢一括チェック
  ipcMain.handle('pinned:check-all', async (event) => {
    const accounts = getAllAccounts().filter(a => a.status === 'active')
    const total = accounts.length
    let completed = 0
    const results = { alive: 0, deleted: 0, unknown: 0, no_pin: 0 }

    const sendProgress = (msg: string) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('pinned:progress', { completed, total, message: msg })
      }
    }

    for (const acct of accounts) {
      sendProgress(`チェック中: @${acct.username} (${completed + 1}/${total})`)

      let status: 'alive' | 'deleted' | 'unknown' | null = null
      let pinnedUrl: string | null = acct.pinned_post_url ?? null

      // ピン投稿URLが未取得なら、まずプロフィールから検出
      if (!pinnedUrl) {
        pinnedUrl = await detectPinnedPost(acct.id, acct.username)
      }

      if (pinnedUrl) {
        // ピン投稿の生存確認
        status = await checkPostAlive(acct.id, pinnedUrl)
        if (status === 'alive') results.alive++
        else if (status === 'deleted') results.deleted++
        else results.unknown++
      } else {
        results.no_pin++
      }

      // DB 更新
      updatePinnedPostStatus(acct.id, pinnedUrl, status)
      completed++

      // レート制限対策: 1垢ごとに少し待つ
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000))
    }

    sendProgress('完了')
    return { total, ...results }
  })

  // 単一垢チェック
  ipcMain.handle('pinned:check-one', async (_event, accountId: number) => {
    const acct = getAllAccounts().find(a => a.id === accountId)
    if (!acct) return { success: false, error: 'アカウントが見つかりません' }

    let pinnedUrl = acct.pinned_post_url ?? null
    if (!pinnedUrl) {
      pinnedUrl = await detectPinnedPost(acct.id, acct.username)
    }

    if (!pinnedUrl) {
      updatePinnedPostStatus(acct.id, null, null)
      return { success: true, status: null, message: 'ピン留め投稿なし' }
    }

    const status = await checkPostAlive(acct.id, pinnedUrl)
    updatePinnedPostStatus(acct.id, pinnedUrl, status)
    return { success: true, status, url: pinnedUrl }
  })
}
