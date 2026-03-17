import { useState, useEffect, useRef } from 'react'
import { api, Account, EngagementRecord, EngagementItemResult } from '../lib/ipc'

interface Props {
  accounts: Account[]
}

type Action = 'like' | 'repost'

type ItemProgress = {
  account_id: number
  status: 'waiting' | 'running' | 'done' | 'failed' | 'already_done'
  error?: string
}

const statusConfig = {
  waiting:      { label: '待機中',     cls: 'bg-gray-100 text-gray-500' },
  running:      { label: '実行中...',  cls: 'bg-blue-100 text-blue-600 animate-pulse' },
  done:         { label: '完了',       cls: 'bg-green-100 text-green-700' },
  already_done: { label: '実行済み',   cls: 'bg-yellow-100 text-yellow-700' },
  failed:       { label: '失敗',       cls: 'bg-red-100 text-red-700' },
}

function isValidThreadsUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname.includes('threads.net') && u.pathname.includes('/post/')
  } catch {
    return false
  }
}

export function Engagement({ accounts }: Props) {
  const [postUrl, setPostUrl]         = useState('')
  const [action, setAction]           = useState<Action>('like')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [running, setRunning]         = useState(false)
  const [progress, setProgress]       = useState<ItemProgress[]>([])
  const [history, setHistory]         = useState<EngagementRecord[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  // リアルタイム進捗を受け取る
  useEffect(() => {
    const unsub = api.on(
      'engagement:progress',
      (data: unknown) => {
        const d = data as { account_id: number; status: string; error?: string }
        setProgress((prev) =>
          prev.map((p) =>
            p.account_id === d.account_id
              ? { ...p, status: d.status as ItemProgress['status'], error: d.error }
              : p
          )
        )
      }
    )
    unsubRef.current = unsub
    return () => unsub()
  }, [])

  const toggleAccount = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const selectAll = () => setSelectedIds(accounts.map((a) => a.id))
  const clearAll  = () => setSelectedIds([])

  const handleRun = async () => {
    if (!postUrl || selectedIds.length === 0) return

    // 進捗初期化
    const initial: ItemProgress[] = selectedIds.map((id) => ({
      account_id: id,
      status: 'waiting',
    }))
    setProgress(initial)
    setRunning(true)

    // 実行中にステータスを running に
    setProgress((prev) => prev.map((p) => ({ ...p, status: 'running' })))

    let results: EngagementItemResult[]
    if (action === 'like') {
      results = await api.engagements.like({ account_ids: selectedIds, post_url: postUrl })
    } else {
      results = await api.engagements.repost({ account_ids: selectedIds, post_url: postUrl })
    }

    // 最終ステータスで上書き (progress イベントで既に更新されている場合もあるが念のため)
    setProgress(
      results.map((r) => ({
        account_id: r.account_id,
        status: r.status,
        error: r.error,
      }))
    )
    setRunning(false)
  }

  const loadHistory = async () => {
    const data = await api.engagements.history()
    setHistory(data)
    setShowHistory(true)
  }

  const activeAccounts = accounts.filter((a) => a.status === 'active')
  const urlValid = isValidThreadsUrl(postUrl)

  const doneCount     = progress.filter((p) => p.status === 'done').length
  const alreadyCount  = progress.filter((p) => p.status === 'already_done').length
  const failedCount   = progress.filter((p) => p.status === 'failed').length

  return (
    <div className="h-full flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">一括いいね / リポスト</h2>
        <button
          onClick={loadHistory}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          履歴を見る
        </button>
      </div>

      {/* URL 入力 */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">
          投稿 URL
        </label>
        <input
          type="url"
          value={postUrl}
          onChange={(e) => setPostUrl(e.target.value)}
          placeholder="https://www.threads.net/@username/post/xxxxxxxx"
          className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${
            postUrl && !urlValid
              ? 'border-red-300 bg-red-50'
              : 'border-gray-200'
          }`}
        />
        {postUrl && !urlValid && (
          <p className="text-xs text-red-500 mt-1">
            Threads の投稿 URL を入力してください（例: https://www.threads.net/@user/post/xxxxx）
          </p>
        )}
      </div>

      {/* アクション選択 */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-2">アクション</label>
        <div className="flex gap-3">
          {(['like', 'repost'] as Action[]).map((a) => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
                action === a
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
              }`}
            >
              <span>{a === 'like' ? '❤️' : '🔁'}</span>
              {a === 'like' ? 'いいね' : 'リポスト'}
            </button>
          ))}
        </div>
      </div>

      {/* アカウント選択 */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">
            実行するアカウント{' '}
            <span className="text-gray-400 font-normal">
              ({selectedIds.length}/{activeAccounts.length} 選択)
            </span>
          </label>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              全選択
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={clearAll}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              解除
            </button>
          </div>
        </div>

        {activeAccounts.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">
            アクティブなアカウントがありません
          </p>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {activeAccounts.map((account) => {
              const prog = progress.find((p) => p.account_id === account.id)
              const isSelected = selectedIds.includes(account.id)

              return (
                <div
                  key={account.id}
                  onClick={() => !running && toggleAccount(account.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-all ${
                    running
                      ? 'cursor-default'
                      : 'cursor-pointer'
                  } ${
                    isSelected
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-transparent bg-white hover:bg-gray-50'
                  }`}
                >
                  {/* チェックボックス */}
                  <div
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                      isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                    }`}
                  >
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                        <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>

                  {/* アバター */}
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {account.display_name?.[0] ?? account.username[0].toUpperCase()}
                  </div>

                  {/* ユーザー名 */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {account.display_name ?? account.username}
                    </p>
                    <p className="text-xs text-gray-400 truncate">@{account.username}</p>
                  </div>

                  {/* 進捗バッジ */}
                  {prog && (
                    <div className="shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig[prog.status].cls}`}>
                        {statusConfig[prog.status].label}
                      </span>
                      {prog.error && (
                        <p className="text-xs text-red-400 mt-0.5 max-w-[140px] truncate" title={prog.error}>
                          {prog.error}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 実行ボタン + 集計 */}
      <div className="space-y-2 pt-1">
        {progress.length > 0 && !running && (
          <div className="flex gap-4 text-sm">
            <span className="text-green-600">✓ 完了 {doneCount}</span>
            {alreadyCount > 0 && (
              <span className="text-yellow-600">⏭ 実行済み {alreadyCount}</span>
            )}
            {failedCount > 0 && (
              <span className="text-red-600">✗ 失敗 {failedCount}</span>
            )}
          </div>
        )}
        <button
          onClick={handleRun}
          disabled={running || !urlValid || selectedIds.length === 0}
          className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {running
            ? `実行中... (${progress.filter((p) => p.status === 'running').length} アカウント処理中)`
            : `${selectedIds.length} アカウントで${action === 'like' ? 'いいね' : 'リポスト'}する`}
        </button>
      </div>

      {/* 履歴モーダル */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50">
          <div className="bg-white rounded-t-2xl w-full max-w-2xl max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">エンゲージメント履歴</h3>
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {history.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">履歴がありません</p>
              ) : (
                history.map((h) => {
                  const account = accounts.find((a) => a.id === h.account_id)
                  return (
                    <div key={h.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl text-sm">
                      <span className="text-lg shrink-0">{h.action === 'like' ? '❤️' : '🔁'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-700">
                          @{account?.username ?? `ID:${h.account_id}`}
                        </p>
                        <p className="text-xs text-gray-400 truncate">{h.post_url}</p>
                        {h.error_msg && (
                          <p className="text-xs text-red-400">{h.error_msg}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          h.status === 'done'
                            ? 'bg-green-100 text-green-700'
                            : h.status === 'already_done'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {h.status === 'done' ? '完了' : h.status === 'already_done' ? '実行済み' : '失敗'}
                        </span>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(h.created_at).toLocaleString('ja-JP')}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
