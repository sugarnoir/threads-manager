import { ipcMain } from 'electron'
import { getPostsByAccount, createPost, updatePostStatus } from '../db/repositories/posts'
import { postThread } from '../playwright/threads-client'
import { getAccountById } from '../db/repositories/accounts'
import { sendDiscordNotification } from '../discord'
import { shouldSkipForStatus } from '../lib/account-guard'

export async function sendPost(
  accountId:   number,
  content:     string,
  mediaPaths?: string[]
): Promise<{ success: boolean; error?: string }> {
  return postThread(accountId, content, mediaPaths)
}

export function registerPostHandlers(): void {
  ipcMain.handle('posts:list', (_event, accountId: number) => {
    return getPostsByAccount(accountId)
  })

  ipcMain.handle(
    'posts:send',
    async (_event, data: { account_id: number; content: string; media_paths?: string[] }) => {
      // ステータスチェック
      const acct = getAccountById(data.account_id)
      if (acct) {
        const guard = shouldSkipForStatus(acct)
        if (guard.skip) {
          return { success: false, error: guard.reason }
        }
      }

      const post = createPost(data)
      const result = await sendPost(data.account_id, data.content, data.media_paths)
      updatePostStatus(post.id, result.success ? 'posted' : 'failed', result.error)
      if (!result.success && result.error) {
        const account = getAccountById(data.account_id)
        if (account) {
          sendDiscordNotification({
            event: 'automation_failed',
            username: account.username,
            message: '投稿に失敗しました',
            detail: result.error,
          }).catch(() => {})
        }
      }
      return { success: result.success, post_id: post.id, error: result.error }
    }
  )

  ipcMain.handle(
    'posts:broadcast',
    async (_event, data: { account_ids: number[]; content: string; media_paths?: string[] }) => {
      const results = await Promise.allSettled(
        data.account_ids.map(async (accountId) => {
          // ステータスチェック
          const acct = getAccountById(accountId)
          if (acct) {
            const guard = shouldSkipForStatus(acct)
            if (guard.skip) {
              const post = createPost({ account_id: accountId, content: data.content, media_paths: data.media_paths })
              updatePostStatus(post.id, 'skipped', guard.reason)
              return { account_id: accountId, success: false, post_id: post.id, error: guard.reason }
            }
          }

          const post = createPost({ account_id: accountId, content: data.content, media_paths: data.media_paths })
          const result = await sendPost(accountId, data.content, data.media_paths)
          updatePostStatus(post.id, result.success ? 'posted' : 'failed', result.error)
          return { account_id: accountId, success: result.success, post_id: post.id }
        })
      )
      return results.map((r) =>
        r.status === 'fulfilled' ? r.value : { success: false, error: String(r.reason) }
      )
    }
  )
}
