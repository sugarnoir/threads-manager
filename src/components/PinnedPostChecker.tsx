import { useState, useEffect } from 'react'
import { api, Account } from '../lib/ipc'

interface Props {
  accounts: Account[]
  onComplete?: () => void
}

type CheckResult = { total: number; alive: number; deleted: number; unknown: number; no_pin: number } | null

export function PinnedPostChecker({ accounts, onComplete }: Props) {
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState({ completed: 0, total: 0, message: '' })
  const [result, setResult] = useState<CheckResult>(null)
  const [showResult, setShowResult] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<string>('')

  // グループ一覧を抽出
  const groups = [...new Set(accounts.filter(a => a.group_name).map(a => a.group_name!))].sort()

  useEffect(() => {
    if (!checking) return
    const unsub = api.pinned.onProgress((data) => {
      setProgress(data)
    })
    return unsub
  }, [checking])

  const handleCheckAll = async () => {
    setChecking(true)
    setResult(null)
    const target = selectedGroup
      ? accounts.filter(a => a.status === 'active' && a.group_name === selectedGroup)
      : accounts.filter(a => a.status === 'active')
    setProgress({ completed: 0, total: target.length, message: '開始中...' })

    try {
      const res = await api.pinned.checkAll(selectedGroup || null)
      setResult(res)
      setShowResult(true)
      onComplete?.()
    } catch (err) {
      setResult(null)
      alert(`エラー: ${err instanceof Error ? err.message : err}`)
    } finally {
      setChecking(false)
    }
  }

  const deletedAccounts = accounts.filter(a => a.pinned_post_status === 'deleted')

  return (
    <>
      {/* グループ選択 + チェック開始ボタン */}
      <div className="flex items-center gap-1.5">
        <select
          value={selectedGroup}
          onChange={e => setSelectedGroup(e.target.value)}
          disabled={checking}
          className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
        >
          <option value="">全グループ</option>
          {groups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <button
          onClick={handleCheckAll}
          disabled={checking}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-xs rounded-lg border border-zinc-700 transition-colors"
        >
          {checking ? (
            <>
              <span className="w-3 h-3 border-2 border-zinc-400/30 border-t-zinc-400 rounded-full animate-spin" />
              チェック中...
            </>
          ) : (
            <>📌 ピン投稿チェック</>
        )}
      </button>
      </div>

      {/* 進捗モーダル */}
      {checking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-[360px] shadow-2xl">
            <h3 className="text-white font-bold text-sm mb-3">ピン投稿チェック中</h3>
            <div className="space-y-3">
              <div className="w-full bg-zinc-800 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: progress.total > 0 ? `${(progress.completed / progress.total) * 100}%` : '0%' }}
                />
              </div>
              <p className="text-zinc-400 text-xs">{progress.message}</p>
              <p className="text-zinc-500 text-[10px] font-mono">{progress.completed} / {progress.total}</p>
            </div>
          </div>
        </div>
      )}

      {/* 結果モーダル */}
      {showResult && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowResult(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-[380px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-bold text-sm mb-4">ピン投稿チェック結果</h3>

            <div className="space-y-2 mb-4">
              <ResultRow icon="✅" label="生存" count={result.alive} color="text-emerald-400" />
              <ResultRow icon="❌" label="削除" count={result.deleted} color="text-red-400" />
              <ResultRow icon="❓" label="不明" count={result.unknown} color="text-amber-400" />
              <ResultRow icon="📌" label="ピン無し" count={result.no_pin} color="text-zinc-500" />
              <div className="border-t border-zinc-800 pt-2">
                <ResultRow icon="📊" label="合計" count={result.total} color="text-white" />
              </div>
            </div>

            {result.deleted > 0 && (
              <div className="bg-red-900/20 border border-red-800/40 rounded-lg p-3 mb-4">
                <p className="text-red-400 text-xs font-semibold mb-1">削除された垢:</p>
                <div className="space-y-0.5">
                  {deletedAccounts.map(a => (
                    <p key={a.id} className="text-red-300 text-[11px] font-mono">@{a.username}</p>
                  ))}
                </div>
              </div>
            )}

            {result.no_pin > 0 && (
              <details className="mb-4">
                <summary className="text-zinc-400 text-xs cursor-pointer hover:text-zinc-300">
                  ピン無し垢を表示 ({result.no_pin}垢)
                </summary>
                <div className="mt-2 bg-zinc-800/40 border border-zinc-700/40 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <div className="space-y-0.5">
                    {accounts
                      .filter(a => a.status === 'active' && !a.pinned_post_url && a.pinned_checked_at)
                      .map(a => (
                        <p key={a.id} className="text-zinc-400 text-[11px] font-mono">@{a.username}</p>
                      ))}
                  </div>
                </div>
              </details>
            )}

            <button
              onClick={() => setShowResult(false)}
              className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function ResultRow({ icon, label, count, color }: { icon: string; label: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/50 rounded-lg">
      <span className="text-zinc-300 text-xs">{icon} {label}</span>
      <span className={`text-sm font-bold ${color}`}>{count}</span>
    </div>
  )
}

/** アカウントカード用のピンステータスバッジ */
export function PinnedBadge({ account }: { account: Account }) {
  if (!account.pinned_post_status) return null
  if (account.pinned_post_status === 'deleted') {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-red-900/40 text-red-400 text-[9px] font-semibold rounded"
        title={`ピン削除検出 (${account.pinned_checked_at ?? ''})`}
      >
        📌❌
      </span>
    )
  }
  if (account.pinned_post_status === 'alive') {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1 py-0.5 text-emerald-500/60 text-[9px] rounded"
        title={`ピン生存確認 (${account.pinned_checked_at ?? ''})`}
      >
        📌
      </span>
    )
  }
  return null
}
