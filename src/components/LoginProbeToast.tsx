/**
 * LoginProbeToast — login-probe の進捗をトーストで表示
 *
 * api.loginProbe.onPhase / onDone を購読し、
 * 画面右下に複数トーストを並べて表示する。
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../lib/ipc'

interface ToastItem {
  accountId: number
  username: string
  phase: string
  done: boolean
  ok: boolean
  /** 自動消去タイマー ID */
  timerId?: ReturnType<typeof setTimeout>
}

const PHASE_LABEL: Record<string, string> = {
  idle: '待機中',
  navigating: 'ページロード中...',
  entering_credentials: 'ID/PW入力中...',
  awaiting_2fa: '2FA待ち...',
  entering_2fa: '2FA入力中...',
  challenge_detected: '手動対応が必要',
  logged_in: 'ログイン成功',
  failed: '失敗',
}

const AUTO_DISMISS_MS = 5000

export function LoginProbeToast() {
  const [toasts, setToasts] = useState<Map<number, ToastItem>>(new Map())
  const toastsRef = useRef(toasts)
  toastsRef.current = toasts

  const dismiss = useCallback((accountId: number) => {
    setToasts(prev => {
      const next = new Map(prev)
      const item = next.get(accountId)
      if (item?.timerId) clearTimeout(item.timerId)
      next.delete(accountId)
      return next
    })
  }, [])

  useEffect(() => {
    const unsubPhase = api.loginProbe.onPhase((payload) => {
      const { accountId, phase } = payload as { accountId: number; phase: string }
      setToasts(prev => {
        const next = new Map(prev)
        const existing = next.get(accountId)
        next.set(accountId, {
          accountId,
          username: existing?.username ?? `#${accountId}`,
          phase,
          done: false,
          ok: false,
          timerId: existing?.timerId,
        })
        return next
      })
    })

    const unsubDone = api.loginProbe.onDone((payload) => {
      const { accountId, ok, phase } = payload as { accountId: number; ok: boolean; phase: string }
      setToasts(prev => {
        const next = new Map(prev)
        const existing = next.get(accountId)
        // 既存タイマーをクリア
        if (existing?.timerId) clearTimeout(existing.timerId)
        const timerId = setTimeout(() => dismiss(accountId), AUTO_DISMISS_MS)
        next.set(accountId, {
          accountId,
          username: existing?.username ?? `#${accountId}`,
          phase,
          done: true,
          ok,
          timerId,
        })
        return next
      })
    })

    return () => { unsubPhase(); unsubDone() }
  }, [dismiss])

  /** 外部から username を登録する用（QuickAddModal / Sidebar から呼ぶ） */
  // window イベント経由で username を受け取る
  useEffect(() => {
    const handler = (e: Event) => {
      const { accountId, username } = (e as CustomEvent).detail as { accountId: number; username: string }
      setToasts(prev => {
        const next = new Map(prev)
        const existing = next.get(accountId)
        if (existing) {
          next.set(accountId, { ...existing, username })
        } else {
          next.set(accountId, { accountId, username, phase: 'idle', done: false, ok: false })
        }
        return next
      })
    }
    window.addEventListener('login-probe:register', handler)
    return () => window.removeEventListener('login-probe:register', handler)
  }, [])

  const items = [...toasts.values()]
  if (items.length === 0) return null

  // Bulk progress summary
  const total = items.length
  const doneCount = items.filter(t => t.done).length
  const successCount = items.filter(t => t.done && t.ok).length
  const failCount = items.filter(t => t.done && !t.ok).length
  const showSummary = total > 1

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 max-w-xs">
      {showSummary && (
        <div className={`px-4 py-2 rounded-lg shadow-lg border text-xs font-semibold ${
          doneCount === total
            ? failCount === 0
              ? 'bg-emerald-900/90 border-emerald-700 text-emerald-200'
              : 'bg-amber-900/90 border-amber-700 text-amber-200'
            : 'bg-zinc-800/95 border-zinc-700 text-zinc-200'
        }`}>
          {doneCount < total
            ? `ログイン中 (${doneCount}/${total})...`
            : `${successCount}/${total} 成功${failCount > 0 ? ` ${failCount}件失敗` : ''}`
          }
        </div>
      )}
      {items.map((t) => (
        <div
          key={t.accountId}
          className={`px-4 py-3 rounded-lg shadow-lg border text-sm transition-all ${
            t.done
              ? t.ok
                ? 'bg-emerald-900/90 border-emerald-700 text-emerald-200'
                : t.phase === 'challenge_detected'
                  ? 'bg-amber-900/90 border-amber-700 text-amber-200'
                  : 'bg-red-900/90 border-red-700 text-red-200'
              : 'bg-zinc-800/95 border-zinc-700 text-zinc-200'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs truncate">{t.username}</span>
            <button
              onClick={() => dismiss(t.accountId)}
              className="text-zinc-500 hover:text-zinc-300 text-xs shrink-0"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {!t.done && (
              <span className="w-3 h-3 border-2 border-zinc-500 border-t-blue-400 rounded-full animate-spin shrink-0" />
            )}
            {t.done && t.ok && <span className="text-emerald-400 shrink-0">✓</span>}
            {t.done && !t.ok && <span className="text-red-400 shrink-0">✕</span>}
            <span className="text-xs">{PHASE_LABEL[t.phase] ?? t.phase}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** トーストに username を登録するヘルパー */
export function registerLoginProbeToast(accountId: number, username: string): void {
  window.dispatchEvent(new CustomEvent('login-probe:register', {
    detail: { accountId, username },
  }))
}
