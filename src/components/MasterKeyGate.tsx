import { useState } from 'react'
import { api } from '../lib/ipc'

interface Props {
  onAuth: () => void
  onCancel?: () => void
}

export function MasterKeyGate({ onAuth, onCancel }: Props) {
  const [key,    setKey]    = useState('')
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error'>('idle')
  const [error,  setError]  = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!key.trim()) return
    setStatus('verifying')
    setError(null)
    const result = await api.masterKey.verify(key.trim())
    if (result.ok) {
      onAuth()
    } else {
      setStatus('error')
      setError(result.error ?? '認証に失敗しました')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-80 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        <h2 className="text-white text-base font-bold mb-1">認証が必要です</h2>
        <p className="text-zinc-400 text-sm mb-5">
          マスターキーを入力してください
        </p>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(null); setStatus('idle') }}
            placeholder="マスターキーを入力..."
            disabled={status === 'verifying'}
            autoComplete="off"
            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 rounded-xl text-white text-sm placeholder-zinc-600 outline-none transition-all font-mono disabled:opacity-50"
            autoFocus
          />
          <div className="flex gap-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-sm transition-colors"
              >
                キャンセル
              </button>
            )}
            <button
              type="submit"
              disabled={status === 'verifying' || !key.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
            >
              {status === 'verifying' ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  確認中...
                </>
              ) : (
                '認証する'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
