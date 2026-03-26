import React, { useState, useEffect, useRef } from 'react'
import { User, Shield, FileText, Bookmark, Settings, Fingerprint } from 'lucide-react'
import { Account, PostStock, FingerprintData, api } from '../lib/ipc'

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
  onUseStock?: (content: string, images: string[]) => void
}

type Tab = 'profile' | 'proxy' | 'memo' | 'stocks' | 'fingerprint' | 'danger'
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

const STOCK_MAX = 50

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const cols: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === ',' && !inQ) {
        cols.push(cur); cur = ''
      } else {
        cur += ch
      }
    }
    cols.push(cur)
    rows.push(cols)
  }
  return rows
}

// ── StocksTab ─────────────────────────────────────────────────────────────────

function StocksTab({ accountId, onUseStock }: { accountId: number; onUseStock?: (content: string, images: string[]) => void }) {
  const [stocks, setStocks]     = useState<PostStock[]>([])
  const [loading, setLoading]   = useState(true)
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)

  // form state
  const [fContent, setFContent] = useState('')
  const [fImage1, setFImage1]   = useState('')  // base64 data URL
  const [fImage2, setFImage2]   = useState('')  // base64 data URL
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // CSV import state
  const csvInputRef                       = useRef<HTMLInputElement>(null)
  const [importing, setImporting]         = useState(false)
  const [randomizing, setRandomizing]     = useState(false)
  const [toast, setToast]                 = useState<{ msg: string; ok: boolean } | null>(null)

  // 予約投稿モーダル state
  const [scheduleTarget, setScheduleTarget] = useState<PostStock | null>(null)
  const [selectedHours, setSelectedHours]   = useState<number | null>(null)
  const [scheduling, setScheduling]         = useState(false)

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 5000)
  }

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      // 列 = アカウント番号（1列目→アカウント1番, 2列目→アカウント2番…）
      // 行 = 各アカウントのストック（最大50行）
      const matrix = parseCsv(text)  // matrix[rowIdx][colIdx]
      if (matrix.length === 0) { showToast('空のCSVです', false); return }

      const accounts = await api.accounts.list()
      const numCols = Math.max(...matrix.map(r => r.length))

      const payload: Array<{ account_id: number; content: string; image_url: null; image_url_2: null }> = []
      let skippedCols = 0

      for (let col = 0; col < numCols; col++) {
        const account = accounts[col]
        if (!account) { skippedCols++; continue }

        for (let row = 0; row < matrix.length; row++) {
          const content = matrix[row][col]?.trim() ?? ''
          if (!content) continue
          payload.push({ account_id: account.id, content, image_url: null, image_url_2: null })
        }
      }

      if (payload.length === 0) { showToast('インポートできるストックがありません', false); return }

      const res = await api.stocks.importCsv(payload)
      const parts: string[] = [`${res.imported}件インポートしました`]
      if (skippedCols > 0)       parts.push(`列超過スキップ: ${skippedCols}列`)
      if (res.errors.length > 0) parts.push(`エラー: ${res.errors.length}件`)
      showToast(parts.join(' / '), res.errors.length === 0 && skippedCols === 0)
      if (res.errors.length > 0) console.warn('[CSV import] errors:', res.errors)

      // 現在のアカウントのストック一覧を再取得
      const listRes = await api.stocks.list(accountId)
      if (listRes.success) setStocks(listRes.data)
    } catch (err) {
      showToast(`エラー: ${err instanceof Error ? err.message : String(err)}`, false)
    } finally {
      setImporting(false)
    }
  }

  const handleRandomizeImages = async () => {
    if (stocks.length === 0) return
    setRandomizing(true)
    try {
      const res = await api.stocks.randomizeImages(accountId)
      if (res.success) {
        const listRes = await api.stocks.list(accountId)
        if (listRes.success) setStocks(listRes.data)
        showToast(`${res.updated}件に画像をランダム挿入しました`, true)
      } else {
        showToast(`エラー: ${res.error}`, false)
      }
    } catch (err) {
      showToast(`エラー: ${err instanceof Error ? err.message : String(err)}`, false)
    } finally {
      setRandomizing(false)
    }
  }

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
    setFContent(''); setFImage1(''); setFImage2(''); setError(null)
    setEditingId('new')
  }

  const openEdit = (s: PostStock) => {
    setFContent(s.content); setFImage1(s.image_url ?? ''); setFImage2(s.image_url_2 ?? ''); setError(null)
    setEditingId(s.id)
  }

  const cancelEdit = () => { setEditingId(null); setError(null) }

  const handleSave = async () => {
    if (!fContent.trim()) return
    setSaving(true); setError(null)
    try {
      if (editingId === 'new') {
        const res = await api.stocks.create({
          account_id:  accountId,
          title:       null,
          content:     fContent.trim(),
          image_url:   fImage1 || null,
          image_url_2: fImage2 || null,
        })
        if (!res.success) throw new Error(res.error)
        setStocks((prev) => [...prev, res.data])
      } else if (typeof editingId === 'number') {
        const res = await api.stocks.update({
          id:          editingId,
          title:       null,
          content:     fContent.trim(),
          image_url:   fImage1 || null,
          image_url_2: fImage2 || null,
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
      {/* Toast */}
      {toast && (
        <div className={`px-3 py-2 rounded-lg text-xs font-medium ${
          toast.ok
            ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
            : 'bg-amber-500/15 border border-amber-500/30 text-amber-400'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-zinc-400 text-xs font-semibold shrink-0">
          投稿ストック <span className="text-zinc-600">{stocks.length}/{STOCK_MAX}</span>
        </p>
        <div className="flex items-center gap-1.5 flex-nowrap">
          {/* CSV import */}
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleCsvFile}
          />
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            {importing ? '読込中...' : 'CSVインポート'}
          </button>
          <button
            onClick={handleRandomizeImages}
            disabled={randomizing || stocks.length === 0}
            title="設定の画像グループからランダムに画像を全ストックに挿入"
            className="flex items-center gap-1 px-2.5 py-1 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            {randomizing ? '処理中...' : '🎲 画像をランダム挿入'}
          </button>
          {stocks.length < STOCK_MAX && editingId === null && (
            <button
              onClick={openNew}
              className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              + 追加
            </button>
          )}
        </div>
      </div>

      {/* Stock list */}
      {stocks.length === 0 && editingId === null && (
        <p className="text-zinc-600 text-xs text-center py-4">ストックがありません</p>
      )}

      {stocks.map((s) => (
        <div key={s.id}>
          {editingId === s.id ? (
            <StockForm
              content={fContent} image1={fImage1} image2={fImage2}
              onContent={setFContent} onImage1={setFImage1} onImage2={setFImage2}
              onSave={handleSave} onCancel={cancelEdit}
              saving={saving} error={error}
            />
          ) : (
            <div className="bg-zinc-800 rounded-xl p-3 space-y-1.5">
              {s.title && <p className="text-zinc-300 text-xs font-semibold">{s.title}</p>}
              <p className="text-zinc-200 text-xs leading-relaxed line-clamp-2">{s.content}</p>
              {(s.image_url || s.image_url_2) && (
                <div className="flex gap-1.5 mt-1">
                  {s.image_url && (
                    <img src={toImgSrc(s.image_url)} alt="画像1" className="w-16 h-12 object-cover rounded-md border border-zinc-600" />
                  )}
                  {s.image_url_2 && (
                    <img src={toImgSrc(s.image_url_2)} alt="画像2" className="w-16 h-12 object-cover rounded-md border border-zinc-600" />
                  )}
                </div>
              )}
              <div className="flex gap-1.5 pt-0.5 flex-wrap">
                {onUseStock && (
                  <button
                    onClick={() => { console.log('[Stock] 投稿に使う clicked', s.id); onUseStock(s.content, [s.image_url, s.image_url_2].filter(Boolean) as string[]) }}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold rounded-lg transition-colors"
                  >
                    投稿に使う
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedHours(null)
                    setScheduleTarget(s)
                  }}
                  className="px-2.5 py-1 bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold rounded-lg transition-colors"
                >
                  予約投稿
                </button>
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
          content={fContent} image1={fImage1} image2={fImage2}
          onContent={setFContent} onImage1={setFImage1} onImage2={setFImage2}
          onSave={handleSave} onCancel={cancelEdit}
          saving={saving} error={error}
        />
      )}

      {/* 予約投稿モーダル */}
      {scheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !scheduling && setScheduleTarget(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-80 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">🗓 予約投稿</h3>
              <button onClick={() => !scheduling && setScheduleTarget(null)} className="text-zinc-500 hover:text-white text-lg leading-none">×</button>
            </div>

            {/* プレビュー */}
            <div className="bg-zinc-800 rounded-xl p-3 max-h-24 overflow-y-auto">
              <p className="text-zinc-300 text-xs leading-relaxed">{scheduleTarget.content}</p>
            </div>

            {/* 画像インジケーター */}
            {(scheduleTarget.image_url || scheduleTarget.image_url_2) && (
              <div className="flex gap-2 items-center">
                <span className="text-zinc-500 text-xs">画像:</span>
                {scheduleTarget.image_url && (
                  <img src={toImgSrc(scheduleTarget.image_url)} className="w-10 h-10 rounded object-cover border border-zinc-600" />
                )}
                {scheduleTarget.image_url_2 && (
                  <img src={toImgSrc(scheduleTarget.image_url_2)} className="w-10 h-10 rounded object-cover border border-zinc-600" />
                )}
              </div>
            )}

            {/* 時間プリセットボタン */}
            <div className="space-y-2">
              <p className="text-zinc-400 text-xs font-medium">予約タイミング</p>
              <div className="grid grid-cols-5 gap-1.5">
                {([3, 6, 9, 12, 15, 18, 21, 24, 48, 72] as const).map((h) => (
                  <button
                    key={h}
                    onClick={() => setSelectedHours(h)}
                    disabled={scheduling}
                    className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                      selectedHours === h
                        ? 'bg-violet-600 text-white'
                        : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                    } disabled:opacity-40`}
                  >
                    {h}時間後
                  </button>
                ))}
              </div>
            </div>

            {/* 確認表示 */}
            {selectedHours != null && (() => {
              const d = new Date(Date.now() + selectedHours * 3600_000)
              const pad = (n: number) => String(n).padStart(2, '0')
              const label = `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}に予約`
              return (
                <p className="text-violet-300 text-xs text-center font-medium bg-violet-900/30 rounded-lg py-2 px-3">
                  {label}
                </p>
              )
            })()}

            {/* 実行ボタン */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={async () => {
                  if (selectedHours == null) { showToast('タイミングを選択してください', false); return }
                  const scheduledDate = new Date(Date.now() + selectedHours * 3600_000)
                  setScheduling(true)
                  const result = await api.stocks.schedulePost({
                    account_id:   accountId,
                    content:      scheduleTarget.content,
                    scheduled_at: scheduledDate.toISOString(),
                    image_url:    scheduleTarget.image_url,
                    image_url_2:  scheduleTarget.image_url_2,
                  })
                  setScheduling(false)
                  if (result.success) {
                    setScheduleTarget(null)
                    showToast('予約投稿を設定しました ✓', true)
                  } else {
                    showToast(`失敗: ${result.error ?? '不明なエラー'}`, false)
                  }
                }}
                disabled={scheduling || selectedHours == null}
                className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {scheduling ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    実行中...
                  </span>
                ) : '予約実行'}
              </button>
              <button
                onClick={() => { setScheduleTarget(null); setSelectedHours(null) }}
                disabled={scheduling}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-300 text-sm rounded-xl transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 画像パス/URLを img src に使える形式に変換する
 * - data:...        → そのまま
 * - http(s)://...   → そのまま
 * - file://...      → そのまま
 * - /path/to/file   → file:///path/to/file
 */
function toImgSrc(value: string): string {
  if (!value) return ''
  if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('file://')) {
    return value
  }
  return `file://${value}`
}

function ImageUpload({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // クリップボード互換性のため canvas で PNG に変換して保存（WebP 等も対応）
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      onChange(canvas.toDataURL('image/png'))
      URL.revokeObjectURL(url)
    }
    img.src = url
    e.target.value = ''
  }

  return (
    <div className="flex-1">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      {value ? (
        <div className="relative group">
          <img src={toImgSrc(value)} alt={label} className="w-full h-20 object-cover rounded-lg border border-zinc-600" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute top-1 right-1 w-5 h-5 bg-black/70 hover:bg-red-600 text-white text-[10px] rounded-full flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full h-20 border-2 border-dashed border-zinc-600 hover:border-blue-500 rounded-lg flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-blue-400 transition-colors"
        >
          <span className="text-lg">🖼</span>
          <span className="text-[10px]">{label}</span>
        </button>
      )}
    </div>
  )
}

function StockForm({
  content, image1, image2,
  onContent, onImage1, onImage2,
  onSave, onCancel, saving, error,
}: {
  content: string; image1: string; image2: string
  onContent: (v: string) => void; onImage1: (v: string) => void; onImage2: (v: string) => void
  onSave: () => void; onCancel: () => void
  saving: boolean; error: string | null
}) {
  return (
    <div className="bg-zinc-800 border border-blue-500/30 rounded-xl p-3 space-y-2">
      <textarea
        value={content}
        onChange={(e) => onContent(e.target.value)}
        placeholder="投稿テキスト *"
        rows={3}
        maxLength={500}
        className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
      />
      <div className="flex gap-2">
        <ImageUpload value={image1} onChange={onImage1} label="画像1を追加" />
        <ImageUpload value={image2} onChange={onImage2} label="画像2を追加" />
      </div>
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

// ── Fingerprint tab ────────────────────────────────────────────────────────────

function FpRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 items-start py-1.5 border-b border-zinc-800/60 last:border-0">
      <span className="text-zinc-500 text-[11px] w-28 shrink-0 pt-px">{label}</span>
      <span className="text-zinc-200 text-[11px] font-mono leading-relaxed break-all">{value}</span>
    </div>
  )
}

function FingerprintTab({ accountId }: { accountId: number }) {
  const [fp, setFp] = useState<FingerprintData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.accounts.fingerprint(accountId)
      .then((data) => { setFp(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [accountId])

  if (loading) return <p className="text-zinc-500 text-sm text-center py-6">読み込み中...</p>
  if (!fp) return (
    <p className="text-zinc-600 text-xs text-center py-6">
      フィンガープリントが未生成です。<br />
      アカウントを一度ブラウザで開くと自動生成されます。
    </p>
  )

  return (
    <div className="space-y-3">
      <div className="bg-zinc-800/50 rounded-xl px-4 py-1">
        <FpRow label="User-Agent"       value={fp.userAgent} />
        <FpRow label="Platform"         value={fp.platform} />
        <FpRow label="Vendor"           value={fp.vendor || '(なし)'} />
      </div>
      <div className="bg-zinc-800/50 rounded-xl px-4 py-1">
        <FpRow label="画面サイズ"        value={`${fp.screenWidth} × ${fp.screenHeight}`} />
        <FpRow label="タイムゾーン"      value={fp.timezone} />
        <FpRow label="言語"             value={fp.languages.join(', ')} />
      </div>
      <div className="bg-zinc-800/50 rounded-xl px-4 py-1">
        <FpRow label="CPU コア数"        value={String(fp.hardwareConcurrency)} />
        <FpRow label="デバイスメモリ"    value={`${fp.deviceMemory} GB`} />
      </div>
      <div className="bg-zinc-800/50 rounded-xl px-4 py-1">
        <FpRow label="WebGL Vendor"     value={fp.webglVendor} />
        <FpRow label="WebGL Renderer"   value={fp.webglRenderer} />
      </div>
      <div className="bg-zinc-800/50 rounded-xl px-4 py-1">
        <FpRow label="バッテリー"        value={`${Math.round(fp.batteryLevel * 100)}% · ${fp.batteryCharging ? '充電中' : '放電中'}`} />
        <FpRow label="Canvas Seed"      value={String(fp.canvasSeed)} />
        <FpRow label="Audio Seed"       value={String(fp.audioSeed)} />
      </div>
      <div className="bg-zinc-800/50 rounded-xl px-4 py-1">
        <FpRow
          label={`フォント (${fp.fontList.length})`}
          value={fp.fontList.slice(0, 8).join(', ') + (fp.fontList.length > 8 ? ` …他${fp.fontList.length - 8}件` : '')}
        />
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
  onUseStock,
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
              { id: 'profile',     icon: User,        label: 'プロフィール' },
              { id: 'proxy',       icon: Shield,      label: 'プロキシ' },
              { id: 'memo',        icon: FileText,    label: 'メモ' },
              { id: 'stocks',      icon: Bookmark,    label: 'ストック' },
              { id: 'fingerprint', icon: Fingerprint, label: 'FP' },
              { id: 'danger',      icon: Settings,    label: '管理' },
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
          {tab === 'stocks' && <StocksTab accountId={account.id} onUseStock={onUseStock} />}

          {/* ── Fingerprint tab ── */}
          {tab === 'fingerprint' && <FingerprintTab accountId={account.id} />}

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
