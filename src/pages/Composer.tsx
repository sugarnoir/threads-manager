import { useState, useEffect, useRef } from 'react'
import { api, Account, PostStock, PostTemplate } from '../lib/ipc'

interface Props {
  accounts: Account[]
  selectedAccountId: number | null
}

export function Composer({ accounts, selectedAccountId }: Props) {
  const [content, setContent] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>(
    selectedAccountId ? [selectedAccountId] : []
  )
  const [sending, setSending]   = useState(false)
  const [results, setResults]   = useState<
    Array<{ account_id: number; success: boolean; error?: string }>
  >([])

  // Stocks
  const [stocks, setStocks]           = useState<PostStock[]>([])
  const [stockPanelOpen, setStockPanelOpen] = useState(false)
  const stockBtnRef = useRef<HTMLButtonElement>(null)

  // Load stocks for the primary selected account
  const primaryId = selectedIds[0] ?? selectedAccountId ?? null

  // Templates
  const [templates, setTemplates]             = useState<PostTemplate[]>([])
  const [templatePanelOpen, setTemplatePanelOpen] = useState(false)

  useEffect(() => {
    try {
      api.templates.list(primaryId)
        .then((res) => { if (res.success) setTemplates(res.data) })
        .catch(() => {})
    } catch { /* api.templates not yet available */ }
  }, [primaryId])
  useEffect(() => {
    if (primaryId === null) { setStocks([]); return }
    try {
      api.stocks.list(primaryId)
        .then((res) => { if (res.success) setStocks(res.data) })
        .catch(() => {})
    } catch { /* api.stocks not yet available */ }
  }, [primaryId])

  const toggleAccount = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleSend = async () => {
    if (!content.trim() || selectedIds.length === 0) return
    setSending(true)
    setResults([])

    if (selectedIds.length === 1) {
      const result = await api.posts.send({
        account_id: selectedIds[0],
        content: content.trim(),
      })
      setResults([{ account_id: selectedIds[0], success: result.success, error: result.error }])
    } else {
      const results = await api.posts.broadcast({
        account_ids: selectedIds,
        content: content.trim(),
      })
      setResults(results.map((r) => ({ ...r, error: undefined })))
    }

    setSending(false)
    if (results.every((r) => r.success)) {
      setContent('')
    }
  }

  const charCount = content.length
  const maxChars = 500

  return (
    <div className="h-full flex flex-col gap-4">
      <h2 className="text-lg font-bold text-gray-800">投稿作成</h2>

      {/* アカウント選択 */}
      <div>
        <p className="text-sm text-gray-600 mb-2">投稿するアカウント</p>
        <div className="flex flex-wrap gap-2">
          {accounts.map((account) => (
            <button
              key={account.id}
              onClick={() => toggleAccount(account.id)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                selectedIds.includes(account.id)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
              }`}
            >
              @{account.username}
            </button>
          ))}
          {accounts.length === 0 && (
            <p className="text-sm text-gray-400">アカウントを先に追加してください</p>
          )}
        </div>
      </div>

      {/* テキストエリア */}
      <div className="flex-1 flex flex-col relative">
        {/* Template / Stock buttons */}
        {(templates.length > 0 || stocks.length > 0) && (
          <div className="flex gap-2 mb-1">
        {/* Template button */}
        {templates.length > 0 && (
          <div className="relative self-start">
            <button
              onClick={() => { setTemplatePanelOpen((v) => !v); setStockPanelOpen(false) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-600 hover:text-purple-800 text-xs font-medium rounded-lg border border-purple-200 transition-colors"
            >
              📝 テンプレート
              <span className="text-purple-400">({templates.length})</span>
            </button>

            {templatePanelOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-20 max-h-64 overflow-y-auto">
                <p className="px-3 py-2 text-[11px] text-gray-400 font-semibold border-b border-gray-100">
                  テンプレートを選択
                </p>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setContent(t.content)
                      setTemplatePanelOpen(false)
                    }}
                    className="w-full text-left px-3 py-2.5 hover:bg-purple-50 border-b border-gray-50 last:border-0 transition-colors"
                  >
                    <p className="text-xs font-semibold text-gray-700 mb-0.5">{t.title}</p>
                    <p className="text-xs text-gray-500 line-clamp-2">{t.content}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Stock button */}
        {stocks.length > 0 && (
          <div className="relative self-start">
            <button
              ref={stockBtnRef}
              onClick={() => { setStockPanelOpen((v) => !v); setTemplatePanelOpen(false) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800 text-xs font-medium rounded-lg border border-gray-200 transition-colors"
            >
              📋 ストックから選択
              <span className="text-gray-400">({stocks.length})</span>
            </button>

            {stockPanelOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-20 max-h-64 overflow-y-auto">
                <p className="px-3 py-2 text-[11px] text-gray-400 font-semibold border-b border-gray-100">
                  @{accounts.find((a) => a.id === primaryId)?.username ?? ''} のストック
                </p>
                {stocks.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setContent(s.content)
                      setStockPanelOpen(false)
                    }}
                    className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-b border-gray-50 last:border-0 transition-colors"
                  >
                    {s.title && (
                      <p className="text-xs font-semibold text-gray-700 mb-0.5">{s.title}</p>
                    )}
                    <p className="text-xs text-gray-600 line-clamp-2">{s.content}</p>
                    {s.image_url && (
                      <p className="text-[10px] text-blue-400 mt-0.5 truncate">🖼 {s.image_url}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
          </div>
        )}

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={maxChars}
          placeholder="スレッドを作成..."
          className="flex-1 p-4 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
          onClick={() => { setStockPanelOpen(false); setTemplatePanelOpen(false) }}
        />
        <div className="flex justify-between items-center mt-2">
          <span
            className={`text-xs ${charCount > maxChars * 0.9 ? 'text-orange-500' : 'text-gray-400'}`}
          >
            {charCount} / {maxChars}
          </span>
          <button
            onClick={handleSend}
            disabled={!content.trim() || selectedIds.length === 0 || sending}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? '投稿中...' : selectedIds.length > 1 ? `${selectedIds.length}アカウントに投稿` : '投稿'}
          </button>
        </div>
      </div>

      {/* 結果表示 */}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => {
            const account = accounts.find((a) => a.id === r.account_id)
            return (
              <div
                key={r.account_id}
                className={`p-3 rounded-lg text-sm ${
                  r.success
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700'
                }`}
              >
                <span className="font-medium">@{account?.username}</span>:{' '}
                {r.success ? '投稿完了' : `失敗 — ${r.error}`}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
