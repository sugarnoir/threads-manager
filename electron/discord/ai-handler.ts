import Anthropic from '@anthropic-ai/sdk'
import { Message } from 'discord.js'
import { getAllAccounts } from '../db/repositories/accounts'
import { createPost, updatePostStatus } from '../db/repositories/posts'
import { createSchedule } from '../db/repositories/schedules'
import { postThread } from '../playwright/threads-client'
import { getSetting } from '../db/repositories/settings'

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'post_immediately',
    description: '今すぐ Threads に投稿する',
    input_schema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          description: 'アカウント名（@なし）。全アカウントに投稿する場合は "all"',
        },
        content: {
          type: 'string',
          description: '投稿テキスト',
        },
      },
      required: ['target', 'content'],
    },
  },
  {
    name: 'schedule_post',
    description: '指定日時に Threads への投稿を予約する',
    input_schema: {
      type: 'object' as const,
      properties: {
        username: {
          type: 'string',
          description: 'アカウント名（@なし）',
        },
        scheduled_at: {
          type: 'string',
          description: '投稿日時（ISO 8601 形式、例: 2024-12-25T09:00:00）',
        },
        content: {
          type: 'string',
          description: '投稿テキスト',
        },
      },
      required: ['username', 'scheduled_at', 'content'],
    },
  },
  {
    name: 'list_accounts',
    description: '登録されているアカウントの一覧を返す',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'reply_only',
    description: '実行できない・確認が必要・情報が不足しているときにユーザーへメッセージを返す',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'Discord に返信するメッセージ',
        },
      },
      required: ['message'],
    },
  },
]

// ── Main entry point ──────────────────────────────────────────────────────────

export async function handleAiMessage(message: Message): Promise<void> {
  const apiKey = getSetting('anthropic_api_key')
  if (!apiKey) {
    await message.reply('Claude API キーが設定されていません。設定画面で Anthropic API キーを入力してください。')
    return
  }

  const accounts = getAllAccounts()

  // Format current datetime in JST
  const now = new Date()
  const jst = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).format(now)

  const accountList = accounts.length > 0
    ? accounts.map(a =>
        `@${a.username}` +
        (a.display_name ? ` (${a.display_name})` : '') +
        ` [${a.status}]` +
        (a.group_name ? ` グループ:${a.group_name}` : '')
      ).join('\n')
    : 'なし'

  const systemPrompt = `あなたは Threads 投稿管理 Bot のアシスタントです。
ユーザーの日本語メッセージを解析して、適切なツールを呼び出してください。

現在日時（JST）: ${jst}

登録アカウント一覧:
${accountList}

ルール:
- 投稿内容が空・不明な場合は reply_only で確認を求めてください
- 存在しないアカウント名の場合は reply_only で指摘し、正しいアカウント名を案内してください
- 「明日」「来週月曜」などの相対日時は現在日時から計算してください
- scheduled_at は ISO 8601 形式 (YYYY-MM-DDTHH:MM:00) で指定してください
- 日時が特定できない場合は reply_only で確認してください
- 「全員」「全アカウント」は target: "all" を使ってください
- Threads 以外の操作（いいね、フォローなど）には reply_only でできないと伝えてください`

  // Show typing indicator
  const thinking = await message.reply('🤔 考え中...')

  try {
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      tools: TOOLS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: message.content }],
    })

    // Execute the tool Claude chose
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue

      const input = block.input as Record<string, string>

      switch (block.name) {
        case 'post_immediately':
          await executePost(thinking, input.target, input.content, accounts)
          break

        case 'schedule_post':
          await executeSchedule(thinking, input.username, input.scheduled_at, input.content, accounts)
          break

        case 'list_accounts':
          await replyAccountList(thinking, accounts)
          break

        case 'reply_only':
          await thinking.edit(input.message)
          break
      }
      return // Only handle the first tool call
    }

    // Fallback: if no tool was used, show text response
    const textBlock = response.content.find(b => b.type === 'text')
    if (textBlock && textBlock.type === 'text') {
      await thinking.edit(textBlock.text)
    }
  } catch (err) {
    console.error('[AI] error:', err)
    if (err instanceof Anthropic.AuthenticationError) {
      await thinking.edit('❌ Anthropic API キーが無効です。設定画面で確認してください。')
    } else if (err instanceof Anthropic.RateLimitError) {
      await thinking.edit('❌ API のレート制限に達しました。少し待ってから再試行してください。')
    } else {
      await thinking.edit(`❌ エラーが発生しました: ${String(err)}`)
    }
  }
}

// ── Tool executors ────────────────────────────────────────────────────────────

type AccountList = ReturnType<typeof getAllAccounts>

async function executePost(
  progress: Message,
  target: string,
  content: string,
  accounts: AccountList,
): Promise<void> {
  const targets = target.toLowerCase() === 'all'
    ? accounts
    : accounts.filter(a => a.username.toLowerCase() === target.replace(/^@/, '').toLowerCase())

  if (targets.length === 0) {
    await progress.edit(
      `❌ アカウント \`${target}\` が見つかりません\n` +
      `登録済み: ${accounts.map(a => `@${a.username}`).join(', ') || 'なし'}`
    )
    return
  }

  await progress.edit(`⏳ ${targets.length} アカウントに投稿中...`)

  let ok = 0
  const errs: string[] = []

  for (const account of targets) {
    try {
      const post   = createPost({ account_id: account.id, content })
      const result = await postThread(account.id, content)
      updatePostStatus(post.id, result.success ? 'posted' : 'failed', result.error)
      if (result.success) ok++
      else errs.push(`❌ @${account.username}: ${result.error ?? '失敗'}`)
    } catch (err) {
      errs.push(`❌ @${account.username}: ${String(err)}`)
    }
  }

  await progress.edit([`✅ ${ok}/${targets.length} 件成功`, ...errs].join('\n'))
}

async function executeSchedule(
  progress: Message,
  username: string,
  scheduledAt: string,
  content: string,
  accounts: AccountList,
): Promise<void> {
  const account = accounts.find(
    a => a.username.toLowerCase() === username.replace(/^@/, '').toLowerCase()
  )
  if (!account) {
    await progress.edit(
      `❌ アカウント \`${username}\` が見つかりません\n` +
      `登録済み: ${accounts.map(a => `@${a.username}`).join(', ') || 'なし'}`
    )
    return
  }

  const dt = new Date(scheduledAt)
  if (isNaN(dt.getTime())) {
    await progress.edit(`❌ 日時の解析に失敗しました: ${scheduledAt}`)
    return
  }
  if (dt <= new Date()) {
    await progress.edit('❌ 過去の日時は設定できません')
    return
  }

  createSchedule({ account_id: account.id, content, scheduled_at: dt.toISOString() })

  const formatted = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).format(dt)

  const preview = content.length > 80 ? content.slice(0, 80) + '…' : content
  await progress.edit(
    `📅 予約投稿を設定しました\n` +
    `**アカウント:** @${account.username}\n` +
    `**日時:** ${formatted}\n` +
    `**内容:** ${preview}`
  )
}

async function replyAccountList(progress: Message, accounts: AccountList): Promise<void> {
  if (accounts.length === 0) {
    await progress.edit('アカウントが登録されていません')
    return
  }
  const EMOJI: Record<string, string> = {
    active: '🟢', inactive: '⚪', needs_login: '🟡', frozen: '🔴', error: '❌',
  }
  const LABEL: Record<string, string> = {
    active: 'ログイン中', inactive: '未確認', needs_login: '要ログイン', frozen: '凍結', error: 'エラー',
  }
  const lines = accounts.map(a =>
    `${EMOJI[a.status] ?? '⚪'} **@${a.username}**　${LABEL[a.status] ?? a.status}` +
    (a.group_name ? `　[${a.group_name}]` : '')
  )
  await progress.edit(`**登録アカウント (${accounts.length} 件)**\n${lines.join('\n')}`)
}
