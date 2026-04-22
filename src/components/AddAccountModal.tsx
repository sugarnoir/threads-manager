import { useState, useEffect } from 'react'
import { api } from '../lib/ipc'
import type { ProxyPreset } from '../lib/ipc'

type Mode = 'login' | 'instagram' | 'x'
type ProxyType = 'none' | 'http' | 'https' | 'socks5'

interface ProxyOptions {
  proxy_url: string
  proxy_username: string
  proxy_password: string
}

interface Props {
  onConfirm: (proxy: ProxyOptions | null, mode: Mode) => void
  onXTokenLogin?: (authToken: string, proxy: ProxyOptions | null) => void
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

export function AddAccountModal({ onConfirm, onXTokenLogin, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [xLoginMethod, setXLoginMethod] = useState<'browser' | 'token'>('browser')
  const [xAuthToken, setXAuthToken] = useState('')

  const [proxyType, setProxyType] = useState<ProxyType>('none')
  const [host, setHost]           = useState('')
  const [port, setPort]           = useState('')
  const [username, setUsername]   = useState('')
  const [password, setPassword]   = useState('')
  const [presets, setPresets]     = useState<ProxyPreset[]>([])
  const [currentIp, setCurrentIp] = useState<string | null>(null)
  const [checkingIp, setCheckingIp] = useState(false)

  useEffect(() => {
    api.proxyPresets.list().then(setPresets).catch(() => {})
    // プロキシテンプレートを初期値として読み込む
    api.settings.getAll().then((s) => {
      const tmplType = s.proxy_template_type as ProxyType | 'none' | undefined
      if (tmplType && tmplType !== 'none') {
        setProxyType(tmplType)
        setHost(s.proxy_template_host ?? '')
        setPort(s.proxy_template_port ?? '')
        setUsername(s.proxy_template_username ?? '')
        setPassword(s.proxy_template_password ?? '')
      }
    }).catch(() => {})
  }, [])

  // プロキシ設定が確定したときにIPチェック
  useEffect(() => {
    if (proxyType === 'none') {
      setCurrentIp('__none__')
      return
    }
    if (!host || !port) {
      setCurrentIp(null)
      return
    }
    setCheckingIp(true)
    setCurrentIp(null)
    const proxyUrl = `${proxyType}://${host}:${port}`
    api.accounts.checkIp({ proxy_url: proxyUrl, proxy_username: username || undefined, proxy_password: password || undefined })
      .then(r => setCurrentIp(r.ip ?? 'エラー'))
      .catch(() => setCurrentIp('エラー'))
      .finally(() => setCheckingIp(false))
  }, [proxyType, host, port, username, password])

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
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[460px] p-6 space-y-5">

        {/* Header */}
        <div>
          <h3 className="text-white font-bold text-sm">アカウントを追加</h3>
          <p className="text-zinc-500 text-xs mt-1">追加方法を選択してください</p>
        </div>

        {/* Mode tabs */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setMode('login')}
            className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all ${
              mode === 'login'
                ? 'bg-blue-600/15 border-blue-500 text-blue-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            <span className="text-lg">🔑</span>
            <div className="text-center">
              <p className="text-[11px] font-bold leading-tight">ログイン</p>
              <p className="text-[9px] text-zinc-500 mt-0.5 leading-tight">既存アカで<br/>即ログイン</p>
            </div>
          </button>
          <button
            onClick={() => setMode('instagram')}
            className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all ${
              mode === 'instagram'
                ? 'bg-pink-600/15 border-pink-500 text-pink-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            <span className="text-lg">📷</span>
            <div className="text-center">
              <p className="text-[11px] font-bold leading-tight">Instagram</p>
              <p className="text-[9px] text-zinc-500 mt-0.5 leading-tight">IGアカウント<br/>追加</p>
            </div>
          </button>
          <button
            onClick={() => setMode('x')}
            className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all ${
              mode === 'x'
                ? 'bg-zinc-500/15 border-zinc-400 text-zinc-200'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            <span className="text-lg font-bold">𝕏</span>
            <div className="text-center">
              <p className="text-[11px] font-bold leading-tight">X</p>
              <p className="text-[9px] text-zinc-500 mt-0.5 leading-tight">Xアカウント<br/>追加</p>
            </div>
          </button>
        </div>

        {/* Mode description */}
        {mode === 'instagram' && (
          <div className="bg-pink-500/10 border border-pink-500/20 rounded-xl px-4 py-3 space-y-1">
            <p className="text-pink-400 text-xs font-semibold">Instagram アカウント追加</p>
            <ol className="text-zinc-400 text-[11px] space-y-0.5 list-decimal list-inside">
              <li>Instagramのログイン画面が開きます</li>
              <li>ログインすると自動でTMに追加されます</li>
            </ol>
          </div>
        )}

        {mode === 'x' && (
          <div className="bg-zinc-500/10 border border-zinc-500/20 rounded-xl px-4 py-3 space-y-2">
            <div className="flex gap-1 bg-zinc-800/60 p-0.5 rounded-lg">
              <button
                onClick={() => setXLoginMethod('browser')}
                className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-colors ${
                  xLoginMethod === 'browser' ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                ブラウザでログイン
              </button>
              <button
                onClick={() => setXLoginMethod('token')}
                className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-colors ${
                  xLoginMethod === 'token' ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                トークンでログイン
              </button>
            </div>
            {xLoginMethod === 'browser' && (
              <ol className="text-zinc-400 text-[11px] space-y-0.5 list-decimal list-inside">
                <li>X (Twitter) のログイン画面が開きます</li>
                <li>ログインすると自動でTMに追加されます</li>
              </ol>
            )}
            {xLoginMethod === 'token' && (
              <div className="space-y-2">
                <p className="text-zinc-400 text-[11px]">
                  ブラウザの Cookie から <code className="text-zinc-300 bg-zinc-800 px-1 rounded">auth_token</code> を取得して貼り付け
                </p>
                <input
                  type="text"
                  value={xAuthToken}
                  onChange={e => setXAuthToken(e.target.value)}
                  placeholder="auth_token の値を入力..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            )}
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

        {/* IP表示 */}
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 rounded-lg text-xs">
          <span className="text-zinc-400">現在のIP:</span>
          {checkingIp && <span className="text-zinc-500">確認中...</span>}
          {!checkingIp && currentIp === '__none__' && <span className="text-zinc-500">プロキシなし</span>}
          {!checkingIp && currentIp && currentIp !== '__none__' && (
            <span className={currentIp === 'エラー' ? 'text-red-400' : 'text-emerald-400 font-mono'}>{currentIp}</span>
          )}
          {!checkingIp && currentIp === null && proxyType !== 'none' && (
            <span className="text-zinc-600">ホスト/ポートを入力してください</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
          >
            キャンセル
          </button>
          {mode === 'x' && xLoginMethod === 'token' ? (
            <button
              onClick={() => { onXTokenLogin?.(xAuthToken.trim(), buildProxy()) }}
              disabled={!xAuthToken.trim()}
              className="flex-1 py-2 bg-zinc-600 hover:bg-zinc-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              トークンでログイン
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={proxyType !== 'none' && (!host || !port)}
              className={`flex-1 py-2 text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors ${
                mode === 'instagram'
                  ? 'bg-pink-600 hover:bg-pink-500'
                  : mode === 'x'
                  ? 'bg-zinc-600 hover:bg-zinc-500'
                  : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              {mode === 'login'     ? 'ログインウィンドウを開く'
                : mode === 'instagram' ? 'Instagramを開く'
                : 'X (Twitter) を開く'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
