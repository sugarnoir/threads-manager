import { useState, useEffect } from 'react'
import { Sidebar, ToolType } from './components/Sidebar'
import { ToolPanel } from './components/ToolPanel'
import { BrowserPage } from './pages/BrowserPage'
import { AddAccountModal } from './components/AddAccountModal'
import { AccountEditModal } from './components/AccountEditModal'
import { useAccounts } from './hooks/useAccounts'
import { Account, api } from './lib/ipc'

// ── License Key Auth screen ───────────────────────────────────────────────────

type AuthState = 'loading' | 'ok' | 'required'

function LicenseKeyScreen({ onLogin }: { onLogin: () => void }) {
  const [key,    setKey]    = useState('')
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error'>('idle')
  const [error,  setError]  = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!key.trim()) return
    setStatus('verifying')
    setError(null)
    const result = await api.auth.verify(key.trim())
    if (result.ok) {
      onLogin()
    } else {
      setStatus('error')
      setError(result.error ?? '認証に失敗しました')
    }
  }

  return (
    <div className="flex h-screen bg-slate-950 items-center justify-center">
      <div className="w-full max-w-sm mx-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-pink-500 via-fuchsia-500 to-violet-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg">
            <span className="text-white font-black text-3xl leading-none">T</span>
          </div>

          <h1 className="text-white text-xl font-bold mb-1">Threads Manager</h1>
          <p className="text-zinc-400 text-sm mb-6">
            ライセンスキーを入力してください
          </p>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="ライセンスキーを入力..."
              disabled={status === 'verifying'}
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 rounded-xl text-white text-sm placeholder-zinc-600 outline-none transition-all font-mono disabled:opacity-50"
              autoFocus
            />
            <button
              type="submit"
              disabled={status === 'verifying' || !key.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
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
          </form>
        </div>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const { accounts, loading, addAccount, deleteAccount, checkStatus, checkAllAccounts, updateProxy, updateDisplayName, updateGroup, updateMemo, updateSpeedPreset, clearCookies, reorderAccounts } =
    useAccounts()

  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)
  const [activeTool, setActiveTool]           = useState<ToolType | null>(null)
  const [showAddModal, setShowAddModal]       = useState(false)
  const [adding, setAdding]                   = useState(false)
  const [editTarget, setEditTarget]           = useState<Account | null>(null)

  const [authState, setAuthState] = useState<AuthState>('loading')

  // Check auth on mount
  useEffect(() => {
    api.auth.check().then((result) => {
      if (!result.required || result.authenticated) {
        setAuthState('ok')
      } else {
        setAuthState('required')
      }
    }).catch(() => setAuthState('required'))
  }, [])

  // Auto-select first account on initial load
  useEffect(() => {
    if (!loading && accounts.length > 0 && activeAccountId === null) {
      setActiveAccountId(accounts[0].id)
    }
  }, [loading, accounts, activeAccountId])

  // When an account is deleted, clear it if it was active
  const handleDeleteAccount = async (id: number) => {
    await deleteAccount(id)
    if (activeAccountId === id) setActiveAccountId(null)
    if (editTarget?.id === id) setEditTarget(null)
  }

  const handleAddConfirm = async (
    proxy: { proxy_url: string; proxy_username: string; proxy_password: string } | null
  ) => {
    setShowAddModal(false)
    setAdding(true)
    const result = await addAccount(proxy ?? undefined)
    setAdding(false)
    if (!result.success) {
      alert(`追加失敗: ${result.error}`)
    } else if (result.account) {
      setActiveAccountId(result.account.id)
    }
  }

  // モーダルが開いている間は WebContentsView を非表示
  const browserVisible = activeTool === null && editTarget === null && !showAddModal

  if (authState === 'loading' || loading) {
    return (
      <div className="flex h-screen bg-slate-950 items-center justify-center text-slate-400">
        読み込み中...
      </div>
    )
  }

  if (authState === 'required') {
    return <LicenseKeyScreen onLogin={() => setAuthState('ok')} />
  }

  return (
    <div className="flex h-screen bg-slate-900 font-sans overflow-hidden">
      <Sidebar
        accounts={accounts}
        activeAccountId={activeAccountId}
        activeTool={activeTool}
        adding={adding}
        onOpenAccount={(id) => { setActiveAccountId(id); setActiveTool(null) }}
        onEditAccount={setEditTarget}
        onAddAccount={() => setShowAddModal(true)}
        onDeleteAccount={handleDeleteAccount}
        onCheckStatus={checkStatus}
        onUpdateGroup={updateGroup}
        onReorderAccounts={reorderAccounts}
        onOpenTool={setActiveTool}
      />

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <BrowserPage
          accounts={accounts}
          activeAccountId={activeAccountId}
          isVisible={browserVisible}
        />

        {activeTool && (
          <ToolPanel
            tool={activeTool}
            accounts={accounts}
            selectedAccountId={activeAccountId}
            onClose={() => setActiveTool(null)}
            onCheckOne={checkStatus}
            onCheckAll={checkAllAccounts}
          />
        )}
      </div>

      {showAddModal && (
        <AddAccountModal
          onConfirm={handleAddConfirm}
          onCancel={() => setShowAddModal(false)}
        />
      )}
      {editTarget && (
        <AccountEditModal
          account={editTarget}
          onSaveDisplayName={(display_name) => updateDisplayName(editTarget.id, display_name)}
          onSaveProxy={(data) => updateProxy({ id: editTarget.id, ...data })}
          onSaveMemo={(memo) => updateMemo(editTarget.id, memo)}
          onSaveSpeedPreset={(preset) => updateSpeedPreset(editTarget.id, preset)}
          onClearCookies={() => clearCookies(editTarget.id)}
          onDelete={() => handleDeleteAccount(editTarget.id)}
          onOpenBrowser={() => { setActiveAccountId(editTarget.id); setEditTarget(null) }}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  )
}
