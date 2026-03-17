import fs from 'fs'
import https from 'https'
import http from 'http'
import path from 'path'
import os from 'os'
import { Client, GatewayIntentBits, Message } from 'discord.js'
import { getAllAccounts } from '../db/repositories/accounts'
import { createPost, updatePostStatus } from '../db/repositories/posts'
import { createSchedule } from '../db/repositories/schedules'
import { postThread } from '../playwright/threads-client'
import { getSetting } from '../db/repositories/settings'
import { handleAiMessage } from './ai-handler'

let client: Client | null = null

export function isBotRunning(): boolean {
  return client !== null && client.isReady()
}

export async function startBot(): Promise<{ ok: boolean; error?: string }> {
  if (client) {
    client.destroy()
    client = null
  }

  const token     = getSetting('discord_bot_token')
  const channelId = getSetting('discord_bot_channel_id')

  if (!token)     return { ok: false, error: 'Bot Token が設定されていません' }
  if (!channelId) return { ok: false, error: 'チャンネル ID が設定されていません' }

  try {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    })

    // Bot の準備完了時: 参加サーバー一覧を出力
    client.on('ready', (c) => {
      console.log(`[DiscordBot] ready: tag=${c.user.tag} guilds=${c.guilds.cache.size}`)
      c.guilds.cache.forEach((g) => {
        console.log(`[DiscordBot]   guild: ${g.name} (${g.id})`)
      })
      console.log(`[DiscordBot] watching channelId: ${channelId}`)
    })

    // messageCreate: フィルタより先に全メッセージをログ
    client.on('messageCreate', (message) => {
      console.log(
        `[DiscordBot] messageCreate: author=${message.author.tag} bot=${message.author.bot}` +
        ` ch=${message.channelId} match=${message.channelId === channelId}` +
        ` content.length=${message.content.length}` +
        ` content=${JSON.stringify(message.content.slice(0, 100))}`
      )
      handleMessage(message, channelId).catch((err) => {
        console.error('[DiscordBot] handleMessage error:', err)
      })
    })

    client.on('error', (err) => {
      console.error('[DiscordBot] client error:', err)
    })

    client.on('warn', (info) => {
      console.warn('[DiscordBot] warn:', info)
    })

    client.on('disconnect', () => {
      console.warn('[DiscordBot] disconnected')
    })

    await client.login(token)
    console.log('[DiscordBot] login OK, waiting for ready event...')
    return { ok: true }
  } catch (err) {
    client?.destroy()
    client = null
    return { ok: false, error: String(err) }
  }
}

export function stopBot(): void {
  if (client) {
    client.destroy()
    client = null
    console.log('[DiscordBot] stopped')
  }
}

// ── Image helpers ──────────────────────────────────────────────────────────────

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const proto = url.startsWith('https') ? https : http
    proto.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        file.close()
        fs.unlink(dest, () => {})
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
      file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err) })
    }).on('error', (err) => {
      fs.unlink(dest, () => {})
      reject(err)
    })
  })
}

async function downloadAttachments(message: Message): Promise<string[]> {
  const images = [...message.attachments.values()].filter(
    (a) => a.contentType?.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic)$/i.test(a.name)
  )
  if (images.length === 0) return []

  const paths: string[] = []
  for (const att of images) {
    const ext  = path.extname(att.name) || '.jpg'
    const dest = path.join(os.tmpdir(), `dc-img-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
    try {
      await downloadFile(att.url, dest)
      paths.push(dest)
    } catch (err) {
      console.error('[DiscordBot] image download failed:', err)
    }
  }
  return paths
}

function cleanupFiles(paths: string[]): void {
  for (const p of paths) fs.unlink(p, () => {})
}

// ── Command dispatcher ────────────────────────────────────────────────────────

async function handleMessage(message: Message, channelId: string): Promise<void> {
  if (message.author.bot) return
  if (message.channelId !== channelId) return

  const prefix = getSetting('discord_bot_prefix') || '!'
  const text   = message.content.trim()

  console.log(`[DiscordBot] handleMessage: prefix=${JSON.stringify(prefix)} text=${JSON.stringify(text.slice(0, 120))}`)

  // message.content が空 = MessageContent Privileged Intent 未有効
  if (!text && message.attachments.size === 0) {
    console.warn('[DiscordBot] message.content is empty! Discord Developer Portal で "Message Content Intent" を有効にしてください。')
    return
  }

  // ── Prefix commands ──────────────────────────────────────────────────────
  if (text.startsWith(prefix)) {
    const raw   = text.slice(prefix.length).trim()
    const parts = raw.split(/\s+/)
    const cmd   = parts[0]?.toLowerCase()
    const args  = parts.slice(1)

    console.log(`[DiscordBot] prefix command: cmd=${cmd} args=${JSON.stringify(args)}`)

    switch (cmd) {
      case 'post':      await handlePost(message, args);     break
      case 'schedule':  await handleSchedule(message, args); break
      case 'accounts':  await handleAccounts(message);       break
      case 'help':      await handleHelp(message, prefix);   break
      default:
        console.log(`[DiscordBot] unknown command: ${cmd}`)
    }
    return
  }

  // ── 全アカウント投稿 テキスト ────────────────────────────────────────────
  const allMatch = text.match(/^全アカウント投稿\s+([\s\S]+)$/)
  if (allMatch) {
    console.log('[DiscordBot] 全アカウント投稿 matched')
    await handleNaturalPost(message, 'all', allMatch[1].trim())
    return
  }

  // ── 予約投稿 @アカウント名 YYYY-MM-DD HH:MM テキスト ───────────────────
  const schedMatch = text.match(/^予約投稿\s+@?(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([\s\S]+)$/)
  if (schedMatch) {
    console.log('[DiscordBot] 予約投稿 matched')
    await handleNaturalSchedule(message, schedMatch[1], schedMatch[2], schedMatch[3], schedMatch[4].trim())
    return
  }

  // ── 画像 + "@アカウント名 テキスト" ────────────────────────────────────
  if (message.attachments.size > 0 && text) {
    const acctMatch = text.match(/^@?(\S+)\s+([\s\S]+)$/)
    if (acctMatch) {
      console.log('[DiscordBot] 画像+アカウント投稿 matched')
      await handleNaturalPost(message, acctMatch[1], acctMatch[2].trim())
      return
    }
  }

  // ── AI mode: natural language ────────────────────────────────────────────
  const hasAiKey = !!getSetting('anthropic_api_key')
  console.log(`[DiscordBot] no pattern matched. hasAiKey=${hasAiKey}`)
  if (hasAiKey) {
    await handleAiMessage(message)
  }
}

// ── !post ─────────────────────────────────────────────────────────────────────

async function handlePost(message: Message, args: string[]): Promise<void> {
  if (args.length < 2) {
    await message.reply(
      '使い方:\n' +
      '`!post @アカウント名 テキスト` — 指定アカウントに投稿（画像添付可）\n' +
      '`!post all テキスト` — 全アカウントに投稿（画像添付可）'
    )
    return
  }

  const target  = args[0].replace(/^@/, '')
  const content = args.slice(1).join(' ')

  if (!content) { await message.reply('投稿テキストを入力してください'); return }

  await handleNaturalPost(message, target, content)
}

// ── !schedule ─────────────────────────────────────────────────────────────────

async function handleSchedule(message: Message, args: string[]): Promise<void> {
  // !schedule @username YYYY-MM-DD HH:MM text...
  if (args.length < 4) {
    await message.reply(
      '使い方: `!schedule @アカウント名 YYYY-MM-DD HH:MM 投稿テキスト`\n' +
      '例: `!schedule @myaccount 2024-12-25 09:00 メリークリスマス！`'
    )
    return
  }

  const target   = args[0].replace(/^@/, '')
  const dateStr  = args[1]
  const timeStr  = args[2]
  const content  = args.slice(3).join(' ')

  await handleNaturalSchedule(message, target, dateStr, timeStr, content)
}

// ── !accounts ─────────────────────────────────────────────────────────────────

async function handleAccounts(message: Message): Promise<void> {
  const accounts = getAllAccounts()
  if (accounts.length === 0) {
    await message.reply('アカウントが登録されていません')
    return
  }

  const EMOJI: Record<string, string> = {
    active:      '🟢',
    inactive:    '⚪',
    needs_login: '🟡',
    frozen:      '🔴',
    error:       '❌',
  }
  const LABEL: Record<string, string> = {
    active:      'ログイン中',
    inactive:    '未確認',
    needs_login: '要ログイン',
    frozen:      '凍結',
    error:       'エラー',
  }

  const lines = accounts.map(a =>
    `${EMOJI[a.status] ?? '⚪'} **@${a.username}**　${LABEL[a.status] ?? a.status}` +
    (a.group_name ? `　[${a.group_name}]` : '')
  )
  await message.reply(`**登録アカウント (${accounts.length} 件)**\n${lines.join('\n')}`)
}

// ── !help ─────────────────────────────────────────────────────────────────────

async function handleHelp(message: Message, prefix: string): Promise<void> {
  await message.reply(
    '**Threads Manager Bot コマンド一覧**\n\n' +
    `**プレフィックスコマンド**\n` +
    `\`${prefix}post @アカウント名 テキスト\`　　指定アカウントに即時投稿（画像添付可）\n` +
    `\`${prefix}post all テキスト\`　　　　　　　全アカウントに即時投稿（画像添付可）\n` +
    `\`${prefix}schedule @アカウント名 YYYY-MM-DD HH:MM テキスト\`　予約投稿\n` +
    `\`${prefix}accounts\`　　　　　　　　　　　アカウント一覧\n` +
    `\`${prefix}help\`　　　　　　　　　　　　　このヘルプ\n\n` +
    `**自然言語コマンド（プレフィックス不要）**\n` +
    `\`全アカウント投稿 テキスト\`　　　　　　　全アカウントに即時投稿（画像添付可）\n` +
    `\`予約投稿 @アカウント名 YYYY-MM-DD HH:MM テキスト\`　予約投稿\n` +
    `\`@アカウント名 テキスト\` + 画像添付　　　指定アカウントに画像付き投稿\n\n` +
    `Claude API キー設定済みの場合は自由文でも操作できます`
  )
}

// ── Natural language post (shared by prefix and natural commands) ─────────────

async function handleNaturalPost(
  message: Message,
  target: string,
  content: string,
): Promise<void> {
  if (!content) { await message.reply('投稿テキストを入力してください'); return }

  const accounts = getAllAccounts()
  const targets  = target.toLowerCase() === 'all'
    ? accounts
    : (() => {
        const a = accounts.find(a => a.username.toLowerCase() === target.toLowerCase())
        return a ? [a] : []
      })()

  if (targets.length === 0) {
    await message.reply(
      `アカウント \`${target}\` が見つかりません\n` +
      `登録済み: ${accounts.map(a => `@${a.username}`).join(', ') || 'なし'}`
    )
    return
  }

  const mediaPaths = await downloadAttachments(message)
  const mediaLabel = mediaPaths.length > 0 ? ` 🖼️ 画像${mediaPaths.length}枚` : ''

  const progress = await message.reply(`⏳ ${targets.length} アカウントに投稿中...${mediaLabel}`)
  let ok = 0
  const errs: string[] = []

  for (const account of targets) {
    console.log(`[DiscordBot] postThread start: account=${account.username}(${account.id})`)
    try {
      const post   = createPost({ account_id: account.id, content })
      const result = await postThread(account.id, content, mediaPaths)
      console.log(`[DiscordBot] postThread result: account=${account.username} success=${result.success} error=${result.error ?? '-'}`)
      updatePostStatus(post.id, result.success ? 'posted' : 'failed', result.error)
      if (result.success) {
        ok++
      } else {
        errs.push(`❌ @${account.username}: ${result.error ?? '失敗'}`)
      }
    } catch (err) {
      console.error(`[DiscordBot] postThread exception: account=${account.username}`, err)
      errs.push(`❌ @${account.username}: ${String(err)}`)
    }
  }

  cleanupFiles(mediaPaths)

  const lines = [`✅ ${ok}/${targets.length} 件成功${mediaLabel}`, ...errs]
  await progress.edit(lines.join('\n'))
}

// ── Natural language schedule ─────────────────────────────────────────────────

async function handleNaturalSchedule(
  message: Message,
  username: string,
  dateStr: string,
  timeStr: string,
  content: string,
): Promise<void> {
  if (!content) { await message.reply('投稿テキストを入力してください'); return }

  const scheduled = new Date(`${dateStr}T${timeStr}:00`)
  if (isNaN(scheduled.getTime())) {
    await message.reply('日時の形式が正しくありません。`YYYY-MM-DD HH:MM` の形式で入力してください')
    return
  }
  if (scheduled <= new Date()) {
    await message.reply('過去の日時は設定できません')
    return
  }

  const accounts = getAllAccounts()
  const account  = accounts.find(a => a.username.toLowerCase() === username.toLowerCase())
  if (!account) {
    await message.reply(
      `アカウント \`${username}\` が見つかりません\n` +
      `登録済み: ${accounts.map(a => `@${a.username}`).join(', ') || 'なし'}`
    )
    return
  }

  createSchedule({ account_id: account.id, content, scheduled_at: scheduled.toISOString() })

  const preview = content.length > 80 ? content.slice(0, 80) + '…' : content
  await message.reply(
    `📅 予約投稿を設定しました\n` +
    `**アカウント:** @${account.username}\n` +
    `**日時:** ${dateStr} ${timeStr}\n` +
    `**内容:** ${preview}`
  )
}
