import { useState, useEffect, useCallback } from 'react'
import { api, Schedule, Account, AutopostConfig, PostStock } from '../lib/ipc'
import { StatusBadge } from '../components/StatusBadge'
import { MasterKeyGate } from '../components/MasterKeyGate'

interface Props {
  accounts: Account[]
  onClose?: () => void
}

// ── Autopost tab ──────────────────────────────────────────────────────────────

function AutopostTab({ accounts }: { accounts: Account[] }) {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [config, setConfig] = useState<AutopostConfig | null>(null)
  const [form, setForm] = useState({
    enabled:       false,
    mode:          'stock' as 'stock' | 'rewrite',
    min_interval:  60,
    max_interval:  120,
    rewrite_texts: [] as string[],
  })
  const [newText, setNewText]     = useState('')
  const [saving, setSaving]       = useState(false)
  const [resetting, setResetting] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)

  useEffect(() => {
    api.settings.getAll().then((s) => {
      setHasApiKey(!!s.anthropic_api_key?.trim())
    })
  }, [])

  const loadConfig = useCallback(async (accountId: number) => {
    const cfg = await api.autopost.get(accountId)
    setConfig(cfg)
    if (cfg) {
      setForm({
        enabled:       cfg.enabled,
        mode:          cfg.mode,
        min_interval:  cfg.min_interval,
        max_interval:  cfg.max_interval,
        rewrite_texts: cfg.rewrite_texts,
      })
    } else {
      setForm({
        enabled:       false,
        mode:          'stock',
        min_interval:  60,
        max_interval:  120,
        rewrite_texts: [],
      })
    }
  }, [])

  useEffect(() => {
    if (selectedAccountId) loadConfig(selectedAccountId)
  }, [selectedAccountId, loadConfig])

  // autopost:executed イベントで next_at を更新
  useEffect(() => {
    const unsub = api.on('autopost:executed', (data: unknown) => {
      const d = data as { account_id: number; next_at: string }
      if (d.account_id === selectedAccountId) {
        setConfig((prev) => prev ? { ...prev, next_at: d.next_at } : prev)
      }
    })
    return unsub
  }, [selectedAccountId])

  const handleSave = async () => {
    if (!selectedAccountId) return
    if (form.min_interval > form.max_interval) {
      alert('最小間隔は最大間隔以下にしてください')
      return
    }
    setSaving(true)
    const saved = await api.autopost.save({
      account_id:    selectedAccountId,
      enabled:       form.enabled,
      mode:          form.mode,
      min_interval:  form.min_interval,
      max_interval:  form.max_interval,
      rewrite_texts: form.rewrite_texts,
    })
    setConfig(saved)
    setSaving(false)
  }

  const handleResetNext = async () => {
    if (!selectedAccountId) return
    setResetting(true)
    await api.autopost.resetNext(selectedAccountId)
    setConfig((prev) => prev ? { ...prev, next_at: null } : prev)
    setResetting(false)
  }

  const handleAddText = () => {
    const t = newText.trim()
    if (!t) return
    setForm((f) => ({ ...f, rewrite_texts: [...f.rewrite_texts, t] }))
    setNewText('')
  }

  const handleRemoveText = (idx: number) => {
    setForm((f) => ({
      ...f,
      rewrite_texts: f.rewrite_texts.filter((_, i) => i !== idx),
    }))
  }

  return (
    <div className="space-y-4">
      {/* アカウント選択 */}
      <select
        value={selectedAccountId ?? ''}
        onChange={(e) => {
          const id = Number(e.target.value)
          setSelectedAccountId(id || null)
          setConfig(null)
        }}
        className="w-full border border-gray-200 rounded-lg p-2 text-sm"
      >
        <option value="">アカウントを選択</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.username}
          </option>
        ))}
      </select>

      {selectedAccountId && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          {/* 有効/無効 */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">自動投稿</span>
            <button
              onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                form.enabled ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  form.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* 投稿モード */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-600">投稿モード</p>
            <div className="flex gap-2">
              <button
                onClick={() => setForm((f) => ({ ...f, mode: 'stock' }))}
                className={`flex-1 py-1.5 rounded-lg text-sm border transition-colors ${
                  form.mode === 'stock'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
                }`}
              >
                ストック順
              </button>
              <button
                onClick={() => hasApiKey && setForm((f) => ({ ...f, mode: 'rewrite' }))}
                disabled={!hasApiKey}
                title={!hasApiKey ? 'Anthropic APIキーが必要です' : undefined}
                className={`flex-1 py-1.5 rounded-lg text-sm border transition-colors ${
                  !hasApiKey
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : form.mode === 'rewrite'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
                }`}
              >
                AIリライト
              </button>
            </div>
            {!hasApiKey && (
              <p className="text-xs text-amber-500 flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                AIリライトには Anthropic APIキーが必要です（設定画面で入力）
              </p>
            )}
          </div>

          {/* 投稿間隔 */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-600">投稿間隔（分）</p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-xs text-gray-400">最小</label>
                <input
                  type="number"
                  min={1}
                  value={form.min_interval}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, min_interval: Number(e.target.value) }))
                  }
                  className="w-full border border-gray-200 rounded-lg p-1.5 text-sm"
                />
              </div>
              <span className="text-gray-400 mt-4">〜</span>
              <div className="flex-1">
                <label className="text-xs text-gray-400">最大</label>
                <input
                  type="number"
                  min={1}
                  value={form.max_interval}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, max_interval: Number(e.target.value) }))
                  }
                  className="w-full border border-gray-200 rounded-lg p-1.5 text-sm"
                />
              </div>
            </div>
          </div>

          {/* AIリライト: ソーステキスト */}
          {form.mode === 'rewrite' && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600">
                ソーステキスト（リライト元）
              </p>
              {form.rewrite_texts.length === 0 ? (
                <p className="text-xs text-gray-400">テキストを追加してください</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {form.rewrite_texts.map((t, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 bg-gray-50 rounded-lg p-2"
                    >
                      <span className="text-xs text-gray-400 shrink-0 mt-0.5">
                        {i + 1}.
                      </span>
                      <p className="text-xs text-gray-700 flex-1 line-clamp-2">{t}</p>
                      <button
                        onClick={() => handleRemoveText(i)}
                        className="text-xs text-red-400 hover:text-red-600 shrink-0"
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="リサーチした投稿テキストを貼り付け..."
                rows={3}
                className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={handleAddText}
                disabled={!newText.trim()}
                className="w-full py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-40"
              >
                テキストを追加
              </button>
            </div>
          )}

          {/* 次回投稿 */}
          {config && (
            <div className="flex items-center justify-between bg-gray-50 rounded-lg p-2.5">
              <div>
                <p className="text-xs text-gray-500">次回投稿</p>
                <p className="text-sm font-medium text-gray-700">
                  {config.next_at
                    ? new Date(config.next_at).toLocaleString('ja-JP')
                    : '有効化後すぐ投稿'}
                </p>
              </div>
              <button
                onClick={handleResetNext}
                disabled={resetting}
                className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-40"
              >
                今すぐ投稿
              </button>
            </div>
          )}

          {/* 保存 */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? '保存中...' : '設定を保存'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Bulk Schedule Modal ────────────────────────────────────────────────────────

const BULK_HOUR_OPTIONS = [1, 3, 6, 9, 12, 15, 18, 21, 24, 48] as const

interface BulkProgress {
  account_id: number
  username: string
  status: 'pending' | 'processing' | 'done' | 'skipped' | 'error'
  scheduled_at?: string
  error?: string
}

function BulkScheduleModal({ accounts, onClose, onDone }: {
  accounts: Account[]
  onClose: () => void
  onDone: () => void
}) {
  const [baseHours, setBaseHours]     = useState<number | null>(null)
  const [contentMode, setContentMode] = useState<'random' | 'number'>('random')
  const [stockNumber, setStockNumber] = useState(1)
  const [running, setRunning]         = useState(false)
  const [progress, setProgress]       = useState<BulkProgress[]>([])
  const [done, setDone]               = useState(false)

  const handleRun = async () => {
    if (baseHours === null) return
    setRunning(true)
    setProgress(accounts.map(a => ({ account_id: a.id, username: a.username, status: 'pending' })))

    for (let i = 0; i < accounts.length; i++) {
      const acct = accounts[i]

      setProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'processing' } : p))

      try {
        const stocksResult = await api.stocks.list(acct.id)
        const stocks: PostStock[] = stocksResult.success ? stocksResult.data : []

        if (stocks.length === 0) {
          setProgress(prev => prev.map((p, idx) =>
            idx === i ? { ...p, status: 'skipped', error: 'ストックなし' } : p
          ))
          continue
        }

        let stock: PostStock
        if (contentMode === 'random') {
          stock = stocks[Math.floor(Math.random() * stocks.length)]
        } else {
          stock = stocks[Math.min(stockNumber - 1, stocks.length - 1)]
        }

        const offsetMs = (Math.random() * 2 - 1) * 30 * 60 * 1000
        const scheduledDate = new Date(Date.now() + baseHours * 3600_000 + offsetMs)
        scheduledDate.setSeconds(0, 0)

        const result = await api.stocks.schedulePost({
          account_id:   acct.id,
          content:      stock.content,
          scheduled_at: scheduledDate.toISOString(),
          image_url:    stock.image_url,
          image_url_2:  stock.image_url_2,
        })

        if (result.success) {
          setProgress(prev => prev.map((p, idx) =>
            idx === i ? { ...p, status: 'done', scheduled_at: scheduledDate.toISOString() } : p
          ))
        } else {
          setProgress(prev => prev.map((p, idx) =>
            idx === i ? { ...p, status: 'error', error: result.error ?? 'エラー' } : p
          ))
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setProgress(prev => prev.map((p, idx) =>
          idx === i ? { ...p, status: 'error', error: msg } : p
        ))
      }
    }

    setRunning(false)
    setDone(true)
    onDone()
  }

  const doneCount    = progress.filter(p => p.status === 'done').length
  const skippedCount = progress.filter(p => p.status === 'skipped').length
  const processedCount = progress.filter(p =>
    p.status === 'done' || p.status === 'error' || p.status === 'skipped'
  ).length

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-800">一括予約投稿</h3>
          <button onClick={onClose} disabled={running} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 投稿タイミング */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">
              投稿タイミング
              <span className="text-xs text-gray-400 font-normal ml-1">（各アカウントごとに±30分ランダム）</span>
            </p>
            <div className="grid grid-cols-5 gap-1.5">
              {BULK_HOUR_OPTIONS.map(h => (
                <button
                  key={h}
                  onClick={() => setBaseHours(h)}
                  disabled={running}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${
                    baseHours === h
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {h}h後
                </button>
              ))}
            </div>
            {baseHours !== null && (
              <p className="text-xs text-blue-600 text-center bg-blue-50 rounded-lg py-1.5">
                ベース時間: {baseHours}時間後（各アカウント±30分の範囲でランダム）
              </p>
            )}
          </div>

          {/* 投稿内容 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">投稿内容</p>
            <div className="flex gap-2">
              <button
                onClick={() => setContentMode('random')}
                disabled={running}
                className={`flex-1 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-40 ${
                  contentMode === 'random'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
                }`}
              >
                ランダム
              </button>
              <button
                onClick={() => setContentMode('number')}
                disabled={running}
                className={`flex-1 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-40 ${
                  contentMode === 'number'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
                }`}
              >
                番号指定
              </button>
            </div>
            {contentMode === 'number' && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">ストック番号：</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={stockNumber}
                  onChange={e => setStockNumber(Math.min(10, Math.max(1, Number(e.target.value))))}
                  disabled={running}
                  className="w-16 border border-gray-200 rounded-lg p-1.5 text-sm text-center"
                />
                <span className="text-xs text-gray-400">番目のストック</span>
              </div>
            )}
          </div>

          {/* 進捗 */}
          {progress.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">
                進捗
                <span className="text-xs font-normal text-gray-400 ml-1">
                  {processedCount}/{accounts.length}（完了{doneCount} / スキップ{skippedCount}）
                </span>
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-100 rounded-lg p-2">
                {progress.map(p => (
                  <div key={p.account_id} className="flex items-center gap-2 py-0.5">
                    <span className={`text-sm w-4 text-center shrink-0 ${
                      p.status === 'done'       ? 'text-green-500' :
                      p.status === 'processing' ? 'text-blue-500'  :
                      p.status === 'error'      ? 'text-red-500'   :
                      p.status === 'skipped'    ? 'text-amber-500' :
                      'text-gray-300'
                    }`}>
                      {p.status === 'done'       ? '✓' :
                       p.status === 'processing' ? '⟳' :
                       p.status === 'error'      ? '✗' :
                       p.status === 'skipped'    ? '−' : '○'}
                    </span>
                    <span className="text-sm text-gray-700 font-medium min-w-0 truncate">@{p.username}</span>
                    <span className="text-xs ml-auto shrink-0">
                      {p.status === 'done' && p.scheduled_at && (
                        <span className="text-green-600">
                          {new Date(p.scheduled_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {p.status === 'processing' && <span className="text-blue-400">処理中...</span>}
                      {(p.status === 'error' || p.status === 'skipped') && (
                        <span className={p.status === 'error' ? 'text-red-400' : 'text-amber-500'}>{p.error}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            disabled={running}
            className="flex-1 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40"
          >
            {done ? '閉じる' : 'キャンセル'}
          </button>
          {!done && (
            <button
              onClick={handleRun}
              disabled={running || baseHours === null || accounts.length === 0}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40 font-medium"
            >
              {running
                ? `処理中... ${processedCount}/${accounts.length}`
                : `実行（${accounts.length}アカウント）`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Schedule tab ──────────────────────────────────────────────────────────────

function ScheduleTab({ accounts }: { accounts: Account[] }) {
  const [schedules, setSchedules]         = useState<Schedule[]>([])
  const [form, setForm]                   = useState({ account_id: '', content: '', scheduled_at: '' })
  const [saving, setSaving]               = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)

  const fetchSchedules = async () => {
    const data = await api.schedules.list()
    setSchedules(data)
  }

  useEffect(() => {
    fetchSchedules()
    const unsub = api.on('scheduler:executed', fetchSchedules)
    return unsub
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.account_id || !form.content || !form.scheduled_at) return
    setSaving(true)
    await api.schedules.create({
      account_id:   Number(form.account_id),
      content:      form.content,
      scheduled_at: new Date(form.scheduled_at).toISOString(),
    })
    setForm({ account_id: '', content: '', scheduled_at: '' })
    await fetchSchedules()
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('スケジュールを削除しますか？')) return
    await api.schedules.delete(id)
    setSchedules((prev) => prev.filter((s) => s.id !== id))
  }

  const getAccountName = (id: number) =>
    accounts.find((a) => a.id === id)?.username ?? `ID:${id}`

  return (
    <div className="space-y-4">
      {/* 一括予約投稿ボタン */}
      <button
        onClick={() => setShowBulkModal(true)}
        disabled={accounts.length === 0}
        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        一括予約投稿
      </button>

      {showBulkModal && (
        <BulkScheduleModal
          accounts={accounts}
          onClose={() => setShowBulkModal(false)}
          onDone={fetchSchedules}
        />
      )}

      {/* 新規スケジュール作成フォーム */}
      <form
        onSubmit={handleCreate}
        className="bg-white border border-gray-200 rounded-xl p-4 space-y-3"
      >
        <p className="text-sm font-medium text-gray-700">新しいスケジュール</p>
        <select
          value={form.account_id}
          onChange={(e) => setForm({ ...form, account_id: e.target.value })}
          className="w-full border border-gray-200 rounded-lg p-2 text-sm"
        >
          <option value="">アカウントを選択</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.username}
            </option>
          ))}
        </select>
        <textarea
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          placeholder="投稿内容..."
          rows={3}
          className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex gap-2">
          <input
            type="datetime-local"
            value={form.scheduled_at}
            onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
            className="flex-1 border border-gray-200 rounded-lg p-2 text-sm"
          />
          <button
            type="submit"
            disabled={saving || !form.account_id || !form.content || !form.scheduled_at}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? '保存中...' : '予約'}
          </button>
        </div>
      </form>

      {/* スケジュール一覧 */}
      <div className="space-y-2">
        {schedules.length === 0 ? (
          <p className="text-center text-gray-400 text-sm mt-8">
            スケジュールがありません
          </p>
        ) : (
          schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="bg-white border border-gray-200 rounded-xl p-3 flex gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-600">
                    @{getAccountName(schedule.account_id)}
                  </span>
                  <StatusBadge status={schedule.status} />
                </div>
                <p className="text-sm text-gray-800 line-clamp-2">{schedule.content}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(schedule.scheduled_at).toLocaleString('ja-JP')}
                </p>
              </div>
              {schedule.status === 'pending' && (
                <button
                  onClick={() => handleDelete(schedule.id)}
                  className="text-xs text-red-400 hover:text-red-600 shrink-0"
                >
                  削除
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Auto DM tab ───────────────────────────────────────────────────────────────

function AutoDmTab() {
  const [greetMessage, setGreetMessage] = useState('')
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)

  useEffect(() => {
    api.settings.getAll().then((s) => {
      setGreetMessage(s.auto_dm_greet_message ?? '')
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    await api.settings.set('auto_dm_greet_message', greetMessage)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-5 p-1">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          グリートメッセージ
        </label>
        <p className="text-xs text-gray-500">
          新規フォロワーに自動送信するDMのテンプレートです。
        </p>
        <textarea
          value={greetMessage}
          onChange={(e) => setGreetMessage(e.target.value)}
          rows={6}
          placeholder="例: フォローありがとうございます！よろしくお願いします。"
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
        <p className="text-xs text-gray-400 text-right">
          {greetMessage.length} 文字
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        {saved && (
          <span className="text-emerald-600 text-xs font-medium">✓ 保存しました</span>
        )}
      </div>
    </div>
  )
}

// ── Main Scheduler page ───────────────────────────────────────────────────────

function SchedulerInner({ accounts }: Props) {
  const [tab, setTab] = useState<'schedule' | 'autopost' | 'autodm'>('schedule')

  const TAB_LABELS: Record<typeof tab, string> = {
    schedule: 'スケジュール',
    autopost: '自動投稿',
    autodm:   '自動DM',
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <h2 className="text-lg font-bold text-gray-800">スケジュール投稿</h2>

      {/* タブ */}
      <div className="flex border-b border-gray-200">
        {(['schedule', 'autopost', 'autodm'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'schedule' ? (
          <ScheduleTab accounts={accounts} />
        ) : tab === 'autopost' ? (
          <AutopostTab accounts={accounts} />
        ) : (
          <AutoDmTab />
        )}
      </div>
    </div>
  )
}

export function Scheduler({ accounts, onClose }: Props) {
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

  return <SchedulerInner accounts={accounts} />
}
