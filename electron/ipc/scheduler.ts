import { ipcMain, BrowserWindow } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import {
  getAllSchedules,
  createSchedule,
  getPendingSchedules,
  updateScheduleStatus,
  deleteSchedule,
} from '../db/repositories/schedules'
import { createPost, updatePostStatus } from '../db/repositories/posts'
import { getStocksByAccount } from '../db/repositories/post_stocks'
import {
  getEnabledAutopostConfigs,
  updateAutopostState,
  AutopostConfig,
} from '../db/repositories/autopost'
import { getSetting } from '../db/repositories/settings'
import { sendPost } from './post'

let schedulerInterval: NodeJS.Timeout | null = null
let schedulerRunning = false

// ── Claude API rewrite ────────────────────────────────────────────────────────

async function rewriteWithClaude(text: string): Promise<string | null> {
  const apiKey = getSetting('anthropic_api_key')
  if (!apiKey) return null
  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content:
            `以下の投稿テキストをThreadsに投稿するためにリライトしてください。\n` +
            `- 日本語で自然な文体\n` +
            `- ハッシュタグは追加しない\n` +
            `- 元の意味を保ちながら独自性を出す\n` +
            `- 500文字以内\n\n` +
            `元テキスト:\n${text}\n\n` +
            `リライト後のテキストのみ返してください。`,
        },
      ],
    })
    const block = msg.content[0]
    return block.type === 'text' ? block.text.trim() : null
  } catch (e) {
    console.error('[Autopost] Claude rewrite error:', e)
    return null
  }
}

// ── Auto-post execution ───────────────────────────────────────────────────────

async function executeAutopost(
  config: AutopostConfig
): Promise<{ success: boolean; error?: string } | null> {
  if (config.mode === 'stock') {
    const stocks = getStocksByAccount(config.account_id)
    if (stocks.length === 0) return null

    const lastIdx = config.stock_last_id
      ? stocks.findIndex((s) => s.id === config.stock_last_id)
      : -1
    const nextIdx = lastIdx + 1 >= stocks.length ? 0 : lastIdx + 1
    const stock = stocks[nextIdx]

    const result = await sendPost(config.account_id, stock.content)
    updateAutopostState(config.account_id, { stock_last_id: stock.id })
    return result
  }

  if (config.mode === 'rewrite') {
    if (config.rewrite_texts.length === 0) return null

    const idx = config.rewrite_idx % config.rewrite_texts.length
    const sourceText = config.rewrite_texts[idx]

    const rewritten = await rewriteWithClaude(sourceText)
    if (!rewritten) return { success: false, error: 'AIリライト失敗（APIキー未設定？）' }

    const result = await sendPost(config.account_id, rewritten)
    updateAutopostState(config.account_id, {
      rewrite_idx: (idx + 1) % config.rewrite_texts.length,
    })
    return result
  }

  return null
}

// ── Scheduler loop ────────────────────────────────────────────────────────────

export function startScheduler(win: BrowserWindow): void {
  if (schedulerInterval) return
  schedulerInterval = setInterval(async () => {
    if (schedulerRunning) return
    schedulerRunning = true
    try {
      // 1. 通常スケジュール
      const pending = getPendingSchedules()
      for (const schedule of pending) {
        updateScheduleStatus(schedule.id, 'posted')
        const post = createPost({
          account_id:  schedule.account_id,
          content:     schedule.content,
          media_paths: schedule.media_paths,
        })
        const result = await sendPost(
          schedule.account_id,
          schedule.content,
          schedule.media_paths
        )
        updatePostStatus(post.id, result.success ? 'posted' : 'failed', result.error)
        updateScheduleStatus(schedule.id, result.success ? 'posted' : 'failed', post.id)
        if (!win.isDestroyed()) {
          win.webContents.send('scheduler:executed', {
            schedule_id: schedule.id,
            success:     result.success,
          })
        }
      }

      // 2. 自動投稿
      const autoConfigs = getEnabledAutopostConfigs()
      for (const config of autoConfigs) {
        if (config.next_at && new Date(config.next_at) > new Date()) continue

        try {
          const result = await executeAutopost(config)
          if (!result) continue

          const delayMs =
            (config.min_interval +
              Math.random() * (config.max_interval - config.min_interval)) *
            60_000
          const nextAt = new Date(Date.now() + delayMs).toISOString()
          updateAutopostState(config.account_id, { next_at: nextAt })

          if (!win.isDestroyed()) {
            win.webContents.send('autopost:executed', {
              account_id: config.account_id,
              success:    result.success,
              next_at:    nextAt,
            })
          }
        } catch (e) {
          console.error('[Autopost] Error for account', config.account_id, e)
        }
      }
    } finally {
      schedulerRunning = false
    }
  }, 60_000)
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
  schedulerRunning = false
}

export function registerSchedulerHandlers(): void {
  ipcMain.handle('schedules:list', () => {
    return getAllSchedules()
  })

  ipcMain.handle(
    'schedules:create',
    (
      _event,
      data: {
        account_id:   number
        content:      string
        media_paths?: string[]
        scheduled_at: string
      }
    ) => {
      return createSchedule(data)
    }
  )

  ipcMain.handle('schedules:delete', (_event, id: number) => {
    deleteSchedule(id)
    return { success: true }
  })
}
