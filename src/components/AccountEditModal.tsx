import React, { useState, useEffect, useRef } from 'react'
import { User, Shield, FileText, Bookmark, Settings, Fingerprint } from 'lucide-react'
import { Account, PostStock, FingerprintData, api } from '../lib/ipc'
import { MasterKeyGate } from './MasterKeyGate'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

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
  onResetSession: () => Promise<unknown>
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
  challenge:   'bg-yellow-400',
}
const STATUS_LABEL: Record<Account['status'], string> = {
  active:      'ログイン中',
  inactive:    '未確認',
  needs_login: '要ログイン',
  frozen:      '凍結',
  error:       'エラー',
  challenge:   '要確認',
}

// ── Stocks tab ────────────────────────────────────────────────────────────────

const STOCK_MAX = 500

// ── CSV parser ────────────────────────────────────────────────────────────────


// ── StocksTab ─────────────────────────────────────────────────────────────────

function StocksTab({ accountId, groupName, onUseStock }: { accountId: number; groupName: string | null; onUseStock?: (content: string, images: string[]) => void }) {
  const [stocks, setStocks]     = useState<PostStock[]>([])
  const [loading, setLoading]   = useState(true)
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)

  // form state
  const [fContent, setFContent] = useState('')
  const [fImage1, setFImage1]   = useState('')  // base64 data URL
  const [fImage2, setFImage2]   = useState('')  // base64 data URL
  const [fTopic, setFTopic]     = useState('')  // topic tag
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // CSV/xlsx import state
  const [importing, setImporting]         = useState(false)
  const [csvGroupAccounts, setCsvGroupAccounts] = useState<Account[]>([])
  const [randomizing, setRandomizing]     = useState(false)
  const [bulkTopic, setBulkTopic]         = useState('')
  const [applyingTopic, setApplyingTopic] = useState(false)
  const [toast, setToast]                 = useState<{ msg: string; ok: boolean } | null>(null)

  // 予約投稿モーダル state
  const [scheduleTarget, setScheduleTarget] = useState<PostStock | null>(null)
  const [selectedHours, setSelectedHours]   = useState<number | null>(null)
  const [scheduledDate, setScheduledDate]   = useState<Date | null>(null)  // ±30分ランダム済み
  const [scheduling, setScheduling]         = useState(false)

  // マスターキー認証ゲート
  const [showMasterKeyGate, setShowMasterKeyGate] = useState(false)
  const [pendingStock, setPendingStock]            = useState<PostStock | null>(null)

  const openScheduleWithAuth = async (stock: PostStock) => {
    const r = await api.masterKey.check()
    if (r.authenticated) {
      setSelectedHours(null)
      setScheduleTarget(stock)
    } else {
      setPendingStock(stock)
      setShowMasterKeyGate(true)
    }
  }

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 5000)
  }

  const handleFile = async () => {
    const fileResult = await api.dialog.openFile()
    if (!fileResult) return
    setImporting(true)
    try {
      let rows: string[][]
      const buf = new Uint8Array(fileResult.data)

      if (fileResult.name.endsWith('.xlsx')) {
        const wb = XLSX.read(buf, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        rows = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][])
          .filter(row => row.some(cell => String(cell).trim() !== ''))
          .map(row => row.map(cell => String(cell)))
      } else {
        const text = new TextDecoder().decode(buf)
        const result = Papa.parse(text, { delimiter: ',', skipEmptyLines: true })
        rows = result.data as string[][]
      }

      // 先頭3行3列をメインプロセスにログ出力
      const preview = rows.slice(0, 3).map(r => r.slice(0, 3))
      api.debugLog(`[FILE] rows=${rows.length} groupName=${groupName} csvGroupAccounts=${csvGroupAccounts.length}`)
      api.debugLog(`[FILE] preview 3x3: ${JSON.stringify(preview)}`)
      if (rows.length === 0) { showToast('ファイルが空です', false); return }

      const payload: Array<{ account_id: number; content: string; image_url: null; image_url_2: null }> = []

      if (groupName && csvGroupAccounts.length > 0) {
        // グループあり：列インデックス = アカウントインデックス
        for (let colIdx = 0; colIdx < csvGroupAccounts.length; colIdx++) {
          const targetId = csvGroupAccounts[colIdx].id
          const texts = rows.map(row => (row[colIdx] ?? '').trim()).filter(Boolean)
          for (const content of texts) {
            payload.push({ account_id: targetId, content, image_url: null, image_url_2: null })
          }
        }
      } else {
        // グループなし：全セルを現在のアカウントに
        for (const row of rows) {
          for (const cell of row) {
            const content = cell.trim()
            if (content) payload.push({ account_id: accountId, content, image_url: null, image_url_2: null })
          }
        }
      }

      if (payload.length === 0) { showToast('インポートできるストックがありません', false); return }
      const res = await api.stocks.importCsv(payload)
      showToast(`${res.imported}件インポートしました` + (res.errors.length > 0 ? ` (エラー${res.errors.length}件)` : ''), res.errors.length === 0)

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

  const handleDeleteAll = async () => {
    if (stocks.length === 0) return
    if (!confirm(`本当に全て削除しますか？（${stocks.length}件）`)) return
    try {
      const res = await api.stocks.deleteAll(accountId)
      if (res.success) {
        setStocks([])
        showToast(`${res.deleted}件のストックを削除しました`, true)
      } else {
        showToast(`エラー: ${res.error}`, false)
      }
    } catch (err) {
      showToast(`エラー: ${err instanceof Error ? err.message : String(err)}`, false)
    }
  }

  const handleApplyBulkTopic = async () => {
    if (stocks.length === 0) return
    setApplyingTopic(true)
    try {
      const res = await api.stocks.updateAllTopics({ account_id: accountId, topic: bulkTopic.trim() || null })
      if (res.success) {
        const listRes = await api.stocks.list(accountId)
        if (listRes.success) setStocks(listRes.data)
        showToast(`${res.updated}件のトピックを「${bulkTopic.trim() || '(クリア)'}」に更新しました`, true)
      } else {
        showToast(`エラー: ${res.error}`, false)
      }
    } catch (err) {
      showToast(`エラー: ${err instanceof Error ? err.message : String(err)}`, false)
    } finally {
      setApplyingTopic(false)
    }
  }

  // マウント時：ストック・グループのアカウントをロード
  useEffect(() => {
    api.debugLog(`[StocksTab] useEffect fired, accountId=${accountId} groupName=${groupName}`)
    api.stocks.list(accountId)
      .then(res => { if (res.success) setStocks(res.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
    if (groupName) {
      api.accounts.list()
        .then(accounts => {
          const filtered = accounts
            .filter(a => a.group_name === groupName)
            .sort((a, b) => a.sort_order - b.sort_order)
          api.debugLog(`[StocksTab] csvGroupAccounts loaded: ${filtered.length} [${filtered.map(a => a.username).join(',')}]`)
          setCsvGroupAccounts(filtered)
        })
        .catch((err) => { api.debugLog(`[StocksTab] accounts.list error: ${String(err)}`) })
    } else {
      api.debugLog('[StocksTab] groupName is null/empty, skipping account load')
    }
  }, [accountId, groupName])

  const openNew = () => {
    setFContent(''); setFImage1(''); setFImage2(''); setFTopic(''); setError(null)
    setEditingId('new')
  }

  const openEdit = (s: PostStock) => {
    setFContent(s.content); setFImage1(s.image_url ?? ''); setFImage2(s.image_url_2 ?? ''); setFTopic(s.topic ?? ''); setError(null)
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
          topic:       fTopic.trim() || null,
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
          topic:       fTopic.trim() || null,
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
          <button
            onClick={handleDeleteAll}
            disabled={stocks.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-red-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            全削除
          </button>
          <button
            onClick={handleFile}
            disabled={importing}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            {importing ? '読込中...' : 'インポート'}
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

      {/* CSV 列振り分け先グループ（読み取り専用） */}
      <div className="bg-zinc-800/60 rounded-xl px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-zinc-400 text-xs font-semibold shrink-0">CSV列振り分け先</span>
          {groupName ? (
            <span className="text-white text-xs">{groupName}（{csvGroupAccounts.length}アカウント）</span>
          ) : (
            <span className="text-zinc-500 text-xs">グループなし → 現在のアカウントに追加</span>
          )}
        </div>
        {groupName && csvGroupAccounts.length > 0 && (
          <p className="text-zinc-500 text-[11px] leading-relaxed">
            {csvGroupAccounts.slice(0, 5).map((a, i) => (
              <span key={a.id}>{String.fromCharCode(65 + i)}列→@{a.username}　</span>
            ))}
            {csvGroupAccounts.length > 5 && <span>他{csvGroupAccounts.length - 5}アカウント</span>}
          </p>
        )}
      </div>

      {/* トピック一括設定 */}
      <div className="flex items-center gap-2">
        <input
          value={bulkTopic}
          onChange={(e) => setBulkTopic(e.target.value)}
          placeholder="トピック一括設定（空欄でクリア）"
          className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleApplyBulkTopic}
          disabled={applyingTopic || stocks.length === 0}
          className="px-3 py-1.5 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
        >
          {applyingTopic ? '適用中...' : '全ストックに適用'}
        </button>
      </div>

      {/* Stock list */}
      {stocks.length === 0 && editingId === null && (
        <p className="text-zinc-600 text-xs text-center py-4">ストックがありません</p>
      )}

      {stocks.map((s) => (
        <div key={s.id}>
          {editingId === s.id ? (
            <StockForm
              content={fContent} image1={fImage1} image2={fImage2} topic={fTopic}
              onContent={setFContent} onImage1={setFImage1} onImage2={setFImage2} onTopic={setFTopic}
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
                  onClick={() => openScheduleWithAuth(s)}
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
          content={fContent} image1={fImage1} image2={fImage2} topic={fTopic}
          onContent={setFContent} onImage1={setFImage1} onImage2={setFImage2} onTopic={setFTopic}
          onSave={handleSave} onCancel={cancelEdit}
          saving={saving} error={error}
        />
      )}

      {/* マスターキー認証ゲート */}
      {showMasterKeyGate && (
        <MasterKeyGate
          onAuth={() => {
            setShowMasterKeyGate(false)
            if (pendingStock) {
              setSelectedHours(null)
              setScheduleTarget(pendingStock)
              setPendingStock(null)
            }
          }}
          onCancel={() => { setShowMasterKeyGate(false); setPendingStock(null) }}
        />
      )}

      {/* 予約投稿モーダル */}
      {scheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { if (!scheduling) { setScheduleTarget(null); setSelectedHours(null); setScheduledDate(null) } }}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-80 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">🗓 予約投稿</h3>
              <button onClick={() => { if (!scheduling) { setScheduleTarget(null); setSelectedHours(null); setScheduledDate(null) } }} className="text-zinc-500 hover:text-white text-lg leading-none">×</button>
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
              <div className="grid grid-cols-5 gap-1">
                {([3, 6, 9, 12, 15, 18, 21, 24, 48, 72] as const).map((h) => (
                  <button
                    key={h}
                    onClick={() => {
                      // ±30分（-1800000〜+1800000ms）のランダムオフセットを加算
                      const offsetMs = (Math.random() * 2 - 1) * 30 * 60 * 1000
                      const date = new Date(Date.now() + h * 3600_000 + offsetMs)
                      date.setSeconds(0, 0)
                      setSelectedHours(h)
                      setScheduledDate(date)
                    }}
                    disabled={scheduling}
                    className={`py-1.5 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-colors ${
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
            {selectedHours != null && scheduledDate != null && (() => {
              const pad = (n: number) => String(n).padStart(2, '0')
              const timeStr = `${scheduledDate.getFullYear()}/${pad(scheduledDate.getMonth()+1)}/${pad(scheduledDate.getDate())} ${pad(scheduledDate.getHours())}:${pad(scheduledDate.getMinutes())}`
              return (
                <p className="text-violet-300 text-xs text-center font-medium bg-violet-900/30 rounded-lg py-2 px-3">
                  {selectedHours}時間後 ({timeStr}に予約)
                </p>
              )
            })()}

            {/* 実行ボタン */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={async () => {
                  if (selectedHours == null || !scheduledDate) { showToast('タイミングを選択してください', false); return }
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
                disabled={scheduling || selectedHours == null || !scheduledDate}
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
                onClick={() => { setScheduleTarget(null); setSelectedHours(null); setScheduledDate(null) }}
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
  content, image1, image2, topic,
  onContent, onImage1, onImage2, onTopic,
  onSave, onCancel, saving, error,
}: {
  content: string; image1: string; image2: string; topic: string
  onContent: (v: string) => void; onImage1: (v: string) => void; onImage2: (v: string) => void; onTopic: (v: string) => void
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
      <input
        value={topic}
        onChange={(e) => onTopic(e.target.value)}
        placeholder="トピック（例: 大阪 枚方）"
        className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
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
  onResetSession,
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

  // User-Agent state
  const [userAgent, setUserAgent] = useState(account.user_agent ?? '')
  const [savingUA, setSavingUA] = useState(false)

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

  const handleSaveUserAgent = async () => {
    setSavingUA(true)
    try {
      await api.accounts.updateUserAgent({ id: account.id, user_agent: userAgent.trim() || null })
    } finally {
      setSavingUA(false)
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
  const [templateLoaded, setTemplateLoaded] = useState(false)

  const loadProxyTemplate = async () => {
    const all = await api.settings.getAll()
    const type = all['proxy_template_type'] as ProxyType | undefined
    if (!type || type === 'none') return
    setProxyType(type)
    setHost(all['proxy_template_host'] ?? '')
    setPort(all['proxy_template_port'] ?? '')
    setUsername(all['proxy_template_username'] ?? '')
    setPassword(all['proxy_template_password'] ?? '')
    setTemplateLoaded(true)
    setTimeout(() => setTemplateLoaded(false), 2000)
  }

  // Memo state
  const [memo, setMemo] = useState(account.memo ?? '')
  const [savingMemo, setSavingMemo] = useState(false)

  // Danger zone states
  const [clearingCookies, setClearingCookies] = useState(false)
  const [cookieCleared, setCookieCleared] = useState(false)
  const [resettingSession, setResettingSession] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [igLoggingIn, setIgLoggingIn] = useState(false)
  const [igLoginResult, setIgLoginResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [bulkLoggingIn, setBulkLoggingIn] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; successCount: number; currentUsername?: string } | null>(null)

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

  const handleInstagramLogin = async () => {
    setIgLoggingIn(true)
    setIgLoginResult(null)
    try {
      const res = await api.accounts.loginInstagram(account.id)
      if (res.success) {
        setIgLoginResult({ ok: true, msg: res.hasSessionId ? 'instagram.com のセッションを取得しました' : 'ウィンドウを閉じました（sessionid未取得）' })
      } else {
        setIgLoginResult({ ok: false, msg: res.error ?? 'エラーが発生しました' })
      }
    } catch (e) {
      setIgLoginResult({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setIgLoggingIn(false)
    }
  }

  const handleBulkLogin = async () => {
    setBulkLoggingIn(true)
    setBulkProgress(null)
    const off = api.on('accounts:bulk-login-progress', (data: unknown) => {
      const d = data as { type: string; current?: number; total?: number; successCount?: number; username?: string }
      if (d.type === 'start') {
        setBulkProgress({ current: 0, total: d.total ?? 0, successCount: 0 })
      } else if (d.type === 'progress') {
        setBulkProgress(prev => ({ ...(prev ?? { current: 0, total: d.total ?? 0, successCount: 0 }), currentUsername: d.username }))
      } else if (d.type === 'result') {
        const rd = data as { type: string; current?: number; total?: number; success?: boolean; username?: string }
        setBulkProgress(prev => ({
          current: rd.current ?? (prev?.current ?? 0),
          total: rd.total ?? (prev?.total ?? 0),
          successCount: (prev?.successCount ?? 0) + (rd.success ? 1 : 0),
          currentUsername: rd.username,
        }))
      } else if (d.type === 'done') {
        setBulkProgress({ current: d.total ?? 0, total: d.total ?? 0, successCount: d.successCount ?? 0 })
        setBulkLoggingIn(false)
      }
    })
    try {
      await api.accounts.bulkLoginInstagram({ group_name: account.group_name })
    } catch {
      setBulkLoggingIn(false)
    } finally {
      off()
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

  const handleResetSession = async () => {
    if (!confirmReset) { setConfirmReset(true); return }
    setResettingSession(true)
    try {
      await onResetSession()
      onClose()
    } finally {
      setResettingSession(false)
      setConfirmReset(false)
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

              {/* モバイル投稿 User-Agent */}
              <div className="border-t border-zinc-800 pt-4">
                <label className="text-zinc-400 text-xs font-medium block mb-1">モバイル投稿 User-Agent</label>
                <p className="text-zinc-600 text-xs mb-2">API投稿（mobilePostText / mobilePostWithMedia）に使うiPhone UAです</p>
                <div className="grid grid-cols-2 gap-1 mb-2">
                  {[
                    { label: 'iPhone 14 Pro Max / iOS 17.5', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone 15 Pro / iOS 17.4',     ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone 13 Pro Max / iOS 16.6', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone 14 Pro / iOS 17.2',     ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone 15 Pro Max / iOS 17.3', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone 12 Pro Max / iOS 15.8', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.8 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone 13 / iOS 16.7',         ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.7 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone 14 / iOS 17.1',         ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone 15 / iOS 17.4.1',       ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone 11 Pro / iOS 16.3',     ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone 13 mini / iOS 16.5',    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1' },
                    { label: 'iPhone SE 3rd / iOS 16.4',     ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1' },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setUserAgent(p.ua)}
                      className={`text-left px-2 py-1.5 rounded-lg text-[10px] border transition-colors leading-tight ${
                        userAgent === p.ua
                          ? 'bg-blue-900/40 border-blue-600 text-blue-300'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={userAgent}
                  onChange={(e) => setUserAgent(e.target.value)}
                  rows={2}
                  placeholder="カスタムUAを直接入力..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[10px] text-zinc-300 font-mono placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none mb-2"
                />
                <button
                  onClick={handleSaveUserAgent}
                  disabled={savingUA || userAgent === (account.user_agent ?? '')}
                  className="w-full py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  {savingUA ? '保存中...' : 'UA設定を保存'}
                </button>
              </div>
            </>
          )}

          {/* ── Proxy tab ── */}
          {tab === 'proxy' && (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-zinc-400 text-xs font-medium">プロキシ設定</span>
                <button
                  type="button"
                  onClick={loadProxyTemplate}
                  className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs transition-colors"
                >
                  {templateLoaded ? '✓ 読み込み完了' : 'テンプレート読み込み'}
                </button>
              </div>
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
          {tab === 'stocks' && <StocksTab accountId={account.id} groupName={account.group_name} onUseStock={onUseStock} />}

          {/* ── Fingerprint tab ── */}
          {tab === 'fingerprint' && <FingerprintTab accountId={account.id} />}

          {/* ── Danger tab ── */}
          {tab === 'danger' && (
            <div className="space-y-3">
              {/* Instagram login */}
              <div className="bg-zinc-800 rounded-xl p-4">
                <p className="text-white text-xs font-semibold mb-1">Instagramでログイン</p>
                <p className="text-zinc-500 text-xs mb-3">
                  instagram.com のセッションを取得します。i.instagram.com API を使う場合に必要です。
                </p>
                {igLoginResult && (
                  <p className={`text-xs font-medium mb-2 ${igLoginResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {igLoginResult.ok ? '✓' : '✗'} {igLoginResult.msg}
                  </p>
                )}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={handleInstagramLogin}
                    disabled={igLoggingIn || bulkLoggingIn}
                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-all"
                  >
                    {igLoggingIn ? 'ログイン中...' : 'Instagramでログイン'}
                  </button>
                  <button
                    onClick={handleBulkLogin}
                    disabled={igLoggingIn || bulkLoggingIn}
                    className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-all"
                  >
                    {bulkLoggingIn ? '一括ログイン中...' : `グループ一括ログイン${account.group_name ? ` [${account.group_name}]` : ' [未分類]'}`}
                  </button>
                </div>
                {bulkProgress && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-zinc-400 text-xs">
                        {bulkProgress.current}/{bulkProgress.total} 完了
                        {bulkLoggingIn && bulkProgress.currentUsername && (
                          <span className="ml-2 text-zinc-500">— @{bulkProgress.currentUsername}</span>
                        )}
                      </span>
                      {!bulkLoggingIn && (
                        <span className="text-emerald-400 text-xs font-medium">✓ {bulkProgress.successCount}/{bulkProgress.total} 成功</span>
                      )}
                    </div>
                    <div className="w-full bg-zinc-700 rounded-full h-1.5">
                      <div
                        className="bg-gradient-to-r from-indigo-500 to-purple-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

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

              {/* Session reset */}
              <div className="bg-zinc-800 rounded-xl p-4">
                <p className="text-white text-xs font-semibold mb-1">セッションをリセット</p>
                <p className="text-zinc-500 text-xs mb-3">
                  セッションデータ（Cookie・ブラウザキャッシュ）をすべて削除し、再ログインを促します。アカウント自体は削除されません。
                </p>
                {confirmReset ? (
                  <div className="space-y-2">
                    <p className="text-amber-400 text-xs font-medium">セッションをリセットしますか？再ログインが必要になります。</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmReset(false)}
                        className="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-xs transition-colors"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={handleResetSession}
                        disabled={resettingSession}
                        className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors"
                      >
                        {resettingSession ? 'リセット中...' : 'リセットする'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleResetSession}
                    className="px-4 py-2 bg-orange-600/20 hover:bg-orange-600 border border-orange-600/40 hover:border-transparent text-orange-400 hover:text-white rounded-lg text-xs font-semibold transition-all"
                  >
                    セッションをリセット
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
