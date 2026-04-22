import { ipcMain, BrowserWindow } from 'electron'
import { appendFileSync } from 'fs'

const AUTOPOST_LOG = '/tmp/tm-autopost.log'
function logAutopost(msg: string): void {
  console.log(msg)
  try {
    appendFileSync(AUTOPOST_LOG, msg + '\n')
  } catch { /* ignore */ }
}
import Anthropic from '@anthropic-ai/sdk'
import {
  getAllSchedules,
  createSchedule,
  getPendingSchedules,
  updateScheduleStatus,
  deleteSchedule,
} from '../db/repositories/schedules'
import { createPost, updatePostStatus, getLastPostedAt } from '../db/repositories/posts'
import { getStocksByAccount } from '../db/repositories/post_stocks'
import {
  getEnabledAutopostConfigs,
  updateAutopostState,
  AutopostConfig,
} from '../db/repositories/autopost'
import { getSetting } from '../db/repositories/settings'
import { createEngagement } from '../db/repositories/engagements'
import { sendPost } from './post'
import { apiPostText, apiPostWithMedia, fetchFollowerCount } from '../api/threads-web-api'
import { resolveImagePaths } from '../utils/image-download'
import { apiGetUserId, apiGetUserPosts, apiLikePost, apiFollowUser, apiReplyToPost, apiFetchNotifications } from '../api/threads-engage-api'
import {
  getEnabledAutoEngagementConfigs,
  updateAutoEngagementState,
  AutoEngagementConfig,
} from '../db/repositories/auto_engagement'
import {
  getNextPendingFollow,
  markFollowQueueDone,
  markFollowQueueFailed,
} from '../db/repositories/follow_queue'
import {
  getAllEnabledAutoReplyConfigs,
  getAutoReplyConfig,
  upsertReplyRecord,
  getPendingReplyRecords,
  updateReplyRecordStatus,
  updateAutoReplyLastChecked,
  hasRepliedToUsername,
  AutoReplyConfig,
} from '../db/repositories/auto-reply'
import { getAllAccounts, updateAccountFollowerCount, updateReplyBanStatus, getAccountById } from '../db/repositories/accounts'

let schedulerInterval: NodeJS.Timeout | null = null
let schedulerRunning = false
let followerCountLastUpdated = 0
const FOLLOWER_COUNT_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6時間
let replyBanLastChecked = 0
const REPLY_BAN_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24時間

async function refreshFollowerCounts(win: BrowserWindow): Promise<void> {
  if (getSetting('follower_count_auto_fetch') !== 'true') return
  const accounts = getAllAccounts().filter(a => a.status === 'active')
  for (const account of accounts) {
    try {
      const count = await fetchFollowerCount(account.id)
      if (count !== null) {
        const prev = account.follower_count  // 更新前の値を退避
        updateAccountFollowerCount(account.id, count)
        if (!win.isDestroyed()) {
          win.webContents.send('accounts:follower-count-updated', {
            account_id: account.id,
            follower_count: count,
            follower_count_prev: prev,
          })
        }
      }
    } catch (e) {
      console.error(`[followerCount] error for account=${account.id}:`, e)
    }
    // アカウント間に少し間隔を開ける
    await new Promise(r => setTimeout(r, 2000))
  }
}

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

// ── Auto-engagement execution ─────────────────────────────────────────────────

async function executeAutoEngagement(cfg: AutoEngagementConfig): Promise<void> {
  const usernames = cfg.target_usernames
    .split('\n')
    .map(u => u.trim().replace(/^@/, ''))
    .filter(Boolean)

  if (usernames.length === 0) return

  if (cfg.action === 'like') {
    const username = usernames[0]
    const userId = await apiGetUserId(cfg.account_id, username)
    if (!userId) {
      console.warn(`[AutoEngagement] like: user not found: @${username}`)
      return
    }
    const posts = await apiGetUserPosts(cfg.account_id, userId, 20)
    if (posts.length === 0) return

    const alreadyLiked = new Set(cfg.liked_post_ids)
    const tolike = posts.filter(p => !alreadyLiked.has(p.id))
    if (tolike.length === 0) return

    // 1件だけいいね（間隔ごとに1件）
    const target = tolike[0]
    const result = await apiLikePost(cfg.account_id, target.id)

    createEngagement({
      account_id: cfg.account_id,
      post_url:   `ig://media/${target.id}`,
      action:     'api_like',
      status:     result.success ? 'done' : 'failed',
      error_msg:  result.error ?? null,
    })

    if (result.success) {
      const newIds = [...cfg.liked_post_ids, target.id].slice(-300)
      updateAutoEngagementState(cfg.account_id, 'like', { liked_post_ids: newIds })
    }
  }

  if (cfg.action === 'follow') {
    // ── キューが優先: follow_queue に pending があればそちらから消化 ──────────
    const queueItem = getNextPendingFollow(cfg.account_id)
    if (queueItem) {
      console.log(`[AutoEngagement] follow via queue: account=${cfg.account_id} @${queueItem.target_username} (pk=${queueItem.target_pk})`)
      const result = await apiFollowUser(cfg.account_id, queueItem.target_pk)
      createEngagement({
        account_id: cfg.account_id,
        post_url:   `https://www.threads.com/@${queueItem.target_username}`,
        action:     'api_follow',
        status:     result.success ? 'done' : 'failed',
        error_msg:  result.error ?? null,
      })
      if (result.success) {
        markFollowQueueDone(queueItem.id)
      } else {
        markFollowQueueFailed(queueItem.id)
      }
      return
    }

    // ── フォールバック: 従来の target_usernames リスト ───────────────────────
    if (usernames.length === 0) return
    const idx = cfg.follow_idx % usernames.length
    const username = usernames[idx]

    const userId = await apiGetUserId(cfg.account_id, username)
    if (!userId) {
      console.warn(`[AutoEngagement] follow: user not found: @${username}`)
      updateAutoEngagementState(cfg.account_id, 'follow', { follow_idx: (idx + 1) % usernames.length })
      return
    }

    const result = await apiFollowUser(cfg.account_id, userId)
    createEngagement({
      account_id: cfg.account_id,
      post_url:   `https://www.threads.com/@${username}`,
      action:     'api_follow',
      status:     result.success ? 'done' : 'failed',
      error_msg:  result.error ?? null,
    })

    updateAutoEngagementState(cfg.account_id, 'follow', {
      follow_idx: (idx + 1) % usernames.length,
    })
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

    let result: { success: boolean; error?: string }
    if (config.use_api) {
      logAutopost(`[Autopost] stock.topic=${JSON.stringify(stock.topic)}`)
      const { paths: imagePaths, cleanup } = await resolveImagePaths([stock.image_url, stock.image_url_2])
      try {
        if (imagePaths.length > 0) {
          result = await apiPostWithMedia(config.account_id, stock.content, imagePaths, stock.topic ?? undefined)
        } else {
          result = await apiPostText(config.account_id, stock.content, stock.topic ?? undefined)
        }
      } finally {
        cleanup()
      }
    } else {
      result = await sendPost(config.account_id, stock.content)
    }
    updateAutopostState(config.account_id, { stock_last_id: stock.id })
    return result
  }

  if (config.mode === 'random') {
    const stocks = getStocksByAccount(config.account_id)
    if (stocks.length === 0) return null

    const stock = stocks[Math.floor(Math.random() * stocks.length)]

    let result: { success: boolean; error?: string }
    if (config.use_api) {
      const { paths: imagePaths, cleanup } = await resolveImagePaths([stock.image_url, stock.image_url_2])
      try {
        if (imagePaths.length > 0) {
          result = await apiPostWithMedia(config.account_id, stock.content, imagePaths, stock.topic ?? undefined)
        } else {
          result = await apiPostText(config.account_id, stock.content, stock.topic ?? undefined)
        }
      } finally {
        cleanup()
      }
    } else {
      result = await sendPost(config.account_id, stock.content)
    }
    return result
  }

  if (config.mode === 'rewrite') {
    const stocks = getStocksByAccount(config.account_id)
    if (stocks.length === 0) return { success: false, error: 'ストックが空です' }

    const lastIdx = config.stock_last_id
      ? stocks.findIndex((s) => s.id === config.stock_last_id)
      : -1
    const nextIdx = lastIdx + 1 >= stocks.length ? 0 : lastIdx + 1
    const stock = stocks[nextIdx]

    logAutopost(`[Autopost] rewrite: account=${config.account_id} stock.id=${stock.id} text="${stock.content.slice(0, 50)}..."`)

    const rewritten = await rewriteWithClaude(stock.content)
    if (!rewritten) return { success: false, error: 'AIリライト失敗（APIキー未設定？）' }

    logAutopost(`[Autopost] rewritten: "${rewritten.slice(0, 80)}..."`)

    let result: { success: boolean; error?: string }
    if (config.use_api) {
      result = await apiPostText(config.account_id, rewritten)
    } else {
      result = await sendPost(config.account_id, rewritten)
    }
    updateAutopostState(config.account_id, { stock_last_id: stock.id })
    return result
  }

  return null
}

// ── Auto-reply execution ──────────────────────────────────────────────────────

async function executeAutoReply(config: AutoReplyConfig): Promise<void> {
  const { group_name } = config
  console.log(`[autoReply] checking group=${group_name}`)

  updateAutoReplyLastChecked(group_name)

  if (config.reply_texts.length === 0) {
    console.log(`[autoReply] no reply_texts for group=${group_name}`)
    return
  }

  const allAccounts = getAllAccounts()
  const accounts = allAccounts.filter(a => a.group_name === group_name)
  if (accounts.length === 0) {
    console.log(`[autoReply] no accounts in group=${group_name}`)
    return
  }

  for (const account of accounts) {
    try {
      // 通知ページからリプライ通知を取得
      const notifications = await apiFetchNotifications(account.id)
      if (notifications === null || notifications.length === 0) {
        console.log(`[autoReply] account=${account.id} no reply notifications (view may not be loaded)`)
      } else {
        console.log(`[autoReply] account=${account.id} found ${notifications.length} reply notifications`)
        for (const notif of notifications) {
          const isNew = upsertReplyRecord({
            account_id:     account.id,
            parent_post_id: notif.parentPostId,
            reply_post_id:  notif.mediaId,
            reply_username: notif.username,
            reply_text:     notif.content,
          })
          if (isNew) {
            console.log(`[autoReply] new reply from @${notif.username}: "${notif.content.slice(0, 50)}"`)
          }
        }
      }

      // pending レコードに返信
      const pending = getPendingReplyRecords(account.id)
      console.log(`[autoReply] account=${account.id} pending=${pending.length}`)
      for (const record of pending) {
        // 同じユーザーへの2回目以降の返信はスキップ（初回のみ返信）
        if (record.reply_username && hasRepliedToUsername(account.id, record.reply_username)) {
          console.log(`[autoReply] skip: already replied to @${record.reply_username}`)
          updateReplyRecordStatus(record.id, 'skipped')
          continue
        }
        const text = config.reply_texts[Math.floor(Math.random() * config.reply_texts.length)]
        const result = await apiReplyToPost(account.id, record.reply_post_id, text)
        if (result.success) {
          updateReplyRecordStatus(record.id, 'replied')
          console.log(`[autoReply] replied to ${record.reply_post_id} from @${record.reply_username}`)
        } else {
          console.warn(`[autoReply] failed to reply to ${record.reply_post_id}: ${result.error}`)
          updateReplyRecordStatus(record.id, 'skipped')
        }
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500))
      }
    } catch (e) {
      console.error(`[autoReply] error for account=${account.id}:`, e)
    }
  }
}

// ── Scheduler loop ────────────────────────────────────────────────────────────

export function startScheduler(win: BrowserWindow): void {
  if (schedulerInterval) return

  // 起動時にフォロワー数を即時取得（3秒後に開始してセッション初期化を待つ）
  setTimeout(() => {
    refreshFollowerCounts(win).catch(e => console.error('[followerCount] startup error:', e))
    followerCountLastUpdated = Date.now()
  }, 3000)

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
        console.log(`[Scheduler] executing schedule.id=${schedule.id} account=${schedule.account_id} topic=${JSON.stringify(schedule.topic)}`)
        let result: { success: boolean; error?: string }
        if (schedule.media_paths.length > 0) {
          const { paths: imagePaths, cleanup } = await resolveImagePaths(schedule.media_paths)
          try {
            result = await apiPostWithMedia(schedule.account_id, schedule.content, imagePaths, schedule.topic ?? undefined)
          } finally {
            cleanup()
          }
        } else {
          result = await apiPostText(schedule.account_id, schedule.content, schedule.topic ?? undefined)
        }
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
      const MIN_POST_INTERVAL_MS = 260 * 60_000 // 260分
      const now = new Date()
      const autoConfigs = getEnabledAutopostConfigs()
      logAutopost(`[Autopost] tick — ${autoConfigs.length} enabled config(s), now=${now.toISOString()}`)

      for (const config of autoConfigs) {
        const nextAt = config.next_at ? new Date(config.next_at) : null
        const remainMs = nextAt ? nextAt.getTime() - now.getTime() : null
        const remainMin = remainMs !== null ? Math.round(remainMs / 60_000) : null

        // next_at が未来 → スキップ
        if (nextAt && nextAt > now) {
          logAutopost(`[Autopost] account=${config.account_id} SKIP — next_at in ${remainMin}m (${config.next_at})`)
          continue
        }

        // 再起動時の重複投稿防止: 直近の投稿時刻が最小間隔未満ならスキップ
        if (config.use_api) {
          const lastPostedAt = getLastPostedAt(config.account_id)
          if (lastPostedAt) {
            const elapsed = Date.now() - new Date(lastPostedAt).getTime()
            if (elapsed < MIN_POST_INTERVAL_MS) {
              const remaining = Math.ceil((MIN_POST_INTERVAL_MS - elapsed) / 60_000)
              logAutopost(`[Autopost] account=${config.account_id} SKIP — last post ${Math.floor(elapsed / 60_000)}m ago, need ${remaining}m more`)
              continue
            }
          }
        }

        try {
          const execTime = new Date()
          const result = await executeAutopost(config)
          if (!result) {
            logAutopost(`[Autopost] account=${config.account_id} executeAutopost returned null (no stock?)`)
            continue
          }

          const delayMs =
            (config.min_interval +
              Math.random() * (config.max_interval - config.min_interval)) *
            60_000
          const nextAt = new Date(Date.now() + delayMs).toISOString()
          updateAutopostState(config.account_id, {
            next_at:          nextAt,
            last_executed_at: execTime.toISOString(),
          })

          const fmt = (d: Date) => d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })
          console.log(
            `[Autopost] 実行 account=${config.account_id} ` +
            `時刻=${fmt(execTime)} ` +
            `結果=${result.success ? '成功' : '失敗'}${result.error ? ` (${result.error})` : ''} ` +
            `次回=${fmt(new Date(nextAt))}`
          )

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

      // 3. 自動エンゲージメント (いいね / フォロー)
      const engConfigs = getEnabledAutoEngagementConfigs()
      for (const cfg of engConfigs) {
        if (cfg.next_at && new Date(cfg.next_at) > new Date()) continue
        try {
          await executeAutoEngagement(cfg)
          const delayMs =
            (cfg.min_interval + Math.random() * (cfg.max_interval - cfg.min_interval)) * 60_000
          const nextAt = new Date(Date.now() + delayMs).toISOString()
          updateAutoEngagementState(cfg.account_id, cfg.action, { next_at: nextAt })
          if (!win.isDestroyed()) {
            win.webContents.send('autoEngagement:executed', {
              account_id: cfg.account_id,
              action:     cfg.action,
              next_at:    nextAt,
            })
          }
        } catch (e) {
          console.error('[AutoEngagement] Error for account', cfg.account_id, cfg.action, e)
        }
      }
      // 4. フォロワー数定期更新（1時間ごと）
      if (Date.now() - followerCountLastUpdated >= FOLLOWER_COUNT_INTERVAL_MS) {
        followerCountLastUpdated = Date.now()
        refreshFollowerCounts(win).catch(e => console.error('[followerCount] periodic error:', e))
      }

      // 5. X リプBANチェック（1日1回）
      if (Date.now() - replyBanLastChecked >= REPLY_BAN_CHECK_INTERVAL_MS) {
        replyBanLastChecked = Date.now()
        const xAccts = getAllAccounts().filter(a => a.platform === 'x' && a.status === 'active')
        for (const xa of xAccts) {
          try {
            const sess = (await import('electron')).session.fromPartition(`persist:account-${xa.id}`)
            const cookies = await sess.cookies.get({}).catch(() => [])
            const ct0 = cookies.find(c => c.name === 'ct0' && (c.domain?.includes('x.com') || c.domain?.includes('twitter.com')))?.value ?? ''
            const authToken = cookies.find(c => c.name === 'auth_token')?.value
            if (!authToken || !ct0) continue
            const cookieHeader = cookies.filter(c => c.value && (c.domain?.includes('twitter.com') || c.domain?.includes('x.com'))).map(c => `${c.name}=${c.value}`).join('; ')
            const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
            const q = encodeURIComponent(`from:${xa.username} filter:replies`)
            const resp = await sess.fetch(`https://x.com/i/api/2/search/adaptive.json?q=${q}&count=5&query_source=typed_query&pc=1`, {
              headers: { 'Authorization': `Bearer ${BEARER}`, 'X-Csrf-Token': ct0 },
            })
            if (resp.ok) {
              const data = await resp.json() as { globalObjects?: { tweets?: Record<string, unknown> } }
              const banned = Object.keys(data?.globalObjects?.tweets ?? {}).length === 0
              updateReplyBanStatus(xa.id, banned ? 'banned' : 'ok', new Date().toISOString())
              if (banned) console.warn(`[scheduler] reply ban detected: @${xa.username}`)
            }
          } catch (e) { console.error(`[scheduler] reply ban check error account=${xa.id}:`, e) }
          await new Promise(r => setTimeout(r, 3000)) // レート制限対策
        }
      }

      // 6. 自動返信
      const replyNow = new Date()
      const replyConfigs = getAllEnabledAutoReplyConfigs()
      for (const cfg of replyConfigs) {
        const lastChecked = cfg.last_checked_at ? new Date(cfg.last_checked_at) : null
        const checkIntervalMs = cfg.check_interval * 60_000
        if (!lastChecked || replyNow.getTime() - lastChecked.getTime() >= checkIntervalMs) {
          executeAutoReply(cfg).catch(e => console.error('[autoReply] error:', e))
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
        topic?:       string | null
      }
    ) => {
      return createSchedule(data)
    }
  )

  ipcMain.handle('schedules:delete', (_event, id: number) => {
    deleteSchedule(id)
    return { success: true }
  })

  ipcMain.handle('autoReply:checkNow', async (_e, groupName: string) => {
    const cfg = getAutoReplyConfig(groupName)
    if (!cfg) return { success: false, error: 'config not found' }
    executeAutoReply(cfg).catch(e => console.error('[autoReply:checkNow] error:', e))
    return { success: true }
  })
}
