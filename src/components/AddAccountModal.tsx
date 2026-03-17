import { useState } from 'react'

interface Props {
  onConfirm: (proxy: {
    proxy_url: string
    proxy_username: string
    proxy_password: string
  } | null) => void
  onCancel: () => void
}

type ProxyType = 'none' | 'http' | 'https' | 'socks5'

export function AddAccountModal({ onConfirm, onCancel }: Props) {
  const [proxyType, setProxyType] = useState<ProxyType>('none')
  const [host, setHost]           = useState('')
  const [port, setPort]           = useState('')
  const [username, setUsername]   = useState('')
  const [password, setPassword]   = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = () => {
    if (proxyType === 'none') { onConfirm(null); return }
    if (!host || !port) return
    onConfirm({
      proxy_url: `${proxyType}://${host}:${port}`,
      proxy_username: username,
      proxy_password: password,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[420px] p-6 space-y-5">
        <div>
          <h3 className="text-white font-bold text-sm">アカウントを追加</h3>
          <p className="text-zinc-500 text-xs mt-1">「続行」をクリックするとログインウィンドウが開きます</p>
        </div>

        {/* プロキシ種別 */}
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-2">プロキシ設定</label>
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
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white">
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
          <button onClick={onCancel}
            className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors">
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={proxyType !== 'none' && (!host || !port)}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors">
            続行 (ログインウィンドウを開く)
          </button>
        </div>
      </div>
    </div>
  )
}
