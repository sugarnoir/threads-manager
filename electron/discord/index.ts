import { getSetting } from '../db/repositories/settings'

export type NotifyEvent = 'account_error' | 'login_failed' | 'automation_failed' | 'test'

const EVENT_LABELS: Record<NotifyEvent, string> = {
  account_error:      'アカウントエラー',
  login_failed:       'ログイン失敗',
  automation_failed:  '自動化エラー',
  test:               'テスト通知',
}

const EVENT_COLORS: Record<NotifyEvent, number> = {
  account_error:     0xef4444,  // red
  login_failed:      0xf97316,  // orange
  automation_failed: 0xeab308,  // yellow
  test:              0x3b82f6,  // blue
}

const EVENT_EMOJIS: Record<NotifyEvent, string> = {
  account_error:     '🔴',
  login_failed:      '🟠',
  automation_failed: '🟡',
  test:              '🔵',
}

export interface NotifyPayload {
  event: NotifyEvent
  username: string
  message: string
  detail?: string
}

function formatTimestamp(): string {
  return new Date().toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export async function sendDiscordNotification(payload: NotifyPayload): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = getSetting('discord_webhook_url')
  if (!webhookUrl) return { ok: false, error: 'Webhook URL が設定されていません' }

  const enabled = getSetting('discord_notify_enabled')
  if (enabled === 'false') return { ok: false, error: '通知が無効です' }

  // Check per-event toggle (key: discord_notify_{event})
  const eventEnabled = getSetting(`discord_notify_${payload.event}`)
  if (eventEnabled === 'false') return { ok: false, error: `${payload.event} の通知が無効です` }

  const timestamp = formatTimestamp()
  const emoji = EVENT_EMOJIS[payload.event]

  const body = JSON.stringify({
    embeds: [
      {
        title: `${emoji} ${EVENT_LABELS[payload.event]}`,
        color: EVENT_COLORS[payload.event],
        fields: [
          { name: 'アカウント', value: `@${payload.username}`, inline: true },
          { name: '発生時刻',   value: timestamp,               inline: true },
          { name: 'エラー内容', value: payload.message,         inline: false },
          ...(payload.detail
            ? [{ name: '詳細', value: `\`\`\`${payload.detail.slice(0, 900)}\`\`\``, inline: false }]
            : []),
        ],
        footer: { text: 'Threads Manager' },
        timestamp: new Date().toISOString(),
      },
    ],
  })

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Discord API error ${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
