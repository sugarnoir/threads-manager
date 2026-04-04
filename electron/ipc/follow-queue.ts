import { ipcMain, BrowserWindow } from 'electron'
import { ViewManager } from '../browser-views/view-manager'
import {
  enqueueFollowers,
  getFollowQueueStats,
  clearPendingFollowQueue,
} from '../db/repositories/follow_queue'
import { apiGetUserId, apiFetchFollowers } from '../api/threads-engage-api'

export function registerFollowQueueHandlers(viewManager: ViewManager, win: BrowserWindow): void {
  /**
   * CDPキャプチャ済みフォロワー候補を follow_queue に保存する（手動スクロール方式）。
   */
  ipcMain.handle('followQueue:enqueue', (_e, accountId: number) => {
    const candidates = viewManager.getFollowerCandidates()
    if (candidates.length === 0) {
      return { added: 0, message: 'キャプチャ済みのフォロワーデータがありません。フォロワーページを開いてスクロールしてください。' }
    }
    const added = enqueueFollowers(accountId, candidates)
    console.log(`[followQueue] enqueued ${added} / ${candidates.length} users for account=${accountId}`)
    return { added, total: candidates.length }
  })

  /**
   * 競合アカウント名を指定してフォロワーを API で自動取得し follow_queue に保存する。
   * 進捗は followQueue:fetchProgress イベントでフロントエンドに送信する。
   */
  ipcMain.handle(
    'followQueue:fetchAndEnqueue',
    async (_e, accountId: number, targetUsername: string, maxCount = 2000) => {
      const username = targetUsername.replace(/^@/, '').trim()
      if (!username) return { added: 0, error: 'ユーザー名を入力してください' }

      // ① ユーザーID を取得
      console.log(`[followQueue] resolving userId for @${username} ...`)
      const userId = await apiGetUserId(accountId, username)
      if (!userId) {
        return { added: 0, error: `@${username} のユーザーIDが見つかりません。アカウントが存在するか、ログイン状態を確認してください。` }
      }
      console.log(`[followQueue] @${username} → userId=${userId}`)

      // ② フォロワーリストをページネーション取得（進捗をフロントに送信）
      const { users, error } = await apiFetchFollowers(
        accountId,
        userId,
        maxCount,
        (fetched) => {
          if (!win.isDestroyed()) {
            win.webContents.send('followQueue:fetchProgress', { fetched })
          }
        },
      )

      if (error && users.length === 0) {
        return { added: 0, error }
      }

      // ③ follow_queue に保存（重複は IGNORE）
      const added = enqueueFollowers(accountId, users)
      console.log(`[followQueue] fetchAndEnqueue: fetched=${users.length} added=${added} for account=${accountId}`)
      return { added, total: users.length, error: error ?? undefined }
    }
  )

  ipcMain.handle('followQueue:stats', (_e, accountId: number) => {
    return getFollowQueueStats(accountId)
  })

  ipcMain.handle('followQueue:clearPending', (_e, accountId: number) => {
    clearPendingFollowQueue(accountId)
    return { ok: true }
  })
}
