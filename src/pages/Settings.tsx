import { useState, useEffect } from 'react'
import { api } from '../lib/ipc'
import { LicenseAdmin } from './LicenseAdmin'

// 管理者パスワード（ハードコード）
const ADMIN_PASSWORD = 'TM-ADMIN-2025'

// ── Toggle component ─────────────────────────────────────────────────────────
interface ToggleProps {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  size?: 'md' | 'sm'
}

function Toggle({ checked, onChange, disabled = false, size = 'md' }: ToggleProps) {
  const track = size === 'md'
    ? 'h-6 w-11'
    : 'h-5 w-9'
  const knob = size === 'md'
    ? 'h-5 w-5'
    : 'h-4 w-4'
  const travel = size === 'md'
    ? (checked ? 'translate-x-5' : 'translate-x-0')
    : (checked ? 'translate-x-4' : 'translate-x-0')

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={[
        'relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent',
        'transition-colors duration-200 focus:outline-none',
        track,
        checked ? 'bg-blue-600' : 'bg-zinc-600',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block rounded-full bg-white shadow-md',
          'transition-transform duration-200',
          knob,
          travel,
        ].join(' ')}
      />
    </button>
  )
}

// ── Discord Bot section ───────────────────────────────────────────────────────

function BotSection() {
  const [token,     setToken]     = useState('')
  const [channelId, setChannelId] = useState('')
  const [prefix,    setPrefix]    = useState('!')
  const [enabled,   setEnabled]   = useState(false)
  const [running,   setRunning]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [starting,  setStarting]  = useState(false)
  const [msg,       setMsg]       = useState<{ ok: boolean; text: string } | null>(null)
  const [showToken, setShowToken] = useState(false)

  const [anthropicKey, setAnthropicKey] = useState('')
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)

  useEffect(() => {
    api.settings.getAll().then((s) => {
      setToken(s.discord_bot_token ?? '')
      setChannelId(s.discord_bot_channel_id ?? '')
      setPrefix(s.discord_bot_prefix ?? '!')
      setEnabled(s.discord_bot_enabled === 'true')
      setAnthropicKey(s.anthropic_api_key ?? '')
    })
    api.settings.botStatus().then((r) => setRunning(r.running))
  }, [])

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 3000)
  }

  const handleSave = async () => {
    setSaving(true)
    await api.settings.setMany({
      discord_bot_token:      token.trim(),
      discord_bot_channel_id: channelId.trim(),
      discord_bot_prefix:     prefix || '!',
      discord_bot_enabled:    String(enabled),
      anthropic_api_key:      anthropicKey.trim(),
    })
    setSaving(false)
    flash(true, '設定を保存しました')
  }

  const handleStartStop = async () => {
    setStarting(true)
    if (running) {
      await api.settings.botStop()
      setRunning(false)
      flash(true, 'Bot を停止しました')
    } else {
      // Save current inputs first
      await api.settings.setMany({
        discord_bot_token:      token.trim(),
        discord_bot_channel_id: channelId.trim(),
        discord_bot_prefix:     prefix || '!',
      })
      const r = await api.settings.botStart()
      if (r.ok) {
        setRunning(true)
        flash(true, 'Bot を起動しました')
      } else {
        flash(false, r.error ?? '起動に失敗しました')
      }
    }
    setStarting(false)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0 text-base">
          🤖
        </div>
        <div>
          <p className="text-white font-semibold text-sm">Discord Bot（投稿コマンド）</p>
          <p className="text-zinc-500 text-xs">Discord チャンネルから Threads に投稿・予約投稿</p>
        </div>
        {/* Running badge */}
        <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
          running ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-zinc-700 text-zinc-400'
        }`}>
          {running ? '● 稼働中' : '○ 停止中'}
        </span>
      </div>

      <div className="space-y-3 mb-4">
        {/* Bot Token */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">Bot Token</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="MTxxxxxxxxxxxxxxxxxxxxxxxx.Gxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono pr-14"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
            >
              {showToken ? '隠す' : '表示'}
            </button>
          </div>
        </div>

        {/* Channel ID */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">
            チャンネル ID
            <span className="text-zinc-600 font-normal ml-1">（コマンドを受け付けるチャンネル）</span>
          </label>
          <input
            type="text"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="1234567890123456789"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>

        {/* Prefix */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">コマンドプレフィックス</label>
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="!"
            className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>

        {/* Auto-start toggle */}
        <div className="flex items-center justify-between p-3 bg-zinc-800 rounded-xl">
          <div>
            <p className="text-white text-xs font-medium">アプリ起動時に自動スタート</p>
            <p className="text-zinc-500 text-[11px] mt-0.5">アプリを開くと Bot が自動的に起動します</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs font-semibold w-6 text-right ${enabled ? 'text-blue-400' : 'text-zinc-500'}`}>
              {enabled ? 'ON' : 'OFF'}
            </span>
            <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} size="md" />
          </div>
        </div>
      </div>

      {/* Anthropic API Key */}
      <div className="mb-4 p-4 bg-zinc-800 rounded-xl space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base leading-none">✨</span>
          <div>
            <p className="text-white text-xs font-semibold">Claude AI による自然言語操作</p>
            <p className="text-zinc-500 text-[11px] mt-0.5">
              API キーを設定すると「明日9時に〇〇を投稿して」など自然な日本語でも操作できます
            </p>
          </div>
        </div>
        <label className="text-zinc-400 text-xs font-medium block">Anthropic API キー</label>
        <div className="relative">
          <input
            type={showAnthropicKey ? 'text' : 'password'}
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder="sk-ant-api03-..."
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 font-mono pr-14"
          />
          <button
            type="button"
            onClick={() => setShowAnthropicKey(!showAnthropicKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
          >
            {showAnthropicKey ? '隠す' : '表示'}
          </button>
        </div>
        <p className="text-zinc-600 text-[11px]">
          未設定の場合は !コマンド形式のみ利用可能です
        </p>
      </div>

      {/* コマンド例 */}
      <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3 mb-4 space-y-1.5">
        <p className="text-zinc-400 text-[11px] font-semibold mb-2 uppercase tracking-widest">使い方</p>
        <p className="text-zinc-500 text-[10px] font-semibold mb-1">🤖 AI モード（自然言語）</p>
        {[
          ['明日9時に@usernameで新製品リリースのお知らせを投稿して', '予約投稿'],
          ['全アカウントに「おはようございます」と投稿して', '全員に即時投稿'],
          ['登録アカウントを教えて', 'アカウント一覧'],
        ].map(([ex, desc]) => (
          <div key={ex} className="flex items-start gap-2">
            <span className="text-zinc-300 text-[11px] shrink-0 min-w-0 flex-1">{ex}</span>
            <span className="text-zinc-600 text-[11px] shrink-0">→ {desc}</span>
          </div>
        ))}
        <div className="border-t border-zinc-700 mt-2 pt-2">
          <p className="text-zinc-500 text-[10px] font-semibold mb-1">⌨️ コマンドモード</p>
          {[
            [`${prefix}post @username テキスト`, '即時投稿'],
            [`${prefix}post all テキスト`, '全アカウントに投稿'],
            [`${prefix}schedule @username YYYY-MM-DD HH:MM テキスト`, '予約投稿'],
            [`${prefix}accounts`, 'アカウント一覧'],
          ].map(([cmd, desc]) => (
            <div key={cmd} className="flex items-start gap-2">
              <code className="text-blue-300 text-[11px] font-mono shrink-0">{cmd}</code>
              <span className="text-zinc-500 text-[11px]">— {desc}</span>
            </div>
          ))}
        </div>
      </div>

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-lg mb-3 ${
          msg.ok ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                 : 'text-red-400 bg-red-500/10 border border-red-500/20'
        }`}>
          {msg.ok ? '✓' : '✕'} {msg.text}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {saving ? '保存中...' : '設定を保存'}
        </button>
        <button
          onClick={handleStartStop}
          disabled={starting || !token.trim() || !channelId.trim()}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 ${
            running
              ? 'bg-red-600/20 hover:bg-red-600 border border-red-600/40 hover:border-transparent text-red-400 hover:text-white'
              : 'bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-600/40 hover:border-transparent text-emerald-400 hover:text-white'
          }`}
        >
          {starting ? '処理中...' : running ? '停止する' : '起動する'}
        </button>
      </div>
    </div>
  )
}


type NotifyKey = 'account_error' | 'login_failed' | 'automation_failed'

const NOTIFY_OPTIONS: { key: NotifyKey; label: string; desc: string }[] = [
  { key: 'account_error',     label: 'アカウントエラー',  desc: 'ログイン状態確認でエラーが発生した時' },
  { key: 'login_failed',      label: 'ログイン失敗',     desc: 'アカウント追加時のログインに失敗した時' },
  { key: 'automation_failed', label: '自動化エラー',     desc: '投稿・いいね・RPなどの自動化に失敗した時' },
]

export function Settings() {
  const [webhookUrl, setWebhookUrl]   = useState('')
  const [enabled, setEnabled]         = useState(true)
  const [eventFlags, setEventFlags]   = useState<Record<NotifyKey, boolean>>({
    account_error:     true,
    login_failed:      true,
    automation_failed: true,
  })
  const [testing, setTesting]     = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving]         = useState(false)
  const [savedMsg, setSavedMsg]     = useState(false)

  // Load settings
  useEffect(() => {
    api.settings.getAll().then((s) => {
      setWebhookUrl(s.discord_webhook_url ?? '')
      setEnabled(s.discord_notify_enabled !== 'false')
      setEventFlags({
        account_error:     s.discord_notify_account_error     !== 'false',
        login_failed:      s.discord_notify_login_failed      !== 'false',
        automation_failed: s.discord_notify_automation_failed !== 'false',
      })
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    const entries: Record<string, string> = {
      discord_webhook_url:    webhookUrl.trim(),
      discord_notify_enabled: String(enabled),
    }
    for (const opt of NOTIFY_OPTIONS) {
      entries[`discord_notify_${opt.key}`] = String(eventFlags[opt.key])
    }
    await api.settings.setMany(entries)
    setSaving(false)
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 2000)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    // Save URL first so the test uses the current input value
    await api.settings.setMany({
      discord_webhook_url:    webhookUrl.trim(),
      discord_notify_enabled: 'true',
      discord_notify_test:    'true',
    })
    const result = await api.settings.testWebhook()
    setTestResult({ ok: result.ok, msg: result.ok ? '送信成功！Discord を確認してください' : (result.error ?? '送信失敗') })
    setTesting(false)
  }

  return (
    <div className="space-y-6 max-w-lg">

      {/* Discord section */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <svg width="16" height="12" viewBox="0 0 71 55" fill="white">
              <path d="M60.1 4.9A58.5 58.5 0 0 0 45.5.4a.2.2 0 0 0-.2.1 40.7 40.7 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.5 37.5 0 0 0 25.4.5a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.6 4.9a.2.2 0 0 0-.1.1C1.6 18.1-.9 31 .3 43.6a.2.2 0 0 0 .1.2 58.8 58.8 0 0 0 17.7 8.9.2.2 0 0 0 .2-.1 42 42 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.7 38.7 0 0 1-5.5-2.6.2.2 0 0 1 0-.4c.4-.3.7-.5 1.1-.8a.2.2 0 0 1 .2 0c11.5 5.3 24 5.3 35.4 0a.2.2 0 0 1 .2 0l1 .8a.2.2 0 0 1 0 .4 36.1 36.1 0 0 1-5.5 2.6.2.2 0 0 0-.1.3 47 47 0 0 0 3.6 5.9.2.2 0 0 0 .2.1 58.7 58.7 0 0 0 17.7-8.9.2.2 0 0 0 .1-.2c1.5-15.1-2.5-28-10.6-39.6a.2.2 0 0 0-.1-.1zM23.7 36c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 3.9-2.8 7.2-6.4 7.2zm23.7 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 3.9-2.8 7.2-6.4 7.2z"/>
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Discord 通知</p>
            <p className="text-zinc-500 text-xs">エラー発生時に Discord チャンネルへ通知</p>
          </div>
        </div>

        {/* Master toggle */}
        <div className="flex items-center justify-between p-4 bg-zinc-800 rounded-xl mb-3">
          <div>
            <p className="text-white text-sm font-medium">通知を有効化</p>
            <p className="text-zinc-500 text-xs mt-0.5">すべての Discord 通知のオン/オフ</p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <span className={`text-xs font-semibold w-6 text-right transition-colors ${enabled ? 'text-blue-400' : 'text-zinc-500'}`}>
              {enabled ? 'ON' : 'OFF'}
            </span>
            <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} size="md" />
          </div>
        </div>

        {/* Webhook URL */}
        <div className="space-y-2 mb-4">
          <label className="text-zinc-400 text-xs font-medium block">Webhook URL</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
            />
            <button
              onClick={handleTest}
              disabled={testing || !webhookUrl.trim()}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              {testing ? '送信中...' : 'テスト送信'}
            </button>
          </div>
          {testResult && (
            <p className={`text-xs px-3 py-2 rounded-lg ${
              testResult.ok
                ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                : 'text-red-400 bg-red-500/10 border border-red-500/20'
            }`}>
              {testResult.ok ? '✓' : '✕'} {testResult.msg}
            </p>
          )}
          <p className="text-zinc-600 text-xs">
            Discord チャンネルの設定 → 連携 → Webhook から URL を取得できます
          </p>
        </div>

        {/* Per-event toggles */}
        <div className="space-y-2">
          <p className="text-zinc-400 text-xs font-medium mb-2">通知するイベント</p>
          {NOTIFY_OPTIONS.map((opt) => {
            const isOn = eventFlags[opt.key] && enabled
            return (
              <div
                key={opt.key}
                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                  enabled
                    ? 'bg-zinc-800 border-zinc-700'
                    : 'bg-zinc-900 border-zinc-800 opacity-50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 transition-colors ${isOn ? 'bg-blue-400' : 'bg-zinc-600'}`} />
                  <div className="min-w-0">
                    <p className="text-white text-xs font-medium">{opt.label}</p>
                    <p className="text-zinc-500 text-[11px] mt-0.5">{opt.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className={`text-[11px] font-semibold w-6 text-right transition-colors ${isOn ? 'text-blue-400' : 'text-zinc-600'}`}>
                    {isOn ? 'ON' : 'OFF'}
                  </span>
                  <Toggle
                    checked={eventFlags[opt.key]}
                    onChange={() => setEventFlags((f) => ({ ...f, [opt.key]: !f[opt.key] }))}
                    disabled={!enabled}
                    size="sm"
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3 pt-2 border-t border-zinc-800">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {saving ? '保存中...' : '設定を保存'}
        </button>
        {savedMsg && (
          <span className="text-emerald-400 text-xs font-medium">✓ 保存しました</span>
        )}
      </div>

      {/* Discord Bot section */}
      <div className="pt-2 border-t border-zinc-800">
        <BotSection />
      </div>

      {/* License Admin section */}
      <div className="pt-2 border-t border-zinc-800">
        <LicenseAdminSection />
      </div>

    </div>
  )
}

// ── License Admin section（パスワードゲート付き）────────────────────────────

function LicenseAdminSection() {
  const [unlocked, setUnlocked] = useState(false)
  const [pw,       setPw]       = useState('')
  const [pwError,  setPwError]  = useState(false)

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) {
      setUnlocked(true)
      setPwError(false)
    } else {
      setPwError(true)
      setPw('')
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0 text-base">
          🔑
        </div>
        <div>
          <p className="text-white font-semibold text-sm">ライセンス管理</p>
          <p className="text-zinc-500 text-xs">Supabase のライセンスキーを管理（管理者専用）</p>
        </div>
        {unlocked && (
          <button
            onClick={() => setUnlocked(false)}
            className="ml-auto text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
          >
            🔒 ロック
          </button>
        )}
      </div>

      {!unlocked ? (
        <form onSubmit={handleUnlock} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="password"
              value={pw}
              onChange={(e) => { setPw(e.target.value); setPwError(false) }}
              placeholder="管理者パスワード"
              autoComplete="off"
              className={[
                'flex-1 bg-zinc-800 border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600',
                'focus:outline-none focus:border-blue-500 transition-colors',
                pwError ? 'border-red-500' : 'border-zinc-700',
              ].join(' ')}
            />
            <button
              type="submit"
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              解除
            </button>
          </div>
          {pwError && (
            <p className="text-red-400 text-xs">パスワードが違います</p>
          )}
        </form>
      ) : (
        <LicenseAdmin />
      )}
    </div>
  )
}
