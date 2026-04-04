import { useState, useEffect } from 'react'
import { api, LicenseRow } from '../lib/ipc'

// ── キー自動生成 ──────────────────────────────────────────────────────────────

function generateKey(): string {
  const seg = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(3)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  return `TM-${seg()}-${seg()}-${seg()}`
}

// ── 日時フォーマット ──────────────────────────────────────────────────────────

function fmtDate(dt: string | null): string {
  if (!dt) return '無期限'
  try {
    return new Date(dt).toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return dt }
}

function isExpired(dt: string | null): boolean {
  if (!dt) return false
  return new Date(dt) <= new Date()
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent',
        'transition-colors duration-200 focus:outline-none cursor-pointer',
        checked ? 'bg-blue-600' : 'bg-zinc-600',
      ].join(' ')}
    >
      <span className={[
        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-md transition-transform duration-200',
        checked ? 'translate-x-4' : 'translate-x-0',
      ].join(' ')} />
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function LicenseAdmin() {
  const [licenses,    setLicenses]    = useState<LicenseRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  // Service role key 設定
  const [serviceKey,     setServiceKey]     = useState('')
  const [showServiceKey, setShowServiceKey] = useState(false)
  const [keySaving,      setKeySaving]      = useState(false)
  const [keyMsg,         setKeyMsg]         = useState<string | null>(null)

  // 新規追加フォーム
  const [newKey,       setNewKey]       = useState('')
  const [newExpires,   setNewExpires]   = useState('')
  const [newMemo,      setNewMemo]      = useState('')
  const [adding,       setAdding]       = useState(false)
  const [addError,     setAddError]     = useState<string | null>(null)

  // ── ロード ──────────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true)
    setError(null)
    const result = await api.license.list()
    if (!result.success) {
      setError(result.error ?? '取得に失敗しました')
    } else {
      setLicenses(result.data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    api.settings.getAll().then((s) => {
      setServiceKey(s.supabase_service_key ?? '')
    })
    load()
  }, [])

  // ── Service Role Key 保存 ──────────────────────────────────────────────────

  const handleSaveKey = async () => {
    setKeySaving(true)
    await api.settings.setMany({ supabase_service_key: serviceKey.trim() })
    setKeySaving(false)
    setKeyMsg('保存しました。再取得します...')
    setTimeout(async () => {
      setKeyMsg(null)
      await load()
    }, 800)
  }

  // ── 有効/無効トグル ────────────────────────────────────────────────────────

  const handleToggle = async (row: LicenseRow) => {
    const newVal = !row.is_active
    setLicenses((prev) =>
      prev.map((r) => r.key === row.key ? { ...r, is_active: newVal } : r)
    )
    const result = await api.license.update({ key: row.key, is_active: newVal })
    if (!result.success) {
      // revert
      setLicenses((prev) =>
        prev.map((r) => r.key === row.key ? { ...r, is_active: row.is_active } : r)
      )
      alert(result.error)
    }
  }

  // ── 削除 ──────────────────────────────────────────────────────────────────

  const handleDelete = async (key: string) => {
    if (!confirm(`キー「${key}」を削除しますか？`)) return
    const result = await api.license.delete(key)
    if (!result.success) {
      alert(result.error)
      return
    }
    setLicenses((prev) => prev.filter((r) => r.key !== key))
  }

  // ── MACアドレスリセット ──────────────────────────────────────────────────

  const handleResetMac = async (key: string) => {
    if (!confirm(`「${key}」のMACアドレス紐付けをリセットしますか？\n次回起動時に新しいMacで再紐付けされます。`)) return
    const result = await api.license.resetMac(key)
    if (!result.success) {
      alert(result.error)
      return
    }
    setLicenses((prev) => prev.map((r) => r.key === key ? { ...r, mac_address: null } : r))
  }

  // ── 新規追加 ──────────────────────────────────────────────────────────────

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKey.trim()) return
    setAdding(true)
    setAddError(null)
    const result = await api.license.create({
      key:         newKey.trim(),
      is_active:   true,
      expires_at:  newExpires ? new Date(newExpires).toISOString() : null,
      memo:        newMemo.trim() || null,
      mac_address: null,
    })
    if (!result.success) {
      setAddError(result.error ?? '追加に失敗しました')
    } else {
      setNewKey('')
      setNewExpires('')
      setNewMemo('')
      await load()
    }
    setAdding(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Service Role Key 設定 */}
      <div className="p-4 bg-zinc-800/60 border border-zinc-700/50 rounded-xl space-y-2">
        <p className="text-zinc-300 text-xs font-semibold mb-1">Supabase Service Role Key</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showServiceKey ? 'text' : 'password'}
              value={serviceKey}
              onChange={(e) => setServiceKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono pr-12"
            />
            <button
              type="button"
              onClick={() => setShowServiceKey(!showServiceKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-zinc-400 hover:text-white"
            >
              {showServiceKey ? '隠す' : '表示'}
            </button>
          </div>
          <button
            onClick={handleSaveKey}
            disabled={keySaving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            {keySaving ? '保存中...' : '保存'}
          </button>
        </div>
        {keyMsg && <p className="text-emerald-400 text-xs">{keyMsg}</p>}
        <p className="text-zinc-600 text-[11px]">
          Supabase ダッシュボード → Settings → API → service_role (secret)
        </p>
      </div>

      {/* 新規追加フォーム */}
      <form onSubmit={handleAdd} className="p-4 bg-zinc-800/60 border border-zinc-700/50 rounded-xl space-y-2">
        <p className="text-zinc-300 text-xs font-semibold mb-1">新規キー追加</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="TM-XXXXXX-XXXXXX-XXXXXX"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
          />
          <button
            type="button"
            onClick={() => setNewKey(generateKey())}
            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            自動生成
          </button>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-zinc-500 text-[11px] block mb-1">有効期限（空白=無期限）</label>
            <input
              type="datetime-local"
              value={newExpires}
              onChange={(e) => setNewExpires(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-zinc-500 text-[11px] block mb-1">メモ</label>
            <input
              type="text"
              value={newMemo}
              onChange={(e) => setNewMemo(e.target.value)}
              placeholder="用途など"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        {addError && <p className="text-red-400 text-xs">{addError}</p>}
        <button
          type="submit"
          disabled={adding || !newKey.trim()}
          className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          {adding ? '追加中...' : 'キーを追加'}
        </button>
      </form>

      {/* キー一覧 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-zinc-400 text-xs font-semibold">
            キー一覧
            {!loading && <span className="text-zinc-600 ml-1">({licenses.length}件)</span>}
          </p>
          <button
            onClick={load}
            disabled={loading}
            className="text-zinc-500 hover:text-zinc-300 text-[11px] transition-colors"
          >
            {loading ? '読込中...' : '↻ 再取得'}
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs mb-3">
            {error}
          </div>
        )}

        {!loading && licenses.length === 0 && !error && (
          <p className="text-zinc-600 text-xs text-center py-6">キーがありません</p>
        )}

        <div className="space-y-1.5">
          {licenses.map((row) => {
            const expired = isExpired(row.expires_at)
            return (
              <div
                key={row.key}
                className={[
                  'flex items-center gap-3 p-3 rounded-xl border transition-colors',
                  row.is_active && !expired
                    ? 'bg-zinc-800 border-zinc-700'
                    : 'bg-zinc-900 border-zinc-800 opacity-60',
                ].join(' ')}
              >
                {/* Status dot */}
                <span className={[
                  'w-2 h-2 rounded-full shrink-0',
                  row.is_active && !expired ? 'bg-emerald-400' : expired ? 'bg-amber-500' : 'bg-zinc-600',
                ].join(' ')} />

                {/* Key + meta */}
                <div className="flex-1 min-w-0">
                  <code className="text-[11px] font-mono text-zinc-300 block truncate">{row.key}</code>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className={`text-[10px] ${expired ? 'text-amber-400' : 'text-zinc-500'}`}>
                      {expired ? '⚠ 期限切れ: ' : '期限: '}
                      {fmtDate(row.expires_at)}
                    </span>
                    {row.memo && (
                      <span className="text-zinc-500 text-[10px]">— {row.memo}</span>
                    )}
                    {row.mac_address ? (
                      <span className="text-[10px] text-emerald-700 font-mono">
                        🔒 {row.mac_address}
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-600">未紐付け</span>
                    )}
                  </div>
                </div>

                {/* Toggle */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] font-semibold w-6 text-right ${row.is_active ? 'text-blue-400' : 'text-zinc-600'}`}>
                    {row.is_active ? 'ON' : 'OFF'}
                  </span>
                  <Toggle checked={row.is_active} onChange={() => handleToggle(row)} />
                </div>

                {/* MAC reset */}
                {row.mac_address && (
                  <button
                    onClick={() => handleResetMac(row.key)}
                    className="px-1.5 py-1 text-[10px] text-zinc-500 hover:text-amber-400 border border-zinc-700 hover:border-amber-500/40 rounded transition-colors shrink-0"
                    title="MACアドレス紐付けをリセット"
                  >
                    MAC解除
                  </button>
                )}

                {/* Delete */}
                <button
                  onClick={() => handleDelete(row.key)}
                  className="w-6 h-6 flex items-center justify-center text-zinc-600 hover:text-red-400 text-xs rounded transition-colors shrink-0"
                  title="削除"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
