import { ipcMain, BrowserWindow } from 'electron'
import { createEngagement, getEngagements } from '../db/repositories/engagements'
import { likePost, repostPost } from '../playwright/threads-client'

export interface EngagementItemResult {
  account_id: number
  status: 'done' | 'failed' | 'already_done'
  error?: string
}

/** 最大 CONCURRENCY 件ずつ並列実行して残りはキューで待つ */
async function runWithConcurrency<T>(
  items: number[],
  concurrency: number,
  fn: (id: number) => Promise<T>
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(items.length)
  let index = 0

  async function worker() {
    while (index < items.length) {
      const i = index++
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

const ENGAGEMENT_CONCURRENCY = 3

export function registerEngagementHandlers(win: BrowserWindow): void {
  ipcMain.handle('engagements:history', () => getEngagements())

  ipcMain.handle(
    'engagements:like',
    async (_event, data: { account_ids: number[]; post_url: string }): Promise<EngagementItemResult[]> => {
      const results = await runWithConcurrency(data.account_ids, ENGAGEMENT_CONCURRENCY, async (accountId) => {
        const result = await likePost(accountId, data.post_url)
        createEngagement({ account_id: accountId, post_url: data.post_url, action: 'like', status: result.status, error_msg: result.error })
        if (!win.isDestroyed()) win.webContents.send('engagement:progress', { account_id: accountId, action: 'like', ...result })
        return { account_id: accountId, ...result }
      })
      return results.map((r) =>
        r.status === 'fulfilled' ? r.value : { account_id: 0, status: 'failed' as const, error: String(r.reason) }
      )
    }
  )

  ipcMain.handle(
    'engagements:repost',
    async (_event, data: { account_ids: number[]; post_url: string }): Promise<EngagementItemResult[]> => {
      const results = await runWithConcurrency(data.account_ids, ENGAGEMENT_CONCURRENCY, async (accountId) => {
        const result = await repostPost(accountId, data.post_url)
        createEngagement({ account_id: accountId, post_url: data.post_url, action: 'repost', status: result.status, error_msg: result.error })
        if (!win.isDestroyed()) win.webContents.send('engagement:progress', { account_id: accountId, action: 'repost', ...result })
        return { account_id: accountId, ...result }
      })
      return results.map((r) =>
        r.status === 'fulfilled' ? r.value : { account_id: 0, status: 'failed' as const, error: String(r.reason) }
      )
    }
  )
}
