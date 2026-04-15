import { useState, useEffect, useCallback, useRef } from 'react'
import { api, Schedule, Account, AutopostConfig, AutoEngagementConfig, PostStock, FollowQueueStats, AutoReplyConfig, AutoReplyRecord, AutoReplyTemplate } from '../lib/ipc'
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
    mode:          'stock' as 'stock' | 'rewrite' | 'random',
    use_api:       false,
    min_interval:  180,
    max_interval:  240,
  })
  const [saving, setSaving]       = useState(false)
  const [resetting, setResetting] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)

  // グループ一括設定
  const [groups, setGroups] = useState<{ name: string }[]>([])
  const [bulkGroup, setBulkGroup] = useState<string>('__all__')
  const [bulkForm, setBulkForm] = useState({
    enabled:      true,
    mode:         'stock' as 'stock' | 'rewrite' | 'random',
    use_api:      false,
    min_interval: 180,
    max_interval: 240,
  })
  const [bulkApplying, setBulkApplying] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  // Immediate API post state
  const [stocks, setStocks]               = useState<PostStock[]>([])
  const [stockSelectMode, setStockSelectMode] = useState<'random' | 'index'>('random')
  const [stockIndex, setStockIndex]       = useState(1)
  const [posting, setPosting]             = useState(false)
  const [postResult, setPostResult]       = useState<{ success: boolean; error?: string } | null>(null)

  useEffect(() => {
    api.settings.getAll().then((s) => {
      setHasApiKey(!!s.anthropic_api_key?.trim())
    })
    api.groups.list().then((gs) => setGroups(gs))
  }, [])

  const handleBulkApply = async () => {
    if (bulkForm.min_interval > bulkForm.max_interval) {
      alert('最小間隔は最大間隔以下にしてください')
      return
    }
    const targets = bulkGroup === '__all__'
      ? accounts
      : accounts.filter((a) => a.group_name === bulkGroup)
    if (targets.length === 0) {
      alert('対象アカウントがありません')
      return
    }
    if (!confirm(`${targets.length}件のアカウントに一括適用しますか？`)) return
    setBulkApplying(true)
    setBulkResult(null)
    let ok = 0, ng = 0

    // 各アカウントの設定を保存
    for (const a of targets) {
      try {
        await api.autopost.save({
          account_id:    a.id,
          enabled:       bulkForm.enabled,
          mode:          bulkForm.mode,
          use_api:       bulkForm.use_api,
          min_interval:  bulkForm.min_interval,
          max_interval:  bulkForm.max_interval,
          rewrite_texts: [],
        })
        ok++
      } catch { ng++ }
    }

    // 有効化時：次回投稿時間を均等分散させる
    // stagger = max_interval / アカウント数（最低1分）
    if (bulkForm.enabled && targets.length > 1) {
      const staggerMin = Math.max(1, Math.floor(bulkForm.max_interval / targets.length))
      const now = Date.now()
      for (let i = 0; i < targets.length; i++) {
        const offsetMs  = i * staggerMin * 60 * 1000
        const nextAt    = new Date(now + offsetMs).toISOString().replace('T', ' ').slice(0, 19)
        try {
          await api.autopost.setNextAt({ account_id: targets[i].id, next_at: nextAt })
        } catch { /* ignore */ }
      }
    }

    setBulkApplying(false)
    const staggerMin = bulkForm.enabled && targets.length > 1
      ? Math.max(1, Math.floor(bulkForm.max_interval / targets.length))
      : 0
    const staggerMsg = staggerMin > 0 ? `（${staggerMin}分ずつ分散）` : ''
    setBulkResult(`完了: ${ok}件成功${ng > 0 ? ` / ${ng}件失敗` : ''}${staggerMsg}`)
    // 現在表示中のアカウントの設定を再読み込み
    if (selectedAccountId) loadConfig(selectedAccountId)
  }

  const loadConfig = useCallback(async (accountId: number) => {
    const cfg = await api.autopost.get(accountId)
    setConfig(cfg)
    if (cfg) {
      setForm({
        enabled:       cfg.enabled,
        mode:          cfg.mode,
        use_api:       cfg.use_api,
        min_interval:  cfg.min_interval,
        max_interval:  cfg.max_interval,
      })
    } else {
      setForm({
        enabled:       false,
        mode:          'stock',
        use_api:       false,
        min_interval:  180,
        max_interval:  240,
      })
    }
    // Load stocks for immediate post
    const result = await api.stocks.list(accountId)
    setStocks(result.success ? result.data : [])
    setPostResult(null)
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
      use_api:       form.use_api,
      min_interval:  form.min_interval,
      max_interval:  form.max_interval,
      rewrite_texts: [],
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

  const handleApiPostNow = async () => {
    if (!selectedAccountId || stocks.length === 0) return
    setPosting(true)
    setPostResult(null)

    let stock: PostStock
    if (stockSelectMode === 'random') {
      stock = stocks[Math.floor(Math.random() * stocks.length)]
    } else {
      const idx = Math.min(Math.max(stockIndex - 1, 0), stocks.length - 1)
      stock = stocks[idx]
    }

    const result = await api.apiPost.send({
      account_id: selectedAccountId,
      content:    stock.content,
      image_urls: [stock.image_url, stock.image_url_2],
      topic:      stock.topic ?? undefined,
    })
    setPosting(false)
    setPostResult(result)
  }

  const BULK_PRESETS = [
    { label: '低頻度',   min: 180, max: 240 },
    { label: '標準',     min: 120, max: 180 },
    { label: '高頻度',   min: 90,  max: 150 },
    { label: '1日3投稿', min: 440, max: 520 },
    { label: '1日4投稿', min: 330, max: 390 },
    { label: '1日5投稿', min: 260, max: 310 },
  ]

  return (
    <div className="space-y-4">
      {/* グループ一括設定 */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-3">
        <p className="text-xs font-semibold text-indigo-700">グループ一括設定</p>

        {/* グループ選択 */}
        <select
          value={bulkGroup}
          onChange={(e) => setBulkGroup(e.target.value)}
          className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white"
        >
          <option value="__all__">全アカウント（{accounts.length}件）</option>
          {groups.map((g) => {
            const cnt = accounts.filter((a) => a.group_name === g.name).length
            return <option key={g.name} value={g.name}>{g.name}（{cnt}件）</option>
          })}
        </select>

        {/* 投稿方法 */}
        <div>
          <p className="text-xs text-indigo-600 mb-1">投稿方法</p>
          <div className="flex gap-2">
            <button
              onClick={() => setBulkForm((f) => ({ ...f, use_api: false }))}
              className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                !bulkForm.use_api ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >ブラウザ</button>
            <button
              onClick={() => setBulkForm((f) => ({ ...f, use_api: true }))}
              className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                bulkForm.use_api ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >API（非公式）</button>
          </div>
        </div>

        {/* 投稿モード */}
        <div>
          <p className="text-xs text-indigo-600 mb-1">投稿モード</p>
          <div className="flex gap-2">
            <button
              onClick={() => setBulkForm((f) => ({ ...f, mode: 'stock' }))}
              className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                bulkForm.mode === 'stock' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >ストック順</button>
            <button
              onClick={() => setBulkForm((f) => ({ ...f, mode: 'random' }))}
              className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                bulkForm.mode === 'random' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >ランダム</button>
            <button
              onClick={() => hasApiKey && setBulkForm((f) => ({ ...f, mode: 'rewrite' }))}
              disabled={!hasApiKey}
              className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                !hasApiKey ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                : bulkForm.mode === 'rewrite' ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200'
              }`}
            >AIリライト</button>
          </div>
        </div>

        {/* 自動投稿 ON/OFF */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-indigo-600">自動投稿</span>
          <button
            onClick={() => setBulkForm((f) => ({ ...f, enabled: !f.enabled }))}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              bulkForm.enabled ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              bulkForm.enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>

        {/* 投稿間隔 */}
        <div>
          <p className="text-xs text-indigo-600 mb-1">投稿間隔（分）</p>
          {[BULK_PRESETS.slice(0, 3), BULK_PRESETS.slice(3)].map((row, ri) => (
            <div key={ri} className="flex gap-1.5 mb-1">
              {row.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setBulkForm((f) => ({ ...f, min_interval: p.min, max_interval: p.max }))}
                  className={`flex-1 text-xs py-1 rounded border transition-colors ${
                    bulkForm.min_interval === p.min && bulkForm.max_interval === p.max
                      ? 'bg-indigo-500 text-white border-indigo-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  {p.label}
                  <span className="block text-[10px] opacity-70">{p.min}〜{p.max}分</span>
                </button>
              ))}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-400">最小</label>
              <input
                type="number" min={1}
                value={bulkForm.min_interval}
                onChange={(e) => setBulkForm((f) => ({ ...f, min_interval: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg p-1.5 text-sm"
              />
            </div>
            <span className="text-gray-400 mt-4">〜</span>
            <div className="flex-1">
              <label className="text-xs text-gray-400">最大</label>
              <input
                type="number" min={1}
                value={bulkForm.max_interval}
                onChange={(e) => setBulkForm((f) => ({ ...f, max_interval: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg p-1.5 text-sm"
              />
            </div>
          </div>
        </div>

        {/* 適用ボタン */}
        <button
          onClick={handleBulkApply}
          disabled={bulkApplying}
          className="w-full py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {bulkApplying
            ? '適用中...'
            : `このグループに一括適用（${
                bulkGroup === '__all__'
                  ? accounts.length
                  : accounts.filter((a) => a.group_name === bulkGroup).length
              }件）`}
        </button>
        {bulkResult && (
          <p className="text-xs text-indigo-700 text-center">{bulkResult}</p>
        )}
      </div>

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

          {/* 投稿方法 */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-600">投稿方法</p>
            <div className="flex gap-2">
              <button
                onClick={() => setForm((f) => ({ ...f, use_api: false }))}
                className={`flex-1 py-1.5 rounded-lg text-sm border transition-colors ${
                  !form.use_api
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
                }`}
              >
                ブラウザ
              </button>
              <button
                onClick={() => setForm((f) => ({ ...f, use_api: true }))}
                className={`flex-1 py-1.5 rounded-lg text-sm border transition-colors ${
                  form.use_api
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-400'
                }`}
              >
                API（非公式）
              </button>
            </div>
            {form.use_api && (
              <p className="text-xs text-emerald-600">
                ブラウザなしで直接APIから投稿します（高速・低負荷）
              </p>
            )}
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
                onClick={() => setForm((f) => ({ ...f, mode: 'random' }))}
                className={`flex-1 py-1.5 rounded-lg text-sm border transition-colors ${
                  form.mode === 'random'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
                }`}
              >
                ランダム
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
            {[
              [
                { label: '低頻度',   min: 180, max: 240 },
                { label: '標準',     min: 120, max: 180 },
                { label: '高頻度',   min: 90,  max: 150 },
              ],
              [
                { label: '1日3投稿', min: 440, max: 520 },
                { label: '1日4投稿', min: 330, max: 390 },
                { label: '1日5投稿', min: 260, max: 310 },
              ],
            ].map((row, ri) => (
              <div key={ri} className="flex gap-1.5 mb-1">
                {row.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, min_interval: p.min, max_interval: p.max }))}
                    className={`flex-1 text-xs py-1 rounded border transition-colors ${
                      form.min_interval === p.min && form.max_interval === p.max
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                    }`}
                  >
                    {p.label}
                    <span className="block text-[10px] opacity-70">{p.min}〜{p.max}分</span>
                  </button>
                ))}
              </div>
            ))}
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

          {/* AIリライト: ストック件数表示 */}
          {form.mode === 'rewrite' && (
            <div className="bg-blue-50 rounded-lg p-2.5">
              <p className="text-xs text-blue-700">
                ストックのテキストを順番に取り出し、AIでリライトして投稿します。
              </p>
              <p className="text-xs text-blue-500 mt-1">
                ストック件数: <span className="font-medium">{stocks.length} 件</span>
                {stocks.length === 0 && '（先にストックを登録してください）'}
              </p>
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

      {/* 今すぐAPI投稿 */}
      {selectedAccountId && stocks.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">今すぐAPI投稿</p>
          <p className="text-xs text-gray-500">ストックから選んでAPI経由で即時投稿します（ブラウザ不要）</p>

          {/* ストック選択モード */}
          <div className="flex gap-2">
            <button
              onClick={() => setStockSelectMode('random')}
              className={`flex-1 py-1.5 rounded-lg text-sm border transition-colors ${
                stockSelectMode === 'random'
                  ? 'bg-gray-700 text-white border-gray-700'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              ランダム
            </button>
            <button
              onClick={() => setStockSelectMode('index')}
              className={`flex-1 py-1.5 rounded-lg text-sm border transition-colors ${
                stockSelectMode === 'index'
                  ? 'bg-gray-700 text-white border-gray-700'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              番号指定
            </button>
          </div>

          {stockSelectMode === 'index' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 whitespace-nowrap">
                ストック番号（1〜{stocks.length}）
              </label>
              <input
                type="number"
                min={1}
                max={stocks.length}
                value={stockIndex}
                onChange={(e) => setStockIndex(Number(e.target.value))}
                className="w-20 border border-gray-200 rounded-lg p-1.5 text-sm text-center"
              />
            </div>
          )}

          <button
            onClick={handleApiPostNow}
            disabled={posting}
            className="w-full py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-40 font-medium"
          >
            {posting ? '投稿中...' : 'API投稿'}
          </button>

          {postResult && (
            <p className={`text-xs font-medium ${postResult.success ? 'text-emerald-600' : 'text-red-500'}`}>
              {postResult.success ? '✓ 投稿成功' : `✗ ${postResult.error ?? '投稿失敗'}`}
            </p>
          )}
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

// ── グループ一括予約モーダル ────────────────────────────────────────────────────

function GroupBulkScheduleModal({ accounts, onClose, onDone }: {
  accounts: Account[]
  onClose: () => void
  onDone: () => void
}) {
  const HOUR_OPTIONS = [1, 3, 6, 9, 12, 15, 18, 21, 24, 48]

  const [groups, setGroups]           = useState<{ name: string }[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string>('__all__')
  const [selectedHours, setSelectedHours] = useState<number | null>(null)
  const [contentMode, setContentMode] = useState<'random' | 'number'>('random')
  const [stockNumber, setStockNumber] = useState(1)
  const [running, setRunning]         = useState(false)
  const [progress, setProgress]       = useState<BulkProgress[]>([])
  const [done, setDone]               = useState(false)
  const [cancelled, setCancelled]     = useState(false)
  const cancelledRef                  = useRef(false)

  useEffect(() => {
    api.groups.list().then((gs) => setGroups(gs))
  }, [])

  const targets = selectedGroup === '__all__'
    ? accounts
    : accounts.filter((a) => a.group_name === selectedGroup)

  const handleCancel = () => {
    if (running) {
      cancelledRef.current = true
    } else {
      onClose()
    }
  }

  const handleRun = async () => {
    if (selectedHours === null) return
    const baseDate = new Date(Date.now() + selectedHours * 3600_000)
    baseDate.setSeconds(0, 0)
    if (targets.length === 0) { alert('対象アカウントがありません'); return }
    if (!confirm(`${targets.length}件のアカウントに予約を設定しますか？`)) return

    cancelledRef.current = false
    setCancelled(false)
    setRunning(true)
    setProgress(targets.map(a => ({ account_id: a.id, username: a.username, status: 'pending' })))

    for (let i = 0; i < targets.length; i++) {
      if (cancelledRef.current) break
      const acct = targets[i]
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

        // ±30分のランダムオフセット
        const offsetMs = (Math.random() * 2 - 1) * 30 * 60 * 1000
        const scheduledDate = new Date(baseDate.getTime() + offsetMs)
        scheduledDate.setSeconds(0, 0)

        const result = await api.stocks.schedulePost({
          account_id:   acct.id,
          content:      stock.content,
          scheduled_at: scheduledDate.toISOString(),
          image_url:    stock.image_url,
          image_url_2:  stock.image_url_2,
          topic:        stock.topic,
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

    if (cancelledRef.current) {
      setCancelled(true)
      setRunning(false)
    } else {
      setRunning(false)
      setDone(true)
      onDone()
    }
  }

  const doneCount      = progress.filter(p => p.status === 'done').length
  const skippedCount   = progress.filter(p => p.status === 'skipped').length
  const processedCount = progress.filter(p =>
    p.status === 'done' || p.status === 'error' || p.status === 'skipped'
  ).length

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-800">グループ一括予約投稿</h3>
          <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* グループ選択 */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-gray-700">対象グループ</p>
            <select
              value={selectedGroup}
              onChange={e => setSelectedGroup(e.target.value)}
              disabled={running}
              className="w-full border border-gray-200 rounded-lg p-2 text-sm disabled:opacity-40"
            >
              <option value="__all__">すべてのアカウント ({accounts.length}件)</option>
              {groups.map(g => (
                <option key={g.name} value={g.name}>
                  {g.name} ({accounts.filter(a => a.group_name === g.name).length}件)
                </option>
              ))}
            </select>
            <p className="text-xs text-blue-600">
              対象: {targets.length}アカウント
            </p>
          </div>

          {/* 投稿タイミング */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-gray-700">
              投稿タイミング
              <span className="text-xs text-gray-400 font-normal ml-1">（各アカウントごとに±30分ランダム）</span>
            </p>
            <div className="grid grid-cols-5 gap-1.5">
              {HOUR_OPTIONS.map(h => (
                <button
                  key={h}
                  onClick={() => setSelectedHours(h)}
                  disabled={running}
                  className={`py-2 rounded-lg text-sm border transition-colors disabled:opacity-40 ${
                    selectedHours === h
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-violet-400'
                  }`}
                >
                  {h}h後
                </button>
              ))}
            </div>
            {selectedHours !== null && (
              <p className="text-xs text-gray-400">
                ベース: {new Date(Date.now() + selectedHours * 3600_000).toLocaleString('ja-JP')} ごろ（各アカウント±30分）
              </p>
            )}
          </div>

          {/* 投稿内容 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">投稿内容（ストック）</p>
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
                  max={999}
                  value={stockNumber}
                  onChange={e => setStockNumber(Math.max(1, Number(e.target.value)))}
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
                  {processedCount}/{targets.length}（完了{doneCount} / スキップ{skippedCount}）
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
        <div className="px-5 py-4 border-t border-gray-100 flex flex-col gap-2">
          {cancelled && (
            <p className="text-xs text-amber-600 text-center">
              キャンセルしました（{doneCount}/{targets.length}完了）
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="flex-1 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
            >
              {done || cancelled ? '閉じる' : running ? '中断する' : 'キャンセル'}
            </button>
            {!done && !cancelled && (
              <button
                onClick={handleRun}
                disabled={running || selectedHours === null || targets.length === 0}
                className="flex-1 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 disabled:opacity-40 font-medium"
              >
                {running
                  ? `処理中... ${processedCount}/${targets.length}`
                  : `予約設定（${targets.length}アカウント）`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
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
  const [cancelled, setCancelled]     = useState(false)
  const cancelledRef                  = useRef(false)

  const handleCancel = () => {
    if (running) {
      cancelledRef.current = true
    } else {
      onClose()
    }
  }

  const handleRun = async () => {
    if (baseHours === null) return
    cancelledRef.current = false
    setCancelled(false)
    setRunning(true)
    setProgress(accounts.map(a => ({ account_id: a.id, username: a.username, status: 'pending' })))

    for (let i = 0; i < accounts.length; i++) {
      if (cancelledRef.current) break
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
          topic:        stock.topic,
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

    if (cancelledRef.current) {
      setCancelled(true)
      setRunning(false)
    } else {
      setRunning(false)
      setDone(true)
      onDone()
    }
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
          <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
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
        <div className="px-5 py-4 border-t border-gray-100 flex flex-col gap-2">
          {cancelled && (
            <p className="text-xs text-amber-600 text-center">
              キャンセルしました（{doneCount}/{accounts.length}完了）
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="flex-1 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
            >
              {done || cancelled ? '閉じる' : running ? '中断する' : 'キャンセル'}
            </button>
            {!done && !cancelled && (
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
    </div>
  )
}

// ── Schedule tab ──────────────────────────────────────────────────────────────

function ScheduleTab({ accounts }: { accounts: Account[] }) {
  const [schedules, setSchedules]               = useState<Schedule[]>([])
  const [form, setForm]                         = useState({ account_id: '', content: '', scheduled_at: '' })
  const [saving, setSaving]                     = useState(false)
  const [showBulkModal, setShowBulkModal]       = useState(false)
  const [showGroupBulkModal, setShowGroupBulkModal] = useState(false)

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
      {/* ボタン行 */}
      <div className="flex gap-2">
        <button
          onClick={() => setShowBulkModal(true)}
          disabled={accounts.length === 0}
          className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          一括予約
        </button>
        <button
          onClick={() => setShowGroupBulkModal(true)}
          disabled={accounts.length === 0}
          className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          グループ一括予約
        </button>
      </div>

      {showBulkModal && (
        <BulkScheduleModal
          accounts={accounts}
          onClose={() => setShowBulkModal(false)}
          onDone={fetchSchedules}
        />
      )}

      {showGroupBulkModal && (
        <GroupBulkScheduleModal
          accounts={accounts}
          onClose={() => setShowGroupBulkModal(false)}
          onDone={() => { setShowGroupBulkModal(false); fetchSchedules() }}
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

// ── Auto Engagement tab ───────────────────────────────────────────────────────

function AutoEngagementConfigCard({
  title,
  description,
  action,
  accountId,
}: {
  title: string
  description: string
  action: 'like' | 'follow'
  accountId: number
}) {
  const [config, setConfig] = useState<AutoEngagementConfig | null>(null)
  const [form, setForm] = useState({
    target_usernames: '',
    enabled:          false,
    min_interval:     30,
    max_interval:     60,
  })
  const [saving, setSaving]       = useState(false)
  const [resetting, setResetting] = useState(false)
  const [queueStats, setQueueStats]       = useState<FollowQueueStats | null>(null)
  const [competitorName, setCompetitorName] = useState('')
  const [fetching, setFetching]           = useState(false)
  const [fetchProgress, setFetchProgress] = useState<number | null>(null)
  const [fetchMsg, setFetchMsg]           = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    api.autoEngagement.get(accountId, action).then((cfg) => {
      setConfig(cfg)
      if (cfg) {
        setForm({
          target_usernames: cfg.target_usernames,
          enabled:          cfg.enabled,
          min_interval:     cfg.min_interval,
          max_interval:     cfg.max_interval,
        })
      }
    })
  }, [accountId, action])

  useEffect(() => {
    const unsub = api.on('autoEngagement:executed', (data: unknown) => {
      const d = data as { account_id: number; action: string; next_at: string }
      if (d.account_id === accountId && d.action === action) {
        setConfig((prev) => prev ? { ...prev, next_at: d.next_at } : prev)
        if (action === 'follow') {
          api.followQueue.stats(accountId).then(setQueueStats)
        }
      }
    })
    return unsub
  }, [accountId, action])

  // follow アクション時のみキュー統計を取得
  useEffect(() => {
    if (action !== 'follow') return
    api.followQueue.stats(accountId).then(setQueueStats)
  }, [accountId, action])

  // fetchAndEnqueue 中の進捗イベントを受信
  useEffect(() => {
    if (action !== 'follow') return
    const unsub = api.on('followQueue:fetchProgress', (data: unknown) => {
      const d = data as { fetched: number }
      setFetchProgress(d.fetched)
    })
    return unsub
  }, [action])

  const handleSave = async () => {
    if (form.min_interval > form.max_interval) {
      alert('最小間隔は最大間隔以下にしてください')
      return
    }
    setSaving(true)
    const saved = await api.autoEngagement.save({
      account_id:       accountId,
      action,
      target_usernames: form.target_usernames,
      enabled:          form.enabled,
      min_interval:     form.min_interval,
      max_interval:     form.max_interval,
    })
    setConfig(saved)
    setSaving(false)
  }

  const handleResetNext = async () => {
    setResetting(true)
    await api.autoEngagement.resetNext(accountId, action)
    setConfig((prev) => prev ? { ...prev, next_at: null } : prev)
    setResetting(false)
  }

  const handleFetchAndEnqueue = async () => {
    if (!competitorName.trim()) return
    setFetching(true)
    setFetchProgress(0)
    setFetchMsg(null)
    const result = await api.followQueue.fetchAndEnqueue(accountId, competitorName)
    setFetching(false)
    setFetchProgress(null)
    if (result.error && result.added === 0) {
      setFetchMsg({ type: 'error', text: result.error })
    } else {
      setFetchMsg({ type: 'ok', text: `${result.added} 件をキューに追加しました（取得 ${result.total} 件）` })
    }
    const stats = await api.followQueue.stats(accountId)
    setQueueStats(stats)
  }

  const handleClearQueue = async () => {
    if (!confirm('未処理のキューをクリアしますか？')) return
    await api.followQueue.clearPending(accountId)
    setFetchMsg(null)
    const stats = await api.followQueue.stats(accountId)
    setQueueStats(stats)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>

      {/* 有効/無効 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">有効</span>
        <button
          onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            form.enabled ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            form.enabled ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {/* ターゲットユーザー名 */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-600">
          {action === 'like' ? 'ターゲットユーザー名（1名）' : 'フォロー対象ユーザー名（1行1名）'}
        </label>
        {action === 'like' ? (
          <input
            type="text"
            value={form.target_usernames}
            onChange={(e) => setForm((f) => ({ ...f, target_usernames: e.target.value.trim() }))}
            placeholder="@username（@不要）"
            className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        ) : (
          <textarea
            value={form.target_usernames}
            onChange={(e) => setForm((f) => ({ ...f, target_usernames: e.target.value }))}
            rows={4}
            placeholder={"username1\nusername2\nusername3\n（@不要、1行1名）"}
            className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        )}
      </div>

      {/* 実行間隔 */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-gray-600">実行間隔（分）</p>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-xs text-gray-400">最小</label>
            <input
              type="number" min={1}
              value={form.min_interval}
              onChange={(e) => setForm((f) => ({ ...f, min_interval: Number(e.target.value) }))}
              className="w-full border border-gray-200 rounded-lg p-1.5 text-sm"
            />
          </div>
          <span className="text-gray-400 mt-4">〜</span>
          <div className="flex-1">
            <label className="text-xs text-gray-400">最大</label>
            <input
              type="number" min={1}
              value={form.max_interval}
              onChange={(e) => setForm((f) => ({ ...f, max_interval: Number(e.target.value) }))}
              className="w-full border border-gray-200 rounded-lg p-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      {/* 次回実行 */}
      {config && (
        <div className="flex items-center justify-between bg-gray-50 rounded-lg p-2.5">
          <div>
            <p className="text-xs text-gray-500">次回実行</p>
            <p className="text-sm font-medium text-gray-700">
              {config.next_at
                ? new Date(config.next_at).toLocaleString('ja-JP')
                : '有効化後すぐ実行'}
            </p>
          </div>
          <button
            onClick={handleResetNext}
            disabled={resetting}
            className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-40"
          >
            今すぐ
          </button>
        </div>
      )}

      {action === 'follow' && config && config.follow_idx > 0 && (
        <p className="text-xs text-gray-400">
          フォロー済み: {config.follow_idx} / {form.target_usernames.split('\n').filter(s => s.trim()).length} 名
        </p>
      )}

      {/* ── 競合フォロワーキュー（follow アクションのみ） ── */}
      {action === 'follow' && (
        <div className="border border-blue-100 bg-blue-50 rounded-lg p-3 space-y-3">
          <p className="text-xs font-semibold text-blue-700">競合フォロワーキュー</p>

          {/* キュー統計 */}
          {queueStats && (
            <div className="flex gap-3 text-xs">
              <span className="text-orange-500 font-medium">待機中 {queueStats.pending}</span>
              <span className="text-green-600 font-medium">完了 {queueStats.done}</span>
              {queueStats.failed > 0 && (
                <span className="text-red-400 font-medium">失敗 {queueStats.failed}</span>
              )}
            </div>
          )}

          {/* 競合アカウント名入力 */}
          <div className="space-y-1">
            <label className="text-xs text-gray-500">競合アカウント名（@不要）</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value.replace(/^@/, ''))}
                onKeyDown={(e) => e.key === 'Enter' && !fetching && handleFetchAndEnqueue()}
                placeholder="例: someaccount"
                disabled={fetching}
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              />
              <button
                onClick={handleFetchAndEnqueue}
                disabled={fetching || !competitorName.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap"
              >
                {fetching ? '取得中...' : '取得'}
              </button>
            </div>
          </div>

          {/* 進捗表示 */}
          {fetching && fetchProgress !== null && (
            <p className="text-xs text-blue-500 animate-pulse">
              取得中... {fetchProgress} 件
            </p>
          )}

          {/* 結果メッセージ */}
          {fetchMsg && (
            <p className={`text-xs ${fetchMsg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
              {fetchMsg.text}
            </p>
          )}

          {/* クリアボタン */}
          {queueStats && queueStats.pending > 0 && (
            <button
              onClick={handleClearQueue}
              className="w-full py-1 bg-gray-100 text-gray-500 rounded-lg text-xs hover:bg-gray-200"
            >
              待機中キューをクリア
            </button>
          )}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40"
      >
        {saving ? '保存中...' : '設定を保存'}
      </button>
    </div>
  )
}

function AutoEngagementTab({ accounts }: { accounts: Account[] }) {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)

  return (
    <div className="space-y-4">
      <select
        value={selectedAccountId ?? ''}
        onChange={(e) => setSelectedAccountId(Number(e.target.value) || null)}
        className="w-full border border-gray-200 rounded-lg p-2 text-sm"
      >
        <option value="">アカウントを選択</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>@{a.username}</option>
        ))}
      </select>

      {selectedAccountId && (
        <>
          <AutoEngagementConfigCard
            key={`like-${selectedAccountId}`}
            title="自動いいね"
            description="指定ユーザーの最新投稿に間隔ごとに1件ずついいねします"
            action="like"
            accountId={selectedAccountId}
          />
          <AutoEngagementConfigCard
            key={`follow-${selectedAccountId}`}
            title="自動フォロー"
            description="リストのユーザーを順番にフォローします（間隔ごとに1名）"
            action="follow"
            accountId={selectedAccountId}
          />
        </>
      )}
    </div>
  )
}

// ── Auto Reply tab ─────────────────────────────────────────────────────────────

function CheckNowButton({ groupName, onDone, disabled }: { groupName: string; onDone: () => void; disabled: boolean }) {
  const [running, setRunning] = useState(false)
  const handleClick = async () => {
    setRunning(true)
    await api.autoReply.checkNow(groupName)
    setTimeout(() => { onDone(); setRunning(false) }, 3000)
  }
  return (
    <button
      onClick={handleClick}
      disabled={disabled || running}
      className="text-xs text-emerald-600 border border-emerald-300 rounded px-2.5 py-1 hover:bg-emerald-50 disabled:opacity-40"
    >
      {running ? 'チェック中...' : '今すぐチェック'}
    </button>
  )
}

function AutoReplyTab({ accounts }: { accounts: Account[] }) {
  const [groups, setGroups]         = useState<{ name: string }[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [form, setForm] = useState({
    enabled:        false,
    check_interval: 5,
    reply_texts:    [] as string[],
  })
  const [config, setConfig]     = useState<AutoReplyConfig | null>(null)
  const [saving, setSaving]     = useState(false)
  const [newText, setNewText]   = useState('')
  const [history, setHistory]   = useState<AutoReplyRecord[]>([])
  const [templates, setTemplates] = useState<AutoReplyTemplate[]>([])
  const [tmplName, setTmplName] = useState('')
  const [savingTmpl, setSavingTmpl] = useState(false)
  const csvInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.groups.list().then(setGroups)
    api.autoReply.templates.list().then(setTemplates)
  }, [])

  const loadConfig = async (groupName: string) => {
    const cfg = await api.autoReply.get(groupName)
    setConfig(cfg)
    if (cfg) {
      setForm({ enabled: cfg.enabled, check_interval: cfg.check_interval, reply_texts: cfg.reply_texts })
    } else {
      setForm({ enabled: false, check_interval: 5, reply_texts: [] })
    }
    const hist = await api.autoReply.history(groupName)
    setHistory(hist)
  }

  useEffect(() => {
    if (selectedGroup) loadConfig(selectedGroup)
  }, [selectedGroup])

  const handleSave = async () => {
    if (!selectedGroup) return
    setSaving(true)
    const saved = await api.autoReply.save({
      group_name:     selectedGroup,
      enabled:        form.enabled,
      check_interval: form.check_interval,
      reply_texts:    form.reply_texts,
    })
    setConfig(saved)
    setSaving(false)
  }

  const handleAddText = () => {
    const t = newText.trim()
    if (!t) return
    setForm(f => ({ ...f, reply_texts: [...f.reply_texts, t] }))
    setNewText('')
  }

  const handleRemoveText = (idx: number) => {
    setForm(f => ({ ...f, reply_texts: f.reply_texts.filter((_, i) => i !== idx) }))
  }

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
      setForm(f => {
        const existing = new Set(f.reply_texts)
        const merged = [...f.reply_texts, ...lines.filter(l => !existing.has(l))]
        return { ...f, reply_texts: merged }
      })
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  const handleSaveTemplate = async () => {
    if (!tmplName.trim() || form.reply_texts.length === 0) return
    setSavingTmpl(true)
    const saved = await api.autoReply.templates.save(tmplName.trim(), form.reply_texts)
    setTemplates(prev => {
      const idx = prev.findIndex(t => t.id === saved.id)
      return idx >= 0 ? prev.map((t, i) => i === idx ? saved : t) : [saved, ...prev]
    })
    setTmplName('')
    setSavingTmpl(false)
  }

  const handleLoadTemplate = (tmpl: AutoReplyTemplate) => {
    setForm(f => ({ ...f, reply_texts: tmpl.reply_texts }))
  }

  const handleDeleteTemplate = async (id: number) => {
    await api.autoReply.templates.delete(id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  const statusLabel = (s: AutoReplyRecord['status']) => {
    if (s === 'replied') return <span className="text-green-600 text-xs">返信済</span>
    if (s === 'skipped') return <span className="text-amber-500 text-xs">スキップ</span>
    return <span className="text-gray-400 text-xs">待機中</span>
  }

  const groupAccounts = accounts.filter(a => a.group_name === selectedGroup)

  return (
    <div className="space-y-4">
      {/* グループ選択 */}
      <select
        value={selectedGroup}
        onChange={e => setSelectedGroup(e.target.value)}
        className="w-full border border-gray-200 rounded-lg p-2 text-sm"
      >
        <option value="">グループを選択</option>
        {groups.map(g => (
          <option key={g.name} value={g.name}>{g.name}</option>
        ))}
      </select>

      {selectedGroup && (
        <>
          {/* アカウント一覧（表示のみ） */}
          {groupAccounts.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {groupAccounts.map(a => (
                <span key={a.id} className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">@{a.username}</span>
              ))}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">

            {/* 有効/無効 */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">有効</span>
              <button
                onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {/* チェック頻度 */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-600">チェック間隔（分）</p>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1}
                  value={form.check_interval}
                  onChange={e => setForm(f => ({ ...f, check_interval: Number(e.target.value) }))}
                  className="w-24 border border-gray-200 rounded-lg p-1.5 text-sm"
                />
                <span className="text-xs text-gray-400">分ごとにリプをチェック</span>
              </div>
            </div>

            {/* 返信テキストリスト */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-600">
                  返信テキスト（ランダム選択）
                  {form.reply_texts.length > 0 && (
                    <span className="ml-1.5 text-gray-400 font-normal">{form.reply_texts.length}件</span>
                  )}
                </p>
                <button
                  onClick={() => csvInputRef.current?.click()}
                  className="text-xs text-green-600 border border-green-300 rounded px-2 py-0.5 hover:bg-green-50"
                >
                  CSVインポート
                </button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={handleCsvImport}
                />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5">
                {form.reply_texts.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-2 py-1.5">
                    <span className="flex-1 text-xs text-gray-700 break-all">{t}</span>
                    <button onClick={() => handleRemoveText(i)} className="text-gray-400 hover:text-red-500 text-xs shrink-0 mt-0.5">✕</button>
                  </div>
                ))}
                {form.reply_texts.length === 0 && <p className="text-xs text-gray-400">テキストがありません</p>}
              </div>
              <div className="flex gap-1.5">
                <textarea
                  value={newText}
                  onChange={e => setNewText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddText() } }}
                  placeholder="返信テキストを入力（Enterで追加）"
                  rows={2}
                  className="flex-1 border border-gray-200 rounded-lg p-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <button
                  onClick={handleAddText}
                  disabled={!newText.trim()}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-40 self-start"
                >
                  追加
                </button>
              </div>
            </div>

            {/* テンプレート */}
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-600">テンプレート</p>
              {/* 保存 */}
              <div className="flex gap-1.5">
                <input
                  value={tmplName}
                  onChange={e => setTmplName(e.target.value)}
                  placeholder="テンプレート名"
                  className="flex-1 border border-gray-200 rounded-lg p-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={handleSaveTemplate}
                  disabled={savingTmpl || !tmplName.trim() || form.reply_texts.length === 0}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-40"
                >
                  現在のテキストを保存
                </button>
              </div>
              {/* テンプレート一覧 */}
              {templates.length > 0 && (
                <div className="space-y-1">
                  {templates.map(tmpl => (
                    <div key={tmpl.id} className="flex items-center justify-between bg-indigo-50 rounded-lg px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-indigo-700 truncate">{tmpl.name}</p>
                        <p className="text-xs text-gray-400">{tmpl.reply_texts.length}件のテキスト</p>
                      </div>
                      <div className="flex gap-1 shrink-0 ml-2">
                        <button
                          onClick={() => handleLoadTemplate(tmpl)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 px-1.5 py-0.5 rounded border border-indigo-200 hover:bg-indigo-100"
                        >
                          読込
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(tmpl.id)}
                          className="text-xs text-gray-400 hover:text-red-500"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {templates.length === 0 && <p className="text-xs text-gray-400">保存済みテンプレートなし</p>}
            </div>

            {/* 最終チェック + 今すぐチェック */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {config?.last_checked_at
                  ? `最終チェック: ${new Date(config.last_checked_at).toLocaleString('ja-JP')}`
                  : '未チェック'}
              </p>
              <CheckNowButton groupName={selectedGroup} onDone={() => loadConfig(selectedGroup)} disabled={!config} />
            </div>

            {/* 保存ボタン */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>

          {/* 返信履歴 */}
          {history.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600">返信履歴（最新100件）</p>
              <div className="space-y-1.5">
                {history.map(r => (
                  <div key={r.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700">@{r.reply_username ?? '不明'}</span>
                      {statusLabel(r.status)}
                    </div>
                    {r.reply_text && <p className="text-xs text-gray-500 truncate">{r.reply_text}</p>}
                    <p className="text-xs text-gray-300">{new Date(r.created_at).toLocaleString('ja-JP')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main Scheduler page ───────────────────────────────────────────────────────

function SchedulerInner({ accounts }: Props) {
  const [tab, setTab] = useState<'schedule' | 'autopost' | 'engagement' | 'autoreply' | 'autodm'>('schedule')

  const TAB_LABELS: Record<typeof tab, string> = {
    schedule:   'スケジュール',
    autopost:   '自動投稿',
    engagement: '自動ENG',
    autoreply:  '自動返信',
    autodm:     '自動DM',
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <h2 className="text-lg font-bold text-gray-800">スケジュール投稿</h2>

      {/* タブ */}
      <div className="flex border-b border-gray-200 overflow-x-auto">
        {(['schedule', 'autopost', 'engagement', 'autoreply', 'autodm'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
        ) : tab === 'engagement' ? (
          <AutoEngagementTab accounts={accounts} />
        ) : tab === 'autoreply' ? (
          <AutoReplyTab accounts={accounts} />
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
