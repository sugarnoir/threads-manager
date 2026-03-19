import React, { useState, useEffect } from 'react'
import { User, Shield, FileText, Bookmark, Settings } from 'lucide-react'
import { Account, PostStock, api } from '../lib/ipc'

interface Props {
  account: Account
  onSaveDisplayName: (display_name: string | null) => Promise<unknown>
  onSaveProxy: (data: {
    proxy_url: string | null
    proxy_username: string | null
    proxy_password: string | null
  }) => Promise<unknown>
  onSaveMemo: (memo: string | null) => Promise<unknown>
  onSaveSpeedPreset: (preset: 'slow' | 'normal' | 'fast') => Promise<unknown>
  onClearCookies: () => Promise<unknown>
  onDelete: () => Promise<unknown>
  onOpenBrowser: () => void
  onClose: () => void
}

type Tab = 'profile' | 'proxy' | 'memo' | 'stocks' | 'danger'
type ProxyType = 'none' | 'http' | 'https' | 'socks5'

function parseProxyUrl(url: string | null): { type: ProxyType; host: string; port: string } {
  if (!url) return { type: 'none', host: '', port: '' }
  const match = url.match(/^(https?|socks5):\/\/([^:]+):(\d+)/)
  if (!match) return { type: 'none', host: '', port: '' }
  return { type: match[1] as ProxyType, host: match[2], port: match[3] }
}

const GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-pink-500 to-rose-500',
  'from-amber-500 to-orange-500',
  'from-teal-500 to-emerald-500',
  'from-indigo-500 to-blue-600',
]
function gradient(id: number) {
  return GRADIENTS[id % GRADIENTS.length]
}

const STATUS_COLOR: Record<Account['status'], string> = {
  active:      'bg-emerald-400',
  inactive:    'bg-zinc-500',
  needs_login: 'bg-amber-400',
  frozen:      'bg-red-500',
  error:       'bg-red-400',
}
const STATUS_LABEL: Record<Account['status'], string> = {
  active:      'ログイン中',
  inactive:    '未確認',
  needs_login: '要ログイン',
  frozen:      '凍結',
  error:       'エラー',
}

// ── Stocks tab ────────────────────────────────────────────────────────────────

const STOCK_MAX = 20

function StocksTab({ accountId }: { accountId: number }) {
  const [stocks, setStocks]     = useState<PostStock[]>([])
  const [loading, setLoading]   = useState(true)
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)

  // form state
  const [fTitle, setFTitle]     = useState('')
  const [fContent, setFContent] = useState('')
  const [fImage, setFImage]     = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    try {
      api.stocks.list(accountId)
        .then((res) => {
          if (res.success) setStocks(res.data)
          setLoading(false)
        })
        .catch(() => setLoading(false))
    } catch {
      setLoading(false)
    }
  }, [accountId])

  const openNew = () => {
    setFTitle(''); setFContent(''); setFImage(''); setError(null)
    setEditingId('new')
  }

  const openEdit = (s: PostStock) => {
    setFTitle(s.title ?? ''); setFContent(s.content); setFImage(s.image_url ?? ''); setError(null)
    setEditingId(s.id)
  }

  const cancelEdit = () => { setEditingId(null); setError(null) }

  const handleSave = async () => {
    if (!fContent.trim()) return
    setSaving(true); setError(null)
    try {
      if (editingId === 'new') {
        const res = await api.stocks.create({
          account_id: accountId,
          title:     fTitle.trim() || null,
          content:   fContent.trim(),
          image_url: fImage.trim() || null,
        })
        if (!res.success) throw new Error(res.error)
        setStocks((prev) => [...prev, res.data])
      } else if (typeof editingId === 'number') {
        const res = await api.stocks.update({
          id:        editingId,
          title:     fTitle.trim() || null,
          content:   fContent.trim(),
          image_url: fImage.trim() || null,
        })
        if (!res.success) throw new Error(res.error)
        setStocks((prev) => prev.map((s) => s.id === editingId ? res.data : s))
      }
      setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      const res = await api.stocks.delete(id)
      if (res.success) setStocks((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading) return <p className="text-zinc-500 text-sm text-center py-6">読み込み中...</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-zinc-400 text-xs font-semibold">
          投稿ストック <span className="text-zinc-600">{stocks.length}/{STOCK_MAX}</span>
        </p>
        {stocks.length < STOCK_MAX && editingId === null && (
          <button
            onClick={openNew}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            + 追加
          </button>
        )}
      </div>

      {/* Stock list */}
      {stocks.length === 0 && editingId === null && (
        <p className="text-zinc-600 text-xs text-center py-4">ストックがありません</p>
      )}

      {stocks.map((s) => (
        <div key={s.id}>
          {editingId === s.id ? (
            <StockForm
              title={fTitle} content={fContent} imageUrl={fImage}
              onTitle={setFTitle} onContent={setFContent} onImage={setFImage}
              onSave={handleSave} onCancel={cancelEdit}
              saving={saving} error={error}
            />
          ) : (
            <div className="bg-zinc-800 rounded-xl p-3 space-y-1.5">
              {s.title && <p className="text-zinc-300 text-xs font-semibold">{s.title}</p>}
              <p className="text-zinc-200 text-xs leading-relaxed line-clamp-2">{s.content}</p>
              {s.image_url && (
                <p className="text-blue-400 text-[10px] truncate">🖼 {s.image_url}</p>
              )}
              <div className="flex gap-1.5 pt-0.5">
                <button
                  onClick={() => openEdit(s)}
                  className="px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[11px] rounded-lg transition-colors"
                >
                  編集
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600 border border-red-600/30 hover:border-transparent text-red-400 hover:text-white text-[11px] rounded-lg transition-all"
                >
                  削除
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* New stock form */}
      {editingId === 'new' && (
        <StockForm
          title={fTitle} content={fContent} imageUrl={fImage}
          onTitle={setFTitle} onContent={setFContent} onImage={setFImage}
          onSave={handleSave} onCancel={cancelEdit}
          saving={saving} error={error}
        />
      )}
    </div>
  )
}

function StockForm({
  title, content, imageUrl,
  onTitle, onContent, onImage,
  onSave, onCancel, saving, error,
}: {
  title: string; content: string; imageUrl: string
  onTitle: (v: string) => void; onContent: (v: string) => void; onImage: (v: string) => void
  onSave: () => void; onCancel: () => void
  saving: boolean; error: string | null
}) {
  return (
    <div className="bg-zinc-800 border border-blue-500/30 rounded-xl p-3 space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        placeholder="タイトル（任意）"
        className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
      />
      <textarea
        value={content}
        onChange={(e) => onContent(e.target.value)}
        placeholder="投稿テキスト *"
        rows={3}
        maxLength={500}
        className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
      />
      <input
        type="text"
        value={imageUrl}
        onChange={(e) => onImage(e.target.value)}
        placeholder="画像URL（任意）"
        className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 font-mono"
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors"
        >
          キャンセル
        </button>
        <button
          onClick={onSave}
          disabled={saving || !content.trim()}
          className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────────

export function AccountEditModal({
  account,
  onSaveDisplayName,
  onSaveProxy,
  onSaveMemo,
  onSaveSpeedPreset,
  onClearCookies,
  onDelete,
  onOpenBrowser,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('profile')

  // Profile state
  const [displayName, setDisplayName] = useState(account.display_name ?? '')
  const [savingDisplayName, setSavingDisplayName] = useState(false)

  // Speed preset state
  const [speedPreset, setSpeedPreset] = useState<'slow' | 'normal' | 'fast'>(account.speed_preset ?? 'normal')
  const [savingSpeed, setSavingSpeed] = useState(false)

  const handleSaveDisplayName = async () => {
    setSavingDisplayName(true)
    try {
      await onSaveDisplayName(displayName.trim() || null)
      onClose()
    } finally {
      setSavingDisplayName(false)
    }
  }

  const handleSaveSpeedPreset = async () => {
    setSavingSpeed(true)
    try {
      await onSaveSpeedPreset(speedPreset)
    } finally {
      setSavingSpeed(false)
    }
  }

  // Proxy state
  const parsed = parseProxyUrl(account.proxy_url)
  const [proxyType, setProxyType] = useState<ProxyType>(parsed.type)
  const [host, setHost]           = useState(parsed.host)
  const [port, setPort]           = useState(parsed.port)
  const [username, setUsername]   = useState(account.proxy_username ?? '')
  const [password, setPassword]   = useState(account.proxy_password ?? '')
  const [showPassword, setShowPassword] = useState(false)
  const [savingProxy, setSavingProxy] = useState(false)

  // Memo state
  const [memo, setMemo] = useState(account.memo ?? '')
  const [savingMemo, setSavingMemo] = useState(false)

  // Danger zone states
  const [clearingCookies, setClearingCookies] = useState(false)
  const [cookieCleared, setCookieCleared] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleSaveProxy = async () => {
    setSavingProxy(true)
    try {
      if (proxyType === 'none') {
        await onSaveProxy({ proxy_url: null, proxy_username: null, proxy_password: null })
      } else {
        await onSaveProxy({
          proxy_url: `${proxyType}://${host}:${port}`,
          proxy_username: username || null,
          proxy_password: password || null,
        })
      }
      onClose()
    } finally {
      setSavingProxy(false)
    }
  }

  const handleSaveMemo = async () => {
    setSavingMemo(true)
    try {
      await onSaveMemo(memo.trim() || null)
      onClose()
    } finally {
      setSavingMemo(false)
    }
  }

  const handleClearCookies = async () => {
    setClearingCookies(true)
    try {
      await onClearCookies()
      setCookieCleared(true)
    } finally {
      setClearingCookies(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await onDelete()
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  const initials = (account.display_name?.[0] ?? account.username[0]).toUpperCase()

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[460px] overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${gradient(account.id)} flex items-center justify-center text-white text-sm font-bold shrink-0 shadow`}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm truncate">
                {account.display_name ?? account.username}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[account.status]}`} />
                <p className="text-zinc-500 text-xs">@{account.username} · {STATUS_LABEL[account.status]}</p>
              </div>
              {account.follower_count !== null && (
                <p className="text-zinc-600 text-xs mt-0.5">{account.follower_count.toLocaleString()} フォロワー</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => { onOpenBrowser(); onClose() }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
              >
                🌐 ブラウザで開く
              </button>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-white transition-colors rounded-lg hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 flex-wrap">
            {([
              { id: 'profile', icon: User,     label: 'プロフィール' },
              { id: 'proxy',   icon: Shield,   label: 'プロキシ' },
              { id: 'memo',    icon: FileText,  label: 'メモ' },
              { id: 'stocks',  icon: Bookmark, label: 'ストック' },
              { id: 'danger',  icon: Settings, label: '管理' },
            ] as { id: Tab; icon: React.ElementType; label: string }[]).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  tab === t.id
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <t.icon size={13} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">

          {/* ── Profile tab ── */}
          {tab === 'profile' && (
            <>
              {/* 表示名 */}
              <div>
                <label className="text-zinc-400 text-xs font-medium block mb-2">表示名</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={account.username}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                />
                <p className="text-zinc-600 text-xs mt-1">空白にするとユーザー名(@{account.username})が表示されます</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveDisplayName}
                  disabled={savingDisplayName}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors"
                >
                  {savingDisplayName ? '保存中...' : '保存'}
                </button>
              </div>

              {/* 操作速度設定 */}
              <div className="border-t border-zinc-800 pt-4">
                <label className="text-zinc-400 text-xs font-medium block mb-1">操作速度</label>
                <p className="text-zinc-600 text-xs mb-3">
                  いいね・リポスト・投稿の操作間隔とタイピング速度を設定します
                </p>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {([
                    { id: 'slow',   label: '安全',   sub: '1.5〜3秒',  color: 'text-emerald-400' },
                    { id: 'normal', label: 'バランス', sub: '0.7〜2秒',  color: 'text-blue-400' },
                    { id: 'fast',   label: '高速',   sub: '0.3〜0.8秒', color: 'text-amber-400' },
                  ] as { id: 'slow' | 'normal' | 'fast'; label: string; sub: string; color: string }[]).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSpeedPreset(p.id)}
                      className={`py-2.5 px-2 rounded-xl text-center transition-all border ${
                        speedPreset === p.id
                          ? 'bg-zinc-700 border-blue-500 text-white'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-750 hover:text-zinc-200'
                      }`}
                    >
                      <p className={`text-xs font-bold ${speedPreset === p.id ? 'text-white' : p.color}`}>{p.label}</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{p.sub}</p>
                    </button>
                  ))}
                </div>
                <div className="text-zinc-600 text-[10px] bg-zinc-800/60 rounded-lg px-3 py-2 space-y-0.5 mb-3">
                  {speedPreset === 'slow'   && <><p>・操作間隔: 1,500〜3,000ms のランダム</p><p>・タイピング: 80〜220ms / 文字</p><p>・スクロール: 70% の確率で実行</p></>}
                  {speedPreset === 'normal' && <><p>・操作間隔: 700〜2,000ms のランダム</p><p>・タイピング: 35〜110ms / 文字</p><p>・スクロール: 50% の確率で実行</p></>}
                  {speedPreset === 'fast'   && <><p>・操作間隔: 300〜800ms のランダム</p><p>・タイピング: 12〜40ms / 文字</p><p>・スクロール: 30% の確率で実行</p></>}
                </div>
                <button
                  onClick={handleSaveSpeedPreset}
                  disabled={savingSpeed || speedPreset === (account.speed_preset ?? 'normal')}
                  className="w-full py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  {savingSpeed ? '保存中...' : '速度設定を保存'}
                </button>
              </div>
            </>
          )}

          {/* ── Proxy tab ── */}
          {tab === 'proxy' && (
            <>
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

              <div className="flex gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveProxy}
                  disabled={savingProxy || (proxyType !== 'none' && (!host || !port))}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors"
                >
                  {savingProxy ? '保存中...' : '保存'}
                </button>
              </div>
            </>
          )}

          {/* ── Memo tab ── */}
          {tab === 'memo' && (
            <>
              <div>
                <label className="text-zinc-400 text-xs font-medium block mb-2">メモ</label>
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="このアカウントに関するメモを入力..."
                  rows={5}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none"
                />
                <p className="text-zinc-600 text-xs mt-1">{memo.length} 文字</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveMemo}
                  disabled={savingMemo}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors"
                >
                  {savingMemo ? '保存中...' : '保存'}
                </button>
              </div>
            </>
          )}

          {/* ── Stocks tab ── */}
          {tab === 'stocks' && <StocksTab accountId={account.id} />}

          {/* ── Danger tab ── */}
          {tab === 'danger' && (
            <div className="space-y-3">
              {/* Cookie clear */}
              <div className="bg-zinc-800 rounded-xl p-4">
                <p className="text-white text-xs font-semibold mb-1">Cookieを削除</p>
                <p className="text-zinc-500 text-xs mb-3">
                  このアカウントのセッションCookieをすべて削除します。再ログインが必要になります。
                </p>
                {cookieCleared ? (
                  <p className="text-emerald-400 text-xs font-medium">✓ Cookieを削除しました</p>
                ) : (
                  <button
                    onClick={handleClearCookies}
                    disabled={clearingCookies}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors"
                  >
                    {clearingCookies ? '削除中...' : 'Cookieを削除'}
                  </button>
                )}
              </div>

              {/* Account delete */}
              <div className="bg-zinc-800 rounded-xl p-4">
                <p className="text-white text-xs font-semibold mb-1">アカウントを削除</p>
                <p className="text-zinc-500 text-xs mb-3">
                  このアカウントをアプリから削除します。Threads上のアカウントは削除されません。
                </p>
                {confirmDelete ? (
                  <div className="space-y-2">
                    <p className="text-red-400 text-xs font-medium">本当に削除しますか？この操作は取り消せません。</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-xs transition-colors"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="flex-1 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors"
                      >
                        {deleting ? '削除中...' : '削除する'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleDelete}
                    className="px-4 py-2 bg-red-600/20 hover:bg-red-600 border border-red-600/40 hover:border-transparent text-red-400 hover:text-white rounded-lg text-xs font-semibold transition-all"
                  >
                    アカウントを削除
                  </button>
                )}
              </div>

              <button
                onClick={onClose}
                className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg text-sm transition-colors"
              >
                閉じる
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
