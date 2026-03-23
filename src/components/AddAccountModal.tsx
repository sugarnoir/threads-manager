import { useState, useEffect } from 'react'
import { api } from '../lib/ipc'
import type { ProxyPreset } from '../lib/ipc'

type Mode = 'login' | 'register'
type ProxyType = 'none' | 'http' | 'https' | 'socks5'

interface ProxyOptions {
  proxy_url: string
  proxy_username: string
  proxy_password: string
}

interface Props {
  onConfirm: (proxy: ProxyOptions | null, mode: Mode) => void
  onCancel: () => void
}

function ProxyForm({
  proxyType, setProxyType,
  host, setHost,
  port, setPort,
  username, setUsername,
  password, setPassword,
  presets,
}: {
  proxyType: ProxyType; setProxyType: (v: ProxyType) => void
  host: string; setHost: (v: string) => void
  port: string; setPort: (v: string) => void
  username: string; setUsername: (v: string) => void
  password: string; setPassword: (v: string) => void
  presets: ProxyPreset[]
}) {
  const [showPw, setShowPw] = useState(false)

  const applyPreset = (id: string) => {
    if (!id) return
    const p = presets.find((x) => String(x.id) === id)
    if (!p) return
    setProxyType(p.type as ProxyType)
    setHost(p.host)
    setPort(String(p.port))
    setUsername(p.username ?? '')
    setPassword(p.password ?? '')
  }

  return (
    <div className="space-y-3">
      {presets.length > 0 && (
        <div>
          <label className="text-zinc-400 text-xs font-medium block mb-1.5">プリセットから選択</label>
          <select
            defaultValue=""
            onChange={(e) => applyPreset(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">── プリセットを選択 ──</option>
            {presets.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}　{p.type.toUpperCase()} {p.host}:{p.port}
              </option>
            ))}
          </select>
        </div>
      )}
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
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
              >
                {showPw ? '隠す' : '表示'}
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
    </div>
  )
}

export function AddAccountModal({ onConfirm, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>('login')

  const [proxyType, setProxyType] = useState<ProxyType>('none')
  const [host, setHost]           = useState('')
  const [port, setPort]           = useState('')
  const [username, setUsername]   = useState('')
  const [password, setPassword]   = useState('')
  const [presets, setPresets]     = useState<ProxyPreset[]>([])

  useEffect(() => {
    api.proxyPresets.list().then(setPresets).catch(() => {})
  }, [])

  const buildProxy = (): ProxyOptions | null => {
    if (proxyType === 'none' || !host || !port) return null
    return {
      proxy_url:      `${proxyType}://${host}:${port}`,
      proxy_username: username,
      proxy_password: password,
    }
  }

  const handleSubmit = () => {
    if (proxyType !== 'none' && (!host || !port)) return
    onConfirm(buildProxy(), mode)
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[440px] p-6 space-y-5">

        {/* Header */}
        <div>
          <h3 className="text-white font-bold text-sm">アカウントを追加</h3>
          <p className="text-zinc-500 text-xs mt-1">追加方法を選択してください</p>
        </div>

        {/* Mode tabs */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode('login')}
            className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border transition-all ${
              mode === 'login'
                ? 'bg-blue-600/15 border-blue-500 text-blue-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            <span className="text-xl">🔑</span>
            <div className="text-center">
              <p className="text-xs font-bold">ログイン</p>
              <p className="text-[10px] text-zinc-500 mt-0.5 leading-tight">既存のアカウントで<br/>ログイン</p>
            </div>
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border transition-all ${
              mode === 'register'
                ? 'bg-emerald-600/15 border-emerald-500 text-emerald-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            <span className="text-xl">✨</span>
            <div className="text-center">
              <p className="text-xs font-bold">新規アカウント作成</p>
              <p className="text-[10px] text-zinc-500 mt-0.5 leading-tight">Instagramを新規登録して<br/>Threadsに接続</p>
            </div>
          </button>
        </div>

        {/* Mode description */}
        {mode === 'register' && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 space-y-1">
            <p className="text-emerald-400 text-xs font-semibold">新規登録の流れ</p>
            <ol className="text-zinc-400 text-[11px] space-y-0.5 list-decimal list-inside">
              <li>Instagramの登録ページが開きます</li>
              <li>メール/電話番号でアカウントを作成</li>
              <li>そのままThreadsにログイン</li>
              <li>完了後、自動でリストに追加されます</li>
            </ol>
          </div>
        )}

        {/* Proxy form */}
        <ProxyForm
          proxyType={proxyType} setProxyType={setProxyType}
          host={host} setHost={setHost}
          port={port} setPort={setPort}
          username={username} setUsername={setUsername}
          password={password} setPassword={setPassword}
          presets={presets}
        />

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={proxyType !== 'none' && (!host || !port)}
            className={`flex-1 py-2 text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors ${
              mode === 'register'
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {mode === 'login' ? 'ログインウィンドウを開く' : '登録ページを開く'}
          </button>
        </div>
      </div>
    </div>
  )
}
