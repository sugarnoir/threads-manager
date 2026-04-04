import { useState, useCallback } from 'react'
import { Account } from '../lib/ipc'

interface Props {
  accounts: Account[]
  onCheckOne: (id: number) => Promise<{ status: string; message?: string }>
  onCheckAll: (
    onProgress: (data: {
      type: string
      accountId?: number
      status?: string
      message?: string
      index?: number
      total?: number
    }) => void
  ) => Promise<void>
}

type AccountStatus = Account['status']

interface CheckProgress {
  checking: boolean
  currentId: number | null
  done: number
  total: number
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AccountStatus, {
  label: string
  icon: string
  dot: string
  badge: string
  row: string
}> = {
  active: {
    label: '正常',
    icon: '✓',
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    row: '',
  },
  needs_login: {
    label: '要ログイン',
    icon: '⚠',
    dot: 'bg-amber-400',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    row: 'bg-amber-500/5',
  },
  frozen: {
    label: '凍結',
    icon: '🚫',
    dot: 'bg-red-500',
    badge: 'bg-red-500/15 text-red-400 border-red-500/30',
    row: 'bg-red-500/5',
  },
  error: {
    label: 'エラー',
    icon: '✕',
    dot: 'bg-red-400',
    badge: 'bg-red-500/10 text-red-400 border-red-500/20',
    row: 'bg-red-500/5',
  },
  inactive: {
    label: '未確認',
    icon: '–',
    dot: 'bg-zinc-600',
    badge: 'bg-zinc-700 text-zinc-400 border-zinc-600',
    row: '',
  },
  challenge: {
    label: '要確認',
    icon: '⚠',
    dot: 'bg-yellow-400',
    badge: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    row: 'bg-yellow-500/5',
  },
}

const GRADIENTS = [
  'from-violet-500 to-purple-600', 'from-blue-500 to-cyan-500',
  'from-pink-500 to-rose-500',     'from-amber-500 to-orange-500',
  'from-teal-500 to-emerald-500',  'from-indigo-500 to-blue-600',
]
function gradient(id: number) { return GRADIENTS[id % GRADIENTS.length] }
function initials(a: Account) { return (a.display_name?.[0] ?? a.username[0]).toUpperCase() }

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ status, count, total }: { status: AccountStatus; count: number; total: number }) {
  const cfg = STATUS_CONFIG[status]
  if (count === 0) return null
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${cfg.badge}`}>
      <span className="text-lg leading-none">{cfg.icon}</span>
      <div>
        <p className="text-xs font-semibold leading-tight">{cfg.label}</p>
        <p className="text-[11px] opacity-70 leading-tight">{count} / {total} アカウント</p>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function StatusCheck({ accounts, onCheckOne, onCheckAll }: Props) {
  const [progress, setProgress] = useState<CheckProgress>({
    checking: false, currentId: null, done: 0, total: 0,
  })
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set())
  const [messages, setMessages] = useState<Record<number, string>>({})

  // ── Counts ────────────────────────────────────────────────────────────────

  const counts = accounts.reduce<Record<AccountStatus, number>>(
    (acc, a) => { acc[a.status] = (acc[a.status] ?? 0) + 1; return acc },
    { active: 0, needs_login: 0, frozen: 0, error: 0, inactive: 0, challenge: 0 }
  )
  const problemCount = counts.needs_login + counts.frozen + counts.error + counts.challenge

  // ── Check all ─────────────────────────────────────────────────────────────

  const handleCheckAll = useCallback(async () => {
    if (progress.checking) return
    setMessages({})
    setProgress({ checking: true, currentId: null, done: 0, total: accounts.length })

    await onCheckAll((data) => {
      if (data.type === 'checking' && data.accountId) {
        setProgress((p) => ({ ...p, currentId: data.accountId ?? null }))
      }
      if (data.type === 'result') {
        setProgress((p) => ({ ...p, done: data.index ?? p.done, currentId: null }))
        if (data.accountId && data.message) {
          setMessages((m) => ({ ...m, [data.accountId!]: data.message! }))
        }
      }
      if (data.type === 'done') {
        setProgress({ checking: false, currentId: null, done: data.total ?? 0, total: data.total ?? 0 })
      }
    })
  }, [accounts.length, progress.checking, onCheckAll])

  // ── Check one ─────────────────────────────────────────────────────────────

  const handleCheckOne = async (id: number) => {
    setCheckingIds((s) => new Set(s).add(id))
    setMessages((m) => { const n = { ...m }; delete n[id]; return n })
    const result = await onCheckOne(id)
    if (result.message) setMessages((m) => ({ ...m, [id]: result.message! }))
    setCheckingIds((s) => { const n = new Set(s); n.delete(id); return n })
  }

  const isChecking = progress.checking
  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="space-y-4">

      {/* ── Header + check all ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white font-semibold text-sm">ステータス確認</p>
          <p className="text-zinc-500 text-xs mt-0.5">{accounts.length} アカウント</p>
        </div>
        <button
          onClick={handleCheckAll}
          disabled={isChecking || accounts.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          {isChecking ? (
            <>
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              確認中 {progress.done}/{progress.total}
            </>
          ) : (
            <>
              <span>🔍</span>
              全アカウント一括確認
            </>
          )}
        </button>
      </div>

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      {isChecking && (
        <div className="space-y-1">
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-zinc-500 text-[11px]">
            {progress.currentId
              ? `確認中: @${accounts.find(a => a.id === progress.currentId)?.username ?? '...'}`
              : `${progress.done} / ${progress.total} 完了`}
          </p>
        </div>
      )}

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <SummaryCard status="active"      count={counts.active}      total={accounts.length} />
          <SummaryCard status="needs_login" count={counts.needs_login} total={accounts.length} />
          <SummaryCard status="frozen"      count={counts.frozen}      total={accounts.length} />
          <SummaryCard status="error"       count={counts.error}       total={accounts.length} />
          <SummaryCard status="challenge"   count={counts.challenge}   total={accounts.length} />
          <SummaryCard status="inactive"    count={counts.inactive}    total={accounts.length} />
        </div>
      )}

      {/* ── Problem alert ────────────────────────────────────────────────── */}
      {!isChecking && problemCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
          <span className="text-sm">⚠️</span>
          <p className="text-red-400 text-xs font-medium">
            {problemCount} アカウントで問題が検出されました。Discord 通知済み。
          </p>
        </div>
      )}

      {/* ── Account list ─────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        {accounts.length === 0 ? (
          <p className="text-zinc-600 text-sm text-center py-8">アカウントがありません</p>
        ) : (
          accounts.map((account) => {
            const cfg = STATUS_CONFIG[account.status]
            const isOneChecking = checkingIds.has(account.id)
            const isThisChecking = isChecking && progress.currentId === account.id
            const spinning = isOneChecking || isThisChecking
            const msg = messages[account.id]

            return (
              <div
                key={account.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-800 transition-colors ${cfg.row}`}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient(account.id)} flex items-center justify-center text-white text-xs font-bold`}>
                    {initials(account)}
                  </div>
                  {/* Status dot */}
                  {spinning ? (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-zinc-900 flex items-center justify-center">
                      <span className="w-2 h-2 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                    </span>
                  ) : (
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-zinc-900 ${cfg.dot}`} />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white text-[13px] font-semibold truncate leading-tight">
                      {account.display_name ?? account.username}
                    </p>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold shrink-0 ${cfg.badge}`}>
                      {spinning ? '確認中...' : cfg.label}
                    </span>
                  </div>
                  <p className="text-zinc-500 text-[11px] truncate leading-tight">@{account.username}</p>
                  {msg && !spinning && (
                    <p className={`text-[11px] mt-0.5 truncate ${
                      account.status === 'active' ? 'text-zinc-600' : 'text-amber-500/80'
                    }`}>{msg}</p>
                  )}
                </div>

                {/* Re-check button */}
                <button
                  onClick={() => handleCheckOne(account.id)}
                  disabled={spinning || isChecking}
                  title="再確認"
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-700 disabled:opacity-30 transition-colors text-xs"
                >
                  ↻
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
