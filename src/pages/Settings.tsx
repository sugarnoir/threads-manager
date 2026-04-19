import { useState, useEffect, useRef } from 'react'
import { api, ProxyPreset, MasterKeyRow } from '../lib/ipc'
import { LicenseAdmin } from './LicenseAdmin'
import { MasterKeyGate } from '../components/MasterKeyGate'

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

export function Settings({ onAccountAdded }: { onAccountAdded?: () => void } = {}) {
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

  // 表示設定
  const [showAccountNumbers, setShowAccountNumbers] = useState(
    () => localStorage.getItem('showAccountNumbers') === 'true'
  )
  const [followerCountAutoFetch, setFollowerCountAutoFetch] = useState(false)

  const handleToggleAccountNumbers = () => {
    const next = !showAccountNumbers
    setShowAccountNumbers(next)
    localStorage.setItem('showAccountNumbers', String(next))
    window.dispatchEvent(new Event('showAccountNumbersChanged'))
  }

  const handleToggleFollowerCountAutoFetch = async () => {
    const next = !followerCountAutoFetch
    setFollowerCountAutoFetch(next)
    await api.settings.set('follower_count_auto_fetch', String(next))
  }

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
      setFollowerCountAutoFetch(s.follower_count_auto_fetch === 'true')
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

      {/* ── 表示設定 ── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0 text-base">
            🔢
          </div>
          <div>
            <p className="text-white font-semibold text-sm">表示設定</p>
            <p className="text-zinc-500 text-xs">サイドバーの表示をカスタマイズ</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between p-4 bg-zinc-800 rounded-xl">
            <div>
              <p className="text-white text-sm font-medium">アカウント番号表示</p>
              <p className="text-zinc-500 text-xs mt-0.5">サイドバーの各アカウントに連番（1, 2, 3…）を表示</p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <span className={`text-xs font-semibold w-6 text-right transition-colors ${showAccountNumbers ? 'text-blue-400' : 'text-zinc-500'}`}>
                {showAccountNumbers ? 'ON' : 'OFF'}
              </span>
              <Toggle checked={showAccountNumbers} onChange={handleToggleAccountNumbers} size="md" />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-zinc-800 rounded-xl">
            <div>
              <p className="text-white text-sm font-medium">フォロワー数自動取得</p>
              <p className="text-zinc-500 text-xs mt-0.5">起動時と6時間ごとにフォロワー数を自動取得してサイドバーに表示</p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <span className={`text-xs font-semibold w-6 text-right transition-colors ${followerCountAutoFetch ? 'text-blue-400' : 'text-zinc-500'}`}>
                {followerCountAutoFetch ? 'ON' : 'OFF'}
              </span>
              <Toggle checked={followerCountAutoFetch} onChange={handleToggleFollowerCountAutoFetch} size="md" />
            </div>
          </div>
        </div>
      </div>

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

      {/* Image Groups section */}
      <div className="pt-2 border-t border-zinc-800">
        <ImageGroupsSection />
      </div>

      {/* Profile Icon Auto-change section */}
      <div className="pt-2 border-t border-zinc-800">
        <h2 className="text-white font-semibold mb-3">プロフィールアイコン自動変更</h2>
        <ProfileIconSection />
      </div>

      {/* Stock Bulk Delete section */}
      <div className="pt-2 border-t border-zinc-800">
        <h2 className="text-white font-semibold mb-3">ストック一括削除</h2>
        <StockBulkDeleteSection />
      </div>

      {/* Proxy Template section */}
      <div className="pt-2 border-t border-zinc-800">
        <ProxyTemplateSection />
      </div>

      {/* Proxy Presets section */}
      <div className="pt-2 border-t border-zinc-800">
        <ProxyPresetsSection />
      </div>

      {/* Discord Bot section */}
      <div className="pt-2 border-t border-zinc-800">
        <BotSection />
      </div>

      {/* Master Key Admin section */}
      <div className="pt-2 border-t border-zinc-800">
        <MasterKeyAdminSection />
      </div>

      {/* License Admin section */}
      <div className="pt-2 border-t border-zinc-800">
        <LicenseAdminSection />
      </div>

    </div>
  )
}

// ── Auto Register section ─────────────────────────────────────────────────────

function AutoRegisterSectionInner({ onAccountAdded }: { onAccountAdded?: () => void }) {
  const [nameStocks,       setNameStocks]       = useState('')  // one name per line
  const [icloudEmail,      setIcloudEmail]      = useState('')
  const [password,         setPassword]         = useState('')
  const [showPw,           setShowPw]           = useState(false)
  const [saving,           setSaving]           = useState(false)
  const [savedMsg,         setSavedMsg]         = useState(false)
  const [running,          setRunning]          = useState(false)
  const [status,           setStatus]           = useState<string | null>(null)
  const [statusType,       setStatusType]       = useState<'info' | 'success' | 'error' | 'waiting'>('info')
  const [emailTemplates,   setEmailTemplates]   = useState<string[]>([])
  const [showEmailDD,      setShowEmailDD]      = useState(false)
  const [newEmailInput,    setNewEmailInput]    = useState('')
  const emailDDRef = useRef<HTMLDivElement>(null)

  // Proxy state
  const [proxyType,     setProxyType]     = useState<'none' | 'http' | 'https' | 'socks5'>('none')
  const [proxyHost,     setProxyHost]     = useState('')
  const [proxyPort,     setProxyPort]     = useState('')
  const [proxyUser,     setProxyUser]     = useState('')
  const [proxyPass,     setProxyPass]     = useState('')
  const [showProxyPw,   setShowProxyPw]   = useState(false)
  const [showProxy,     setShowProxy]     = useState(false)
  const [templateLoaded, setTemplateLoaded] = useState(false)

  const loadProxyTemplate = async () => {
    const all = await api.settings.getAll()
    const type = all['proxy_template_type'] as 'none' | 'http' | 'https' | 'socks5' | undefined
    if (!type || type === 'none') return
    setProxyType(type)
    setProxyHost(all['proxy_template_host'] ?? '')
    setProxyPort(all['proxy_template_port'] ?? '')
    setProxyUser(all['proxy_template_username'] ?? '')
    setProxyPass(all['proxy_template_password'] ?? '')
    setShowProxy(true)
    setTemplateLoaded(true)
    setTimeout(() => setTemplateLoaded(false), 2000)
  }

  useEffect(() => {
    api.settings.getAll().then((all) => {
      setNameStocks(all['register_name_stocks'] ?? '')
      setIcloudEmail(all['register_icloud_email'] ?? '')
      setPassword(all['register_password'] ?? '')
      try {
        const list = JSON.parse(all['register_icloud_emails'] ?? '[]')
        if (Array.isArray(list)) setEmailTemplates(list)
      } catch { /* ignore */ }
    })
  }, [])

  // ドロップダウン外クリックで閉じる
  useEffect(() => {
    if (!showEmailDD) return
    const handler = (e: MouseEvent) => {
      if (emailDDRef.current && !emailDDRef.current.contains(e.target as Node)) {
        setShowEmailDD(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showEmailDD])

  const saveEmailTemplates = async (list: string[]) => {
    setEmailTemplates(list)
    await api.settings.set('register_icloud_emails', JSON.stringify(list))
  }

  const handleAddEmailTemplate = async () => {
    const v = newEmailInput.trim()
    if (!v || emailTemplates.includes(v)) return
    await saveEmailTemplates([...emailTemplates, v])
    setNewEmailInput('')
  }

  const handleRemoveEmailTemplate = async (email: string) => {
    await saveEmailTemplates(emailTemplates.filter(e => e !== email))
  }

  // Listen for status events from backend
  useEffect(() => {
    const off = api.on('accounts:auto-register-status', (e: unknown) => {
      const ev = e as { type: string; detail?: string }
      if (ev.type === 'form_filled')      { setStatus('フォーム入力完了'); setStatusType('info') }
      if (ev.type === 'form_submitted')  { setStatus('フォーム送信完了'); setStatusType('info') }
      if (ev.type === 'waiting_code')    { setStatus(`メール確認コードをブラウザに入力してください\n${ev.detail ?? ''}`.trim()); setStatusType('waiting') }
      if (ev.type === 'waiting_cooldown') { setStatus(ev.detail ?? '登録完了。ロック防止のため待機中...'); setStatusType('waiting') }
      if (ev.type === 'saving')          { setStatus(ev.detail ?? 'DB に保存中...'); setStatusType('info') }
      if (ev.type === 'completed')       { setStatus('アカウント作成完了！（ステータス: 要ログイン）'); setStatusType('success'); setRunning(false) }
      if (ev.type === 'error')           { setStatus(`エラー: ${ev.detail ?? '不明'}`); setStatusType('error'); setRunning(false) }
    })
    return off
  }, [])

  const handleSave = async () => {
    setSaving(true)
    await api.settings.setMany({
      register_name_stocks:  nameStocks.trim(),
      register_icloud_email: icloudEmail.trim(),
      register_password:     password,
    })
    setSaving(false)
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 2000)
  }

  const handleCreate = async () => {
    const lines  = nameStocks.split('\n').map(l => l.trim()).filter(Boolean)
    const email  = icloudEmail.trim()
    const pw     = password

    if (!lines.length) { setStatus('名前ストックを1件以上登録してください'); setStatusType('error'); return }
    if (!email)        { setStatus('iCloudメアドを入力してください'); setStatusType('error'); return }
    if (!pw)           { setStatus('パスワードを入力してください'); setStatusType('error'); return }

    // Random name
    const name = lines[Math.floor(Math.random() * lines.length)]

    // Generate email: aaa@icloud.com → aaa+abc123@icloud.com
    const [localPart, domain] = email.includes('@') ? email.split('@') : [email, 'icloud.com']
    const suffixLen = 4 + Math.floor(Math.random() * 9) // 4〜12文字
    const suffix = Array.from({ length: suffixLen }, () =>
      String.fromCharCode(97 + Math.floor(Math.random() * 26))
    ).join('')
    const generatedEmail = `${localPart}+${suffix}@${domain}`

    setRunning(true)
    setStatus(`ブラウザを開いています...\n名前: ${name}\nメール: ${generatedEmail}`)
    setStatusType('info')

    const proxyUrl = proxyType !== 'none' && proxyHost && proxyPort
      ? `${proxyType}://${proxyHost}:${proxyPort}`
      : null

    const result = await api.accounts.autoRegister({
      name, email: generatedEmail, password: pw,
      proxy_url:      proxyUrl,
      proxy_username: proxyUrl ? (proxyUser || null) : null,
      proxy_password: proxyUrl ? (proxyPass || null) : null,
    })
    if (result.success) {
      onAccountAdded?.()
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0 text-base">👤</div>
        <div>
          <p className="text-white font-semibold text-sm">半自動アカウント作成</p>
          <p className="text-zinc-500 text-xs">Instagramアカウントを半自動で作成してTMに追加</p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Name stocks */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">名前ストック <span className="text-zinc-600">（1行に1つ）</span></label>
          <textarea
            value={nameStocks}
            onChange={(e) => setNameStocks(e.target.value)}
            rows={4}
            placeholder={"田中太郎\n佐藤花子\nTaro Yamada"}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none font-mono"
          />
        </div>

        {/* iCloud email */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">iCloudメアド</label>
          <div className="flex gap-2">
            <input
              type="email"
              value={icloudEmail}
              onChange={(e) => setIcloudEmail(e.target.value)}
              placeholder="yourname@icloud.com"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
            />
            <div className="relative" ref={emailDDRef}>
              <button
                type="button"
                onClick={() => setShowEmailDD(v => !v)}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-xl border border-zinc-600 whitespace-nowrap"
              >
                テンプレ ▾
              </button>
              {showEmailDD && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl z-50 overflow-hidden">
                  {/* メアド一覧 */}
                  <div className="max-h-48 overflow-y-auto">
                    {emailTemplates.length === 0 ? (
                      <p className="text-zinc-500 text-xs px-3 py-3 text-center">テンプレなし</p>
                    ) : (
                      emailTemplates.map((email) => (
                        <div key={email} className="flex items-center gap-1 px-2 py-1.5 hover:bg-zinc-700 group">
                          <button
                            type="button"
                            onClick={() => { setIcloudEmail(email); setShowEmailDD(false) }}
                            className="flex-1 text-left text-sm text-zinc-200 truncate"
                          >
                            {email}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveEmailTemplate(email)}
                            className="text-zinc-600 hover:text-red-400 text-xs px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  {/* 追加欄 */}
                  <div className="border-t border-zinc-700 px-2 py-2 flex gap-1">
                    <input
                      type="email"
                      value={newEmailInput}
                      onChange={(e) => setNewEmailInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddEmailTemplate() } }}
                      placeholder="追加するメアド"
                      className="flex-1 bg-zinc-900 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddEmailTemplate}
                      className="px-2 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg"
                    >
                      追加
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Password */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">固定パスワード</label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="登録に使うパスワード"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
            />
            <button type="button" onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white">
              {showPw ? '隠す' : '表示'}
            </button>
          </div>
        </div>

        {/* Proxy settings */}
        <div className="border border-zinc-700 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowProxy(!showProxy)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-zinc-800 hover:bg-zinc-750 text-sm text-zinc-300 transition-colors"
          >
            <span className="font-medium">プロキシ設定 {proxyType !== 'none' && proxyHost ? <span className="text-blue-400 text-xs ml-1">({proxyType}://{proxyHost}:{proxyPort})</span> : ''}</span>
            <span className="text-zinc-500 text-xs">{showProxy ? '▲' : '▼'}</span>
          </button>
          {showProxy && (
            <div className="p-3 space-y-2 bg-zinc-800/50">
              {/* Template load button */}
              <button
                type="button"
                onClick={loadProxyTemplate}
                className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
              >
                {templateLoaded ? '✓ 読み込み完了' : 'テンプレートから読み込み'}
              </button>
              {/* Type selector */}
              <div className="grid grid-cols-4 gap-1">
                {(['none', 'http', 'https', 'socks5'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setProxyType(t)}
                    className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${proxyType === t ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}>
                    {t === 'none' ? 'なし' : t.toUpperCase()}
                  </button>
                ))}
              </div>
              {proxyType !== 'none' && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input type="text" value={proxyHost} onChange={(e) => setProxyHost(e.target.value)}
                      placeholder="proxy.example.com"
                      className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500" />
                    <input type="number" value={proxyPort} onChange={(e) => setProxyPort(e.target.value)}
                      placeholder="8080"
                      className="w-20 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500" />
                  </div>
                  <input type="text" value={proxyUser} onChange={(e) => setProxyUser(e.target.value)}
                    placeholder="ユーザー名（任意）"
                    className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500" />
                  <div className="relative">
                    <input type={showProxyPw ? 'text' : 'password'} value={proxyPass} onChange={(e) => setProxyPass(e.target.value)}
                      placeholder="パスワード（任意）"
                      className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500" />
                    <button type="button" onClick={() => setShowProxyPw(!showProxyPw)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400 hover:text-white">
                      {showProxyPw ? '隠す' : '表示'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status */}
        {status && (
          <div className={`px-3 py-2 rounded-xl text-xs whitespace-pre-wrap border ${
            statusType === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
            statusType === 'error'   ? 'bg-red-500/10 border-red-500/30 text-red-400' :
            statusType === 'waiting' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
                                       'bg-blue-500/10 border-blue-500/30 text-blue-300'
          }`}>
            {statusType === 'waiting' && <span className="mr-1">⏳</span>}
            {statusType === 'success' && <span className="mr-1">✅</span>}
            {statusType === 'error'   && <span className="mr-1">❌</span>}
            {statusType === 'info'    && <span className="mr-1">ℹ️</span>}
            {status}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : savedMsg ? '✓ 保存' : '設定を保存'}
          </button>
          <button
            onClick={handleCreate}
            disabled={running}
            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {running ? (
              <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />作成中...</>
            ) : 'アカウント作成'}
          </button>
        </div>

      </div>
    </div>
  )
}

export function AutoRegisterSection({ onAccountAdded, onClose }: { onAccountAdded?: () => void; onClose?: () => void } = {}) {
  const [authState, setAuthState] = useState<'loading' | 'ok' | 'required'>('loading')

  useEffect(() => {
    api.masterKey.check().then((r) => {
      setAuthState(r.authenticated ? 'ok' : 'required')
    }).catch(() => setAuthState('required'))
  }, [])

  if (authState === 'loading') {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
        読み込み中...
      </div>
    )
  }

  if (authState === 'required') {
    return <MasterKeyGate onAuth={() => setAuthState('ok')} onCancel={onClose} />
  }

  return <AutoRegisterSectionInner onAccountAdded={onAccountAdded} />
}

// ── Proxy Template section ───────────────────────────────────────────────────

type ProxyTypeAll = 'none' | 'http' | 'https' | 'socks5'

function ProxyTemplateSection() {
  const [type,     setType]     = useState<ProxyTypeAll>('none')
  const [host,     setHost]     = useState('')
  const [port,     setPort]     = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)

  useEffect(() => {
    api.settings.getAll().then((s) => {
      setType((s.proxy_template_type as ProxyTypeAll) || 'none')
      setHost(s.proxy_template_host ?? '')
      setPort(s.proxy_template_port ?? '')
      setUsername(s.proxy_template_username ?? '')
      setPassword(s.proxy_template_password ?? '')
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    await api.settings.setMany({
      proxy_template_type:     type,
      proxy_template_host:     host.trim(),
      proxy_template_port:     port.trim(),
      proxy_template_username: username.trim(),
      proxy_template_password: password,
    })
    setSaving(false)
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 2000)
  }

  const handleClear = async () => {
    setType('none'); setHost(''); setPort(''); setUsername(''); setPassword('')
    await api.settings.setMany({
      proxy_template_type: 'none', proxy_template_host: '',
      proxy_template_port: '', proxy_template_username: '', proxy_template_password: '',
    })
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center shrink-0 text-base">
          🌐
        </div>
        <div>
          <p className="text-white font-semibold text-sm">プロキシテンプレート</p>
          <p className="text-zinc-500 text-xs">アカウント追加時にプロキシ設定の初期値として使用される</p>
        </div>
      </div>

      <div className="space-y-3 bg-zinc-800 rounded-xl p-4 border border-zinc-700">
        {/* Type selector */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-2">種別</label>
          <div className="grid grid-cols-4 gap-1.5">
            {(['none', 'http', 'https', 'socks5'] as ProxyTypeAll[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                  type === t
                    ? 'bg-orange-600 text-white'
                    : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white'
                }`}
              >
                {t === 'none' ? 'なし' : t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {type !== 'none' && (
          <>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-zinc-500 text-xs block mb-1">ホスト</label>
                <input
                  type="text" value={host} onChange={(e) => setHost(e.target.value)}
                  placeholder="proxy.example.com"
                  className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>
              <div className="w-24">
                <label className="text-zinc-500 text-xs block mb-1">ポート</label>
                <input
                  type="number" value={port} onChange={(e) => setPort(e.target.value)}
                  placeholder="8080"
                  className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>
            <div>
              <label className="text-zinc-500 text-xs block mb-1">ユーザー名 <span className="text-zinc-600">(任意)</span></label>
              <input
                type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="text-zinc-500 text-xs block mb-1">パスワード <span className="text-zinc-600">(任意)</span></label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 pr-14"
                />
                <button
                  type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
                >{showPw ? '隠す' : '表示'}</button>
              </div>
            </div>
            {host && port && (
              <p className="text-xs text-orange-400 font-mono bg-orange-500/10 border border-orange-500/20 px-3 py-1.5 rounded-lg">
                {type}://{host}:{port}
              </p>
            )}
          </>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleClear}
            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-400 text-xs rounded-lg transition-colors"
          >クリア</button>
          <button
            onClick={handleSave}
            disabled={saving || (type !== 'none' && (!host.trim() || !port.trim()))}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
          >{saving ? '保存中...' : 'テンプレートを保存'}</button>
          {savedMsg && <span className="text-emerald-400 text-xs self-center">✓ 保存しました</span>}
        </div>
      </div>
    </div>
  )
}

// ── Proxy Presets section ────────────────────────────────────────────────────

type ProxyType = 'http' | 'https' | 'socks5'

interface PresetFormState {
  name: string
  type: ProxyType
  host: string
  port: string
  username: string
  password: string
}

const emptyForm = (): PresetFormState => ({
  name: '', type: 'http', host: '', port: '', username: '', password: '',
})

function PresetForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: PresetFormState
  onSave: (v: PresetFormState) => void
  onCancel: () => void
  saving: boolean
}) {
  const [v, setV] = useState<PresetFormState>(initial)
  const set = (k: keyof PresetFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }))
  const valid = v.name.trim() && v.host.trim() && v.port.trim()

  return (
    <div className="bg-zinc-800 rounded-xl p-4 space-y-3 border border-zinc-700">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">プリセット名 *</label>
          <input
            type="text" value={v.name} onChange={set('name')} placeholder="自宅プロキシ"
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">種別</label>
          <select
            value={v.type} onChange={set('type')}
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            {(['http', 'https', 'socks5'] as ProxyType[]).map((t) => (
              <option key={t} value={t}>{t.toUpperCase()}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-zinc-400 text-xs font-medium block mb-1">ホスト *</label>
          <input
            type="text" value={v.host} onChange={set('host')} placeholder="proxy.example.com"
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="w-24">
          <label className="text-zinc-400 text-xs font-medium block mb-1">ポート *</label>
          <input
            type="number" value={v.port} onChange={set('port')} placeholder="8080"
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">ユーザー名 <span className="text-zinc-600">(任意)</span></label>
          <input
            type="text" value={v.username} onChange={set('username')}
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">パスワード <span className="text-zinc-600">(任意)</span></label>
          <input
            type="password" value={v.password} onChange={set('password')}
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
      {v.host && v.port && (
        <p className="text-xs text-blue-400 font-mono bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-lg">
          {v.type}://{v.host}:{v.port}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-xs transition-colors"
        >キャンセル</button>
        <button
          onClick={() => onSave(v)}
          disabled={!valid || saving}
          className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors"
        >{saving ? '保存中...' : '保存'}</button>
      </div>
    </div>
  )
}

type ProxyPortStat = {
  host: string
  portEntries:   { port: number; count: number }[]
  usedPortCount: number
  minPort:       number
  maxPort:       number
  totalInRange:  number
  unusedPorts:   number[]
}

export function ProxyPresetsSection() {
  const [presets, setPresets] = useState<ProxyPreset[]>([])
  const [mode, setMode]       = useState<'idle' | 'add' | 'edit'>('idle')
  const [editTarget, setEditTarget] = useState<ProxyPreset | null>(null)
  const [saving, setSaving]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const [portStats, setPortStats]         = useState<ProxyPortStat[]>([])
  const [showDetail, setShowDetail]       = useState<string | null>(null)  // host key
  const [urlCounts, setUrlCounts]         = useState<Record<string, number>>({})

  // ポート範囲設定
  const [portRangeStart, setPortRangeStart] = useState('')
  const [portRangeEnd,   setPortRangeEnd]   = useState('')
  const [portRangeSaved, setPortRangeSaved] = useState(false)

  const load = () => api.proxyPresets.list().then(setPresets)
  const loadPortStats = () => api.accounts.proxyPortStats().then(setPortStats)
  const loadUrlCounts = () => api.accounts.proxyUrlCounts().then(setUrlCounts)
  useEffect(() => {
    load(); loadPortStats(); loadUrlCounts()
    api.settings.getAll().then(s => {
      setPortRangeStart(s['proxy_port_range_start'] ?? '')
      setPortRangeEnd(s['proxy_port_range_end'] ?? '')
    })
  }, [])

  const handleAdd = async (v: PresetFormState) => {
    setSaving(true)
    await api.proxyPresets.create({
      name: v.name.trim(), type: v.type, host: v.host.trim(),
      port: Number(v.port), username: v.username.trim() || null, password: v.password || null,
    })
    setSaving(false)
    setMode('idle')
    load()
  }

  const handleEdit = async (v: PresetFormState) => {
    if (!editTarget) return
    setSaving(true)
    await api.proxyPresets.update({
      id: editTarget.id, name: v.name.trim(), type: v.type, host: v.host.trim(),
      port: Number(v.port), username: v.username.trim() || null, password: v.password || null,
    })
    setSaving(false)
    setMode('idle')
    setEditTarget(null)
    load()
  }

  const handleDelete = async (id: number) => {
    await api.proxyPresets.delete(id)
    setDeleteConfirm(null)
    load()
  }

  const startEdit = (p: ProxyPreset) => {
    setEditTarget(p)
    setMode('edit')
  }

  const TYPE_BADGE: Record<string, string> = {
    http:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
    https:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    socks5: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center shrink-0 text-base">
          🔒
        </div>
        <div>
          <p className="text-white font-semibold text-sm">プロキシ管理</p>
          <p className="text-zinc-500 text-xs">よく使うプロキシをプリセットとして保存・管理</p>
        </div>
        {mode === 'idle' && (
          <button
            onClick={() => setMode('add')}
            className="ml-auto px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold rounded-lg transition-colors"
          >+ 追加</button>
        )}
      </div>

      {/* ── ポート範囲設定 ── */}
      <div className="mb-4 p-3 bg-zinc-800 rounded-xl border border-zinc-700 space-y-2">
        <p className="text-zinc-400 text-[11px] font-semibold">ポート範囲</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={portRangeStart}
            onChange={e => setPortRangeStart(e.target.value)}
            placeholder="開始 (例: 10001)"
            className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 font-mono"
          />
          <span className="text-zinc-500 text-xs">〜</span>
          <input
            type="number"
            value={portRangeEnd}
            onChange={e => setPortRangeEnd(e.target.value)}
            placeholder="終了 (例: 10050)"
            className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 font-mono"
          />
          <button
            onClick={async () => {
              await api.settings.setMany({
                proxy_port_range_start: portRangeStart.trim(),
                proxy_port_range_end:   portRangeEnd.trim(),
              })
              setPortRangeSaved(true)
              loadPortStats()
              setTimeout(() => setPortRangeSaved(false), 2000)
            }}
            className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            {portRangeSaved ? '✓ 保存' : '保存'}
          </button>
        </div>
        <p className="text-zinc-600 text-[9px] leading-tight">
          ポート使用状況・自動割り当ての範囲を指定。空欄の場合は既存アカウントから自動算出。
        </p>
      </div>

      {/* ── ポート使用状況 ── */}
      {portStats.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-zinc-400 text-xs font-semibold uppercase tracking-wide">ポート使用状況</p>
          {portStats.map((s) => {
            const pct = Math.round((s.usedPortCount / s.totalInRange) * 100)
            const isExpanded = showDetail === s.host
            const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-teal-500'

            // 垢数ごとの内訳
            const count1 = s.portEntries.filter(e => e.count === 1).length
            const count2 = s.portEntries.filter(e => e.count === 2).length
            const count3 = s.portEntries.filter(e => e.count >= 3).length

            return (
              <div key={s.host} className="bg-zinc-800 rounded-xl p-3 border border-zinc-700 space-y-2">
                {/* ヘッダー行 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white text-xs font-semibold truncate">{s.host}</span>
                  <span className={`text-xs font-bold shrink-0 ${pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-amber-400' : 'text-teal-400'}`}>
                    {s.usedPortCount} / {s.totalInRange} ポート使用中
                  </span>
                </div>
                {/* プログレスバー */}
                <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                {/* 内訳バッジ */}
                <div className="flex flex-wrap items-center gap-2">
                  {count1 > 0 && (
                    <span className="px-2 py-0.5 bg-teal-500/15 text-teal-400 border border-teal-500/30 rounded-md text-[11px] font-medium">
                      1垢: {count1}ポート
                    </span>
                  )}
                  {count2 > 0 && (
                    <span className="px-2 py-0.5 bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-md text-[11px] font-medium">
                      2垢: {count2}ポート
                    </span>
                  )}
                  {count3 > 0 && (
                    <span className="px-2 py-0.5 bg-red-500/15 text-red-400 border border-red-500/30 rounded-md text-[11px] font-medium">
                      3垢以上: {count3}ポート
                    </span>
                  )}
                  {s.unusedPorts.length > 0 && (
                    <span className="px-2 py-0.5 bg-zinc-700 text-zinc-500 border border-zinc-600 rounded-md text-[11px]">
                      未使用: {s.unusedPorts.length}ポート
                    </span>
                  )}
                  <button
                    onClick={() => setShowDetail(isExpanded ? null : s.host)}
                    className="ml-auto text-[11px] text-zinc-400 hover:text-white transition-colors shrink-0"
                  >
                    {isExpanded ? '▲ 閉じる' : '▼ 詳細を表示'}
                  </button>
                </div>
                {/* 詳細一覧 */}
                {isExpanded && (
                  <div className="pt-2 border-t border-zinc-700">
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1">
                      {s.portEntries.map(({ port, count }) => (
                        <div
                          key={port}
                          className={`flex items-center justify-between px-2 py-1 rounded text-[11px] font-mono ${
                            count >= 3 ? 'bg-red-500/10 text-red-400'
                            : count === 2 ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-zinc-700/60 text-zinc-300'
                          }`}
                        >
                          <span>{port}</span>
                          <span className="font-sans text-[10px] opacity-80">{count}垢</span>
                        </div>
                      ))}
                      {s.unusedPorts.map(port => (
                        <div
                          key={`u-${port}`}
                          className="flex items-center justify-between px-2 py-1 rounded text-[11px] font-mono bg-zinc-800 text-zinc-600"
                        >
                          <span>{port}</span>
                          <span className="font-sans text-[10px]">未使用</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Preset list */}
      {presets.length > 0 && (
        <div className="space-y-2 mb-3">
          {presets.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3 bg-zinc-800 rounded-xl border border-zinc-700">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-white text-sm font-medium truncate">{p.name}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${TYPE_BADGE[p.type] ?? ''}`}>
                    {p.type.toUpperCase()}
                  </span>
                </div>
                <p className="text-zinc-400 text-xs font-mono truncate">
                  {p.host}:{p.port}
                  {p.username && <span className="text-zinc-600"> · {p.username}</span>}
                  {(() => {
                    const key = `${p.type}://${p.host}:${p.port}`
                    const count = urlCounts[key] ?? 0
                    return count > 0
                      ? <span className="text-zinc-400 not-italic font-sans"> · {count}垢使用中</span>
                      : <span className="text-zinc-600 not-italic font-sans"> · 未使用</span>
                  })()}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => startEdit(p)}
                  disabled={mode !== 'idle'}
                  className="px-2.5 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-zinc-300 text-xs rounded-lg transition-colors"
                >編集</button>
                {deleteConfirm === p.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="px-2.5 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg transition-colors"
                    >確認</button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="px-2.5 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors"
                    >✕</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(p.id)}
                    disabled={mode !== 'idle'}
                    className="px-2.5 py-1.5 bg-zinc-700 hover:bg-red-600/30 disabled:opacity-30 text-zinc-400 hover:text-red-400 text-xs rounded-lg transition-colors"
                  >削除</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {presets.length === 0 && mode === 'idle' && (
        <p className="text-zinc-600 text-xs py-3 text-center">プリセットが登録されていません</p>
      )}

      {/* Add/Edit form */}
      {mode === 'add' && (
        <PresetForm
          initial={emptyForm()}
          onSave={handleAdd}
          onCancel={() => setMode('idle')}
          saving={saving}
        />
      )}
      {mode === 'edit' && editTarget && (
        <PresetForm
          initial={{
            name: editTarget.name, type: editTarget.type,
            host: editTarget.host, port: String(editTarget.port),
            username: editTarget.username ?? '', password: editTarget.password ?? '',
          }}
          onSave={handleEdit}
          onCancel={() => { setMode('idle'); setEditTarget(null) }}
          saving={saving}
        />
      )}
    </div>
  )
}

// ── Image Groups section ──────────────────────────────────────────────────────

function parseImageCsv(text: string): { group1: string[]; group2: string[] } {
  const group1: string[] = []
  const group2: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(',').map((c) => c.trim())
    if (cols[0]) group1.push(cols[0])
    if (cols[1]) group2.push(cols[1])
  }
  return { group1, group2 }
}

export function ImageGroupsSection() {
  const [groups, setGroups]   = useState<{ group1: string[]; group2: string[] }>({ group1: [], group2: [] })
  const [saving, setSaving]   = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const [newUrl1, setNewUrl1] = useState('')
  const [newUrl2, setNewUrl2] = useState('')
  const [csvText, setCsvText] = useState('')
  const [csvOpen, setCsvOpen] = useState(false)
  const fileRef1       = useRef<HTMLInputElement>(null)
  const fileRef2       = useRef<HTMLInputElement>(null)
  const folderRef1     = useRef<HTMLInputElement>(null)
  const folderRef2     = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.imageGroups.get().then((res) => { if (res.success && res.data) setGroups(res.data) })
  }, [])

  const save = async (updated: { group1: string[]; group2: string[] }) => {
    setSaving(true)
    await api.imageGroups.save(updated)
    setSaving(false)
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 2000)
  }

  const addUrl = (slot: 1 | 2) => {
    const url = slot === 1 ? newUrl1.trim() : newUrl2.trim()
    if (!url) return
    const updated = slot === 1
      ? { ...groups, group1: [...groups.group1, url] }
      : { ...groups, group2: [...groups.group2, url] }
    setGroups(updated)
    save(updated)
    if (slot === 1) { setNewUrl1('') } else { setNewUrl2('') }
  }

  const removeUrl = (slot: 1 | 2, idx: number) => {
    const updated = slot === 1
      ? { ...groups, group1: groups.group1.filter((_, i) => i !== idx) }
      : { ...groups, group2: groups.group2.filter((_, i) => i !== idx) }
    setGroups(updated)
    save(updated)
  }

  const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?)$/i

  const handleFileSelect = (slot: 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    const newUrls = files
      .filter(f => IMAGE_EXTS.test(f.name))
      .map(f => `file://${(f as File & { path: string }).path}`)
    if (newUrls.length === 0) return
    const updated = slot === 1
      ? { ...groups, group1: [...groups.group1, ...newUrls] }
      : { ...groups, group2: [...groups.group2, ...newUrls] }
    setGroups(updated)
    save(updated)
    e.target.value = ''
  }

  const importCsv = () => {
    const parsed = parseImageCsv(csvText)
    const updated = {
      group1: [...groups.group1, ...parsed.group1],
      group2: [...groups.group2, ...parsed.group2],
    }
    setGroups(updated)
    save(updated)
    setCsvText('')
    setCsvOpen(false)
  }

  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkResult, setBulkResult]   = useState<string | null>(null)

  const handleBulkRandomize = async () => {
    const totalImages = groups.group1.length + groups.group2.length
    if (totalImages === 0) {
      alert('画像グループに画像が登録されていません。先に画像を追加してください。')
      return
    }
    const ok = window.confirm(
      '全アカウントのストックに対してランダムで画像を挿入します。\n既存の画像設定は上書きされます。よろしいですか？'
    )
    if (!ok) return

    setBulkRunning(true)
    setBulkResult(null)
    try {
      const accounts = await api.accounts.list()
      let totalUpdated = 0
      let errorCount = 0
      for (const account of accounts) {
        const res = await api.stocks.randomizeImages(account.id)
        if (res.success) {
          totalUpdated += res.updated ?? 0
        } else {
          errorCount++
        }
      }
      setBulkResult(
        errorCount > 0
          ? `完了: ${totalUpdated}件更新（${errorCount}アカウントでエラー）`
          : `完了: ${totalUpdated}件のストックに画像を挿入しました`
      )
    } catch (err) {
      setBulkResult(`エラー: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBulkRunning(false)
      setTimeout(() => setBulkResult(null), 4000)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-zinc-300 text-sm font-semibold">🖼 画像グループ管理</h3>
        <div className="flex items-center gap-2">
          {savedMsg    && <span className="text-emerald-400 text-xs">✓ 保存しました</span>}
          {saving      && <span className="text-zinc-500 text-xs">保存中...</span>}
          {bulkResult  && <span className="text-emerald-400 text-xs">{bulkResult}</span>}
          <button
            onClick={handleBulkRandomize}
            disabled={bulkRunning}
            className="px-2.5 py-1 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            {bulkRunning ? '処理中...' : '🎲 全垢一斉ランダム挿入'}
          </button>
          <button
            onClick={() => setCsvOpen((v) => !v)}
            className="px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors whitespace-nowrap"
          >
            CSVインポート
          </button>
        </div>
      </div>

      {csvOpen && (
        <div className="space-y-2 bg-zinc-800 rounded-xl p-3">
          <p className="text-zinc-500 text-xs">1列目=グループ1（1枚目）、2列目=グループ2（2枚目）で貼り付け</p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"https://example.com/img1.jpg,https://example.com/img2.jpg\nhttps://example.com/img3.jpg,https://example.com/img4.jpg"}
            rows={5}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-blue-500 font-mono resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setCsvOpen(false)} className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors">キャンセル</button>
            <button onClick={importCsv} disabled={!csvText.trim()} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors">追加インポート</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {([1, 2] as const).map((slot) => {
          const urls       = slot === 1 ? groups.group1 : groups.group2
          const input      = slot === 1 ? newUrl1 : newUrl2
          const setInput   = slot === 1 ? setNewUrl1 : setNewUrl2
          const fileRef    = slot === 1 ? fileRef1 : fileRef2
          const folderRef  = slot === 1 ? folderRef1 : folderRef2
          return (
            <div key={slot} className="space-y-2">
              <p className="text-zinc-400 text-xs font-semibold">
                {slot}枚目グループ <span className="text-zinc-600 font-normal">{urls.length}件</span>
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {urls.length === 0 && <p className="text-zinc-700 text-xs">画像なし</p>}
                {urls.map((url, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-zinc-800 rounded-lg px-2 py-1.5 group">
                    {url.startsWith('file://') ? (
                      <span className="shrink-0 text-[9px] text-zinc-600 bg-zinc-700 rounded px-1">ローカル</span>
                    ) : (
                      <span className="shrink-0 text-[9px] text-zinc-600 bg-zinc-700 rounded px-1">URL</span>
                    )}
                    <span className="flex-1 text-zinc-400 text-[10px] truncate font-mono">{url}</span>
                    <button
                      onClick={() => removeUrl(slot, i)}
                      className="shrink-0 text-zinc-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-all"
                    >×</button>
                  </div>
                ))}
              </div>
              {/* URL input */}
              <div className="flex gap-1">
                <input
                  type="url"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addUrl(slot)}
                  placeholder="https://..."
                  className="flex-1 min-w-0 px-2 py-1.5 bg-zinc-800 border border-zinc-700 focus:border-blue-500 rounded-lg text-white text-xs placeholder-zinc-600 outline-none transition-colors"
                />
                <button
                  onClick={() => addUrl(slot)}
                  disabled={!input.trim()}
                  className="shrink-0 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                >追加</button>
              </div>
              {/* File / Folder pickers */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect(slot)}
              />
              <input
                ref={folderRef}
                type="file"
                accept="image/*"
                // @ts-expect-error webkitdirectory is not in React types
                webkitdirectory=""
                multiple
                className="hidden"
                onChange={handleFileSelect(slot)}
              />
              <div className="flex gap-1">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex-1 px-2.5 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-semibold rounded-lg transition-colors"
                >📁 ファイルを複数選択</button>
                <button
                  onClick={() => folderRef.current?.click()}
                  className="flex-1 px-2.5 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-semibold rounded-lg transition-colors"
                >🗂 フォルダを選択</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Profile Icon Auto-change section ────────────────────────────────────────

export function StockBulkDeleteSection() {
  const [accounts, setAccounts] = useState<import('../lib/ipc').Account[]>([])
  const [groups,   setGroups]   = useState<import('../lib/ipc').Group[]>([])
  const [groupKey, setGroupKey] = useState<string>('__all__')
  const [running,  setRunning]  = useState(false)
  const [message,  setMessage]  = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    api.accounts.list().then(setAccounts)
    api.groups.list().then(setGroups)
  }, [])

  const targetCount = groupKey === '__all__'
    ? accounts.length
    : groupKey === '__none__'
    ? accounts.filter(a => !a.group_name).length
    : accounts.filter(a => a.group_name === groupKey).length

  const handleDeleteAll = async () => {
    const label = groupKey === '__all__' ? '全アカウント'
      : groupKey === '__none__' ? 'グループなし'
      : `グループ「${groupKey}」`
    if (!confirm(`${label}（${targetCount}件）の全ストックを削除しますか？\nこの操作は取り消せません。`)) return
    setRunning(true)
    setMessage(null)
    try {
      const res = await api.stocks.deleteAllByGroup(groupKey)
      if (res.success) {
        setMessage({ text: `${res.deleted}件のストックを削除しました`, ok: true })
      } else {
        setMessage({ text: `エラー: ${res.error}`, ok: false })
      }
    } catch (err) {
      setMessage({ text: `エラー: ${err instanceof Error ? err.message : String(err)}`, ok: false })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* グループ選択 */}
      <div>
        <label className="text-zinc-400 text-xs font-medium block mb-1">対象グループ</label>
        <select
          value={groupKey}
          onChange={(e) => { setGroupKey(e.target.value); setMessage(null) }}
          className="w-full px-2.5 py-2 bg-zinc-800 border border-zinc-700 focus:border-red-500 rounded-lg text-white text-sm outline-none transition-colors"
        >
          <option value="__all__">全アカウント（{accounts.length}件）</option>
          {groups.map((g) => {
            const count = accounts.filter(a => a.group_name === g.name).length
            return <option key={g.name} value={g.name}>{g.name}（{count}件）</option>
          })}
          {accounts.some(a => !a.group_name) && (
            <option value="__none__">グループなし（{accounts.filter(a => !a.group_name).length}件）</option>
          )}
        </select>
      </div>

      <button
        onClick={handleDeleteAll}
        disabled={running || targetCount === 0}
        className="w-full py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {running ? '削除中...' : `このグループの全ストックを削除（${targetCount}件対象）`}
      </button>

      {message && (
        <p className={`text-xs px-3 py-2 rounded-lg ${message.ok ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}

export function ProfileIconSection() {
  const [accounts, setAccounts]   = useState<import('../lib/ipc').Account[]>([])
  const [groups, setGroups]       = useState<import('../lib/ipc').Group[]>([])
  const [iconGroup, setIconGroup] = useState<string[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string>('__all__')
  const [running, setRunning]     = useState(false)
  const [results, setResults]     = useState<{ username: string; success: boolean; error?: string }[]>([])
  const fileRef    = useRef<HTMLInputElement>(null)

  // ── フォルダ一括変更 ─────────────────────────────────────────────────────
  const [folderPath,   setFolderPath]   = useState<string>('')
  const [folderImages, setFolderImages] = useState<string[]>([])
  const [bulkGroup,    setBulkGroup]    = useState<string>('__all__')
  const [bulkRunning,  setBulkRunning]  = useState(false)
  const [bulkResults,  setBulkResults]  = useState<{ username: string; success: boolean; error?: string }[]>([])
  const dirRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.accounts.list().then(setAccounts)
    api.groups.list().then(setGroups)
    api.imageGroups.get().then((res) => {
      if (res.success && res.data) setIconGroup(res.data.group1)
    })
  }, [])

  const saveIconGroup = async (urls: string[]) => {
    setIconGroup(urls)
    const cur = await api.imageGroups.get()
    const current = cur.success && cur.data ? cur.data : { group1: [], group2: [] }
    await api.imageGroups.save({ ...current, group1: urls })
  }

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const path = (file as File & { path: string }).path
    saveIconGroup([...iconGroup, `file://${path}`])
    e.target.value = ''
  }

  const handleRemove = (idx: number) => {
    saveIconGroup(iconGroup.filter((_, i) => i !== idx))
  }

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i
    const paths: string[] = []
    let folder = ''
    for (let i = 0; i < files.length; i++) {
      const f = files[i] as File & { path: string }
      if (!IMAGE_EXTS.test(f.name)) continue
      paths.push(f.path)
      if (!folder && f.path) {
        folder = f.path.replace(/[/\\][^/\\]+$/, '')
      }
    }
    setFolderPath(folder)
    setFolderImages(paths)
    e.target.value = ''
  }

  const bulkTargetAccounts = bulkGroup === '__all__'
    ? accounts
    : bulkGroup === '__none__'
    ? accounts.filter(a => !a.group_name)
    : accounts.filter(a => a.group_name === bulkGroup)

  const handleBulkRun = async () => {
    if (folderImages.length === 0) { alert('フォルダを選択してください'); return }
    if (bulkTargetAccounts.length === 0) { alert('対象アカウントがありません'); return }
    const label = bulkGroup === '__all__' ? '全アカウント'
      : bulkGroup === '__none__' ? 'グループなし'
      : `グループ「${bulkGroup}」`
    if (!confirm(`${label}（${bulkTargetAccounts.length}件）のアイコンをフォルダ内画像（${folderImages.length}枚）からランダムに変更しますか？`)) return
    setBulkRunning(true)
    setBulkResults([])
    const res: { username: string; success: boolean; error?: string }[] = []
    for (const acc of bulkTargetAccounts) {
      const imgPath = folderImages[Math.floor(Math.random() * folderImages.length)]
      const r = await api.browserView.changeProfilePic(acc.id, imgPath)
      res.push({ username: acc.username, success: r.success, error: r.error })
      setBulkResults([...res])
      if (r.success) await new Promise(resolve => setTimeout(resolve, 2000))
    }
    setBulkRunning(false)
  }

  const targetAccounts = selectedGroup === '__all__'
    ? accounts
    : selectedGroup === '__none__'
    ? accounts.filter(a => !a.group_name)
    : accounts.filter(a => a.group_name === selectedGroup)

  const handleRun = async () => {
    if (iconGroup.length === 0) { alert('アイコン用画像を先に追加してください'); return }
    const label = selectedGroup === '__all__' ? '全アカウント'
      : selectedGroup === '__none__' ? 'グループなし'
      : `グループ「${selectedGroup}」`
    if (!confirm(`${label}（${targetAccounts.length}件）のアイコンをランダムに変更しますか？\nWebContentsView が開いているアカウントのみ変更されます。`)) return
    setRunning(true)
    setResults([])
    const res: { username: string; success: boolean; error?: string }[] = []
    for (const acc of targetAccounts) {
      const imgPath = iconGroup[Math.floor(Math.random() * iconGroup.length)]
      const localPath = imgPath.startsWith('file://') ? new URL(imgPath).pathname : imgPath
      const r = await api.browserView.changeProfilePic(acc.id, localPath)
      res.push({ username: acc.username, success: r.success, error: r.error })
      setResults([...res])
      if (r.success) await new Promise(resolve => setTimeout(resolve, 2000))
    }
    setRunning(false)
  }

  return (
    <div className="space-y-6">

      {/* ── フォルダから一括変更（新機能） ─────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3">
        <h3 className="text-white text-sm font-semibold">フォルダから一括変更</h3>
        <p className="text-zinc-500 text-xs">フォルダ内の画像からランダムに選んでグループ内の全垢のアイコンを変更します</p>

        {/* フォルダ選択 */}
        <div>
          <input
            ref={dirRef}
            type="file"
            // @ts-ignore webkitdirectory is non-standard
            webkitdirectory=""
            className="hidden"
            onChange={handleFolderSelect}
          />
          <button
            onClick={() => dirRef.current?.click()}
            className="w-full px-2.5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-semibold rounded-lg transition-colors text-left"
          >
            📂 フォルダを選択
          </button>
          {folderPath && (
            <div className="mt-1.5 flex items-center gap-2 bg-zinc-800 rounded-lg px-2.5 py-1.5">
              <span className="flex-1 text-zinc-400 text-[10px] font-mono truncate">{folderPath}</span>
              <span className="shrink-0 text-emerald-400 text-[10px] font-semibold">{folderImages.length}枚</span>
              <button
                onClick={() => { setFolderPath(''); setFolderImages([]) }}
                className="shrink-0 text-zinc-600 hover:text-red-400 text-xs"
              >×</button>
            </div>
          )}
        </div>

        {/* グループ選択 */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">対象グループ</label>
          <select
            value={bulkGroup}
            onChange={(e) => setBulkGroup(e.target.value)}
            className="w-full px-2.5 py-2 bg-zinc-800 border border-zinc-700 focus:border-purple-500 rounded-lg text-white text-sm outline-none transition-colors"
          >
            <option value="__all__">全アカウント（{accounts.length}件）</option>
            {groups.map((g) => {
              const count = accounts.filter(a => a.group_name === g.name).length
              return <option key={g.name} value={g.name}>{g.name}（{count}件）</option>
            })}
            {accounts.some(a => !a.group_name) && (
              <option value="__none__">グループなし（{accounts.filter(a => !a.group_name).length}件）</option>
            )}
          </select>
        </div>

        {/* 一括変更ボタン */}
        <button
          onClick={handleBulkRun}
          disabled={bulkRunning || folderImages.length === 0 || bulkTargetAccounts.length === 0}
          className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {bulkRunning
            ? `変更中... (${bulkResults.length}/${bulkTargetAccounts.length})`
            : `一括変更（${bulkTargetAccounts.length}件）`}
        </button>

        {/* 結果表示 */}
        {bulkResults.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {bulkResults.map((r, i) => (
              <div key={i} className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${r.success ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>
                <span>{r.success ? '✓' : '✗'}</span>
                <span className="font-mono">@{r.username}</span>
                {r.error && <span className="text-zinc-500 truncate">{r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 既存：画像リストから変更 ─────────────────────────────────────── */}
      <div className="space-y-4">
        <h3 className="text-white text-sm font-semibold">登録画像から変更</h3>

        {/* アイコン画像リスト */}
        <div>
          <p className="text-zinc-500 text-xs mb-2">登録した画像からランダムに選んでアイコンを変更します</p>
          <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
            {iconGroup.length === 0 && <p className="text-zinc-700 text-xs">画像なし</p>}
            {iconGroup.map((url, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-zinc-800 rounded-lg px-2 py-1.5 group">
                {url.startsWith('file://') && (
                  <img src={url} className="w-6 h-6 rounded-full object-cover shrink-0" />
                )}
                <span className="flex-1 text-zinc-400 text-[10px] truncate font-mono">{url}</span>
                <button onClick={() => handleRemove(i)} className="shrink-0 text-zinc-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-all">×</button>
              </div>
            ))}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileAdd} />
          <button onClick={() => fileRef.current?.click()} className="w-full px-2.5 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-semibold rounded-lg transition-colors">
            📁 アイコン画像を追加
          </button>
        </div>

        {/* グループ選択 */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1">対象グループ</label>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="w-full px-2.5 py-2 bg-zinc-800 border border-zinc-700 focus:border-purple-500 rounded-lg text-white text-sm outline-none transition-colors"
          >
            <option value="__all__">全アカウント（{accounts.length}件）</option>
            {groups.map((g) => {
              const count = accounts.filter(a => a.group_name === g.name).length
              return <option key={g.name} value={g.name}>{g.name}（{count}件）</option>
            })}
            {accounts.some(a => !a.group_name) && (
              <option value="__none__">グループなし（{accounts.filter(a => !a.group_name).length}件）</option>
            )}
          </select>
        </div>

        <button
          onClick={handleRun}
          disabled={running || iconGroup.length === 0 || targetAccounts.length === 0}
          className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {running
            ? '変更中...'
            : `アイコンをランダム変更（${targetAccounts.length}件）`}
        </button>

        {results.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${r.success ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>
                <span>{r.success ? '✓' : '✗'}</span>
                <span>@{r.username}</span>
                {r.error && <span className="text-zinc-500 truncate">{r.error}</span>}
              </div>
            ))}
          </div>
        )}
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

// ── Master Key Admin ──────────────────────────────────────────────────────────

function generateMasterKey(): string {
  const seg = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(3)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  return `MK-${seg()}-${seg()}-${seg()}`
}

function MasterKeyAdmin() {
  const [keys,    setKeys]    = useState<MasterKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const [newKey,     setNewKey]     = useState('')
  const [newExpires, setNewExpires] = useState('')
  const [newMemo,    setNewMemo]    = useState('')
  const [adding,     setAdding]     = useState(false)
  const [addError,   setAddError]   = useState<string | null>(null)

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const fmtDate = (dt: string | null) => {
    if (!dt) return '無期限'
    try {
      return new Date(dt).toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return dt }
  }
  const isExpired = (dt: string | null) => !!dt && new Date(dt) <= new Date()

  const load = async () => {
    setLoading(true); setError(null)
    const r = await api.masterKey.list()
    if (!r.success) { setError(r.error ?? '取得に失敗しました') }
    else { setKeys(r.data ?? []) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKey.trim()) return
    setAdding(true); setAddError(null)
    const r = await api.masterKey.create({
      key: newKey.trim(), is_active: true,
      expires_at: newExpires ? new Date(newExpires).toISOString() : null,
      memo: newMemo.trim() || null,
    })
    if (!r.success) { setAddError(r.error ?? '追加に失敗しました') }
    else { setNewKey(''); setNewExpires(''); setNewMemo(''); await load() }
    setAdding(false)
  }

  const handleToggle = async (row: MasterKeyRow) => {
    const newVal = !row.is_active
    setKeys((prev) => prev.map((r) => r.key === row.key ? { ...r, is_active: newVal } : r))
    const r = await api.masterKey.update({ key: row.key, is_active: newVal })
    if (!r.success) {
      setKeys((prev) => prev.map((r2) => r2.key === row.key ? { ...r2, is_active: row.is_active } : r2))
      alert(r.error)
    }
  }

  const handleDelete = async (key: string) => {
    const r = await api.masterKey.delete(key)
    if (!r.success) { alert(r.error); return }
    setKeys((prev) => prev.filter((r2) => r2.key !== key))
    setDeleteConfirm(null)
  }

  return (
    <div className="space-y-4">
      {/* 新規追加 */}
      <form onSubmit={handleAdd} className="p-4 bg-zinc-800/60 border border-zinc-700/50 rounded-xl space-y-2">
        <p className="text-zinc-300 text-xs font-semibold mb-1">新規キー追加</p>
        <div className="flex gap-2">
          <input
            type="text" value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="MK-XXXXXX-XXXXXX-XXXXXX"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono"
          />
          <button
            type="button" onClick={() => setNewKey(generateMasterKey())}
            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >自動生成</button>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-zinc-500 text-[11px] block mb-1">有効期限（空白=無期限）</label>
            <input
              type="datetime-local" value={newExpires}
              onChange={(e) => setNewExpires(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-zinc-500 text-[11px] block mb-1">メモ</label>
            <input
              type="text" value={newMemo}
              onChange={(e) => setNewMemo(e.target.value)}
              placeholder="用途など"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
        {addError && <p className="text-red-400 text-xs">{addError}</p>}
        <button
          type="submit" disabled={adding || !newKey.trim()}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
        >{adding ? '追加中...' : 'キーを追加'}</button>
      </form>

      {/* 一覧 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-zinc-400 text-xs font-semibold">
            キー一覧
            {!loading && <span className="text-zinc-600 ml-1">({keys.length}件)</span>}
          </p>
          <button onClick={load} disabled={loading}
            className="text-zinc-500 hover:text-zinc-300 text-[11px] transition-colors">
            {loading ? '読込中...' : '↻ 再取得'}
          </button>
        </div>
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs mb-3">{error}</div>
        )}
        {!loading && keys.length === 0 && !error && (
          <p className="text-zinc-600 text-xs text-center py-6">キーがありません</p>
        )}
        <div className="space-y-1.5">
          {keys.map((row) => {
            const expired = isExpired(row.expires_at)
            return (
              <div key={row.key} className={[
                'flex items-center gap-3 p-3 rounded-xl border transition-colors',
                row.is_active && !expired ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-900 border-zinc-800 opacity-60',
              ].join(' ')}>
                <span className={['w-2 h-2 rounded-full shrink-0',
                  row.is_active && !expired ? 'bg-indigo-400' : expired ? 'bg-amber-500' : 'bg-zinc-600',
                ].join(' ')} />
                <div className="flex-1 min-w-0">
                  <code className="text-[11px] font-mono text-zinc-300 block truncate">{row.key}</code>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className={`text-[10px] ${expired ? 'text-amber-400' : 'text-zinc-500'}`}>
                      {expired ? '⚠ 期限切れ: ' : '期限: '}{fmtDate(row.expires_at)}
                    </span>
                    {row.memo && <span className="text-zinc-500 text-[10px]">— {row.memo}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] font-semibold w-6 text-right ${row.is_active ? 'text-indigo-400' : 'text-zinc-600'}`}>
                    {row.is_active ? 'ON' : 'OFF'}
                  </span>
                  <button
                    type="button" onClick={() => handleToggle(row)}
                    className={['relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors cursor-pointer',
                      row.is_active ? 'bg-indigo-600' : 'bg-zinc-600',
                    ].join(' ')}
                  >
                    <span className={['pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-md transition-transform',
                      row.is_active ? 'translate-x-4' : 'translate-x-0',
                    ].join(' ')} />
                  </button>
                </div>
                {deleteConfirm === row.key ? (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => handleDelete(row.key)}
                      className="px-2 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg transition-colors">確認</button>
                    <button onClick={() => setDeleteConfirm(null)}
                      className="px-2 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(row.key)}
                    className="w-6 h-6 flex items-center justify-center text-zinc-600 hover:text-red-400 text-xs rounded transition-colors shrink-0">✕</button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MasterKeyAdminSection() {
  const [unlocked, setUnlocked] = useState(false)
  const [pw,       setPw]       = useState('')
  const [pwError,  setPwError]  = useState(false)

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) { setUnlocked(true); setPwError(false) }
    else { setPwError(true); setPw('') }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 text-base">
          🗝️
        </div>
        <div>
          <p className="text-white font-semibold text-sm">マスターキー管理</p>
          <p className="text-zinc-500 text-xs">予約投稿タブのアクセスキーを管理（管理者専用）</p>
        </div>
        {unlocked && (
          <button onClick={() => setUnlocked(false)}
            className="ml-auto text-zinc-500 hover:text-zinc-300 text-xs transition-colors">
            🔒 ロック
          </button>
        )}
      </div>

      {!unlocked ? (
        <form onSubmit={handleUnlock} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="password" value={pw}
              onChange={(e) => { setPw(e.target.value); setPwError(false) }}
              placeholder="管理者パスワード"
              autoComplete="off"
              className={['flex-1 bg-zinc-800 border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors',
                pwError ? 'border-red-500' : 'border-zinc-700',
              ].join(' ')}
            />
            <button type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors">
              解除
            </button>
          </div>
          {pwError && <p className="text-red-400 text-xs">パスワードが違います</p>}
        </form>
      ) : (
        <MasterKeyAdmin />
      )}
    </div>
  )
}
