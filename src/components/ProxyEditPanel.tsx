import { useState } from 'react'
import { Account } from '../lib/ipc'

interface Props {
  account: Account
  onSave: (data: {
    proxy_url: string | null
    proxy_username: string | null
    proxy_password: string | null
  }) => Promise<unknown>
  onClose: () => void
}

type ProxyType = 'none' | 'http' | 'https' | 'socks5'

function parseProxyUrl(url: string | null): { type: ProxyType; host: string; port: string } {
  if (!url) return { type: 'none', host: '', port: '' }
  const match = url.match(/^(https?|socks5):\/\/([^:]+):(\d+)/)
  if (!match) return { type: 'none', host: '', port: '' }
  return { type: match[1] as ProxyType, host: match[2], port: match[3] }
}

export function ProxyEditPanel({ account, onSave, onClose }: Props) {
  const parsed = parseProxyUrl(account.proxy_url)
  const [proxyType, setProxyType] = useState<ProxyType>(parsed.type)
  const [host, setHost]           = useState(parsed.host)
  const [port, setPort]           = useState(parsed.port)
  const [username, setUsername]   = useState(account.proxy_username ?? '')
  const [password, setPassword]   = useState(account.proxy_password ?? '')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      if (proxyType === 'none') {
        await onSave({ proxy_url: null, proxy_username: null, proxy_password: null })
      } else {
        await onSave({
          proxy_url: `${proxyType}://${host}:${port}`,
          proxy_username: username || null,
          proxy_password: password || null,
        })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[420px] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-sm">プロキシ設定</h3>
          <span className="text-zinc-500 text-xs">@{account.username}</span>
        </div>

        {/* プロキシ種別 */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-2">種別</label>
          <div className="grid grid-cols-4 gap-1.5">
            {(['none', 'http', 'https', 'socks5'] as ProxyType[]).map((t) => (
              <button
                key={t}
                onClick={() => setProxyType(t)}
                className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                  proxyType === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                }`}
              >
                {t === 'none' ? 'なし' : t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {proxyType !== 'none' && (
          <div className="space-y-3 bg-zinc-800 rounded-xl p-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-zinc-500 text-xs block mb-1">ホスト</label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="proxy.example.com"
                  className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="w-24">
                <label className="text-zinc-500 text-xs block mb-1">ポート</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="8080"
                  className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="text-zinc-500 text-xs block mb-1">ユーザー名 <span className="text-zinc-600">(任意)</span></label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-zinc-500 text-xs block mb-1">パスワード <span className="text-zinc-600">(任意)</span></label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
                >
                  {showPassword ? '隠す' : '表示'}
                </button>
              </div>
            </div>
            {host && port && (
              <p className="text-xs text-blue-400 font-mono bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-lg">
                {proxyType}://{host}:{port}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (proxyType !== 'none' && (!host || !port))}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
