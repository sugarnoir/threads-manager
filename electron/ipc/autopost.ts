import { ipcMain } from 'electron'
import {
  getAutopostConfig,
  upsertAutopostConfig,
  resetAutopostNext,
  setAutopostNextAt,
} from '../db/repositories/autopost'
import { getDb } from '../db/index'
import { createPost, updatePostStatus } from '../db/repositories/posts'
import { apiPostText, apiPostWithMedia } from '../api/threads-web-api'
import { resolveImagePaths } from '../utils/image-download'

export function registerAutopostHandlers(): void {
  ipcMain.handle('autopost:get', (_event, accountId: number) => {
    return getAutopostConfig(accountId)
  })

  ipcMain.handle(
    'autopost:save',
    (
      _event,
      data: {
        account_id:    number
        enabled:       boolean
        mode:          'stock' | 'rewrite' | 'random'
        use_api:       boolean
        min_interval:  number
        max_interval:  number
        rewrite_texts: string[]
      }
    ) => {
      return upsertAutopostConfig(data)
    }
  )

  ipcMain.handle('autopost:reset-next', (_event, accountId: number) => {
    resetAutopostNext(accountId)
    return { success: true }
  })

  ipcMain.handle('autopost:set-next-at', (_event, data: { account_id: number; next_at: string }) => {
    setAutopostNextAt(data.account_id, data.next_at)
    return { success: true }
  })

  // Immediate API post from a stock item
  ipcMain.handle(
    'apiPost:send',
    async (
      _event,
      data: { account_id: number; content: string; image_urls?: (string | null)[]; topic?: string }
    ) => {
      const { paths: imagePaths, cleanup } = await resolveImagePaths(data.image_urls ?? [])

      const post = createPost({
        account_id:  data.account_id,
        content:     data.content,
        media_paths: imagePaths,
      })

      let result: { success: boolean; error?: string }
      try {
        if (imagePaths.length > 0) {
          result = await apiPostWithMedia(data.account_id, data.content, imagePaths, data.topic)
        } else {
          result = await apiPostText(data.account_id, data.content, data.topic)
        }
      } finally {
        cleanup()
      }

      updatePostStatus(post.id, result.success ? 'posted' : 'failed', result.error)
      return result
    }
  )
}
