import { useState, useEffect, useRef } from 'react'
import { api, ProxyPreset, MasterKeyRow } from '../lib/ipc'
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

  // 表示設定
  const [showAccountNumbers, setShowAccountNumbers] = useState(
    () => localStorage.getItem('showAccountNumbers') === 'true'
  )

  const handleToggleAccountNumbers = () => {
    const next = !showAccountNumbers
    setShowAccountNumbers(next)
    localStorage.setItem('showAccountNumbers', String(next))
    window.dispatchEvent(new Event('showAccountNumbersChanged'))
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

export function ProxyPresetsSection() {
  const [presets, setPresets] = useState<ProxyPreset[]>([])
  const [mode, setMode]       = useState<'idle' | 'add' | 'edit'>('idle')
  const [editTarget, setEditTarget] = useState<ProxyPreset | null>(null)
  const [saving, setSaving]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const load = () => api.proxyPresets.list().then(setPresets)
  useEffect(() => { load() }, [])

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
  const fileRef1 = useRef<HTMLInputElement>(null)
  const fileRef2 = useRef<HTMLInputElement>(null)

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

  const handleFileSelect = (slot: 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const path = (file as File & { path: string }).path
    const fileUrl = `file://${path}`
    const updated = slot === 1
      ? { ...groups, group1: [...groups.group1, fileUrl] }
      : { ...groups, group2: [...groups.group2, fileUrl] }
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
          const urls     = slot === 1 ? groups.group1 : groups.group2
          const input    = slot === 1 ? newUrl1 : newUrl2
          const setInput = slot === 1 ? setNewUrl1 : setNewUrl2
          const fileRef  = slot === 1 ? fileRef1 : fileRef2
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
              {/* File picker */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect(slot)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full px-2.5 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-semibold rounded-lg transition-colors"
              >📁 ファイルを選択</button>
            </div>
          )
        })}
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
