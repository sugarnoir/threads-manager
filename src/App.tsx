import { useState, useEffect } from 'react'
import { Sidebar, ToolType } from './components/Sidebar'
import { ToolPanel } from './components/ToolPanel'
import { BrowserPage } from './pages/BrowserPage'
import { AddAccountModal } from './components/AddAccountModal'
import { AccountEditModal } from './components/AccountEditModal'
import { SetupWizardOverlay } from './components/SetupWizardOverlay'
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
  const { accounts, loading, refresh, addAccount, registerAccount, deleteAccount, checkStatus, checkAllAccounts, updateProxy, updateDisplayName, updateGroup, updateMemo, updateSpeedPreset, clearCookies, resetSession, reorderAccounts } =
    useAccounts()

  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)
  const [activeTool, setActiveTool]           = useState<ToolType | null>(null)
  const [showAddModal, setShowAddModal]       = useState(false)
  const [adding, setAdding]                   = useState(false)
  const [editTarget, setEditTarget]           = useState<Account | null>(null)
  // 「既存IGから作成」ウィザード: アクティブ時にプロキシを保持。null は「ウィザード非表示」
  const [setupWizard, setSetupWizard]         = useState<
    { proxy: { proxy_url: string; proxy_username: string; proxy_password: string } | null } | null
  >(null)

  const [authState, setAuthState] = useState<AuthState>('loading')
  const [licenseMaxAccounts, setLicenseMaxAccounts] = useState<number | null>(null)

  // ── 強制アップデート ────────────────────────────────────────────────────
  const [updateStatus, setUpdateStatus] = useState<{
    type: 'downloading' | 'installing' | 'error'
    version?: string
    percent?: number
    message?: string
  } | null>(null)

  useEffect(() => {
    const unsub = api.on('updater:status', (data) => {
      const d = data as { type: string; version?: string; percent?: number; message?: string }
      if (d.type === 'error') {
        // エラー時はローディングを解除
        setUpdateStatus(null)
      } else {
        setUpdateStatus(d as typeof updateStatus)
      }
    })
    return unsub
  }, [])

  // Check auth on mount
  useEffect(() => {
    api.auth.check().then((result: { required: boolean; authenticated: boolean; maxAccounts?: number | null }) => {
      if (!result.required || result.authenticated) {
        setAuthState('ok')
        if (result.maxAccounts != null) setLicenseMaxAccounts(result.maxAccounts)
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
    proxy: { proxy_url: string; proxy_username: string; proxy_password: string } | null,
    mode: 'login' | 'register' | 'setup'
  ) => {
    setShowAddModal(false)

    // 「既存Instagramから作成」: ウィザードオーバーレイへ
    if (mode === 'setup') {
      setSetupWizard({ proxy })
      return
    }

    setAdding(true)
    const result = mode === 'register'
      ? await registerAccount(proxy ?? undefined)
      : await addAccount(proxy ?? undefined)
    setAdding(false)
    if (!result.success) {
      alert(`${mode === 'register' ? '登録' : '追加'}失敗: ${result.error}`)
    } else if (result.account) {
      setActiveAccountId(result.account.id)
    }
  }

  // モーダルが開いている間は WebContentsView を非表示
  // ※ setup ウィザードは Step 2/3 でブラウザ操作が必要なのでブラウザビューは表示する
  const browserVisible = activeTool === null && editTarget === null && !showAddModal

  // 強制アップデート画面（ダウンロード中 or インストール中）
  if (updateStatus) {
    return (
      <div className="flex h-screen bg-slate-950 flex-col items-center justify-center gap-6">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto border-4 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
          <h2 className="text-white text-lg font-bold">
            {updateStatus.type === 'installing' ? 'インストール中...' : 'アップデート中...'}
          </h2>
          {updateStatus.version && (
            <p className="text-zinc-400 text-sm">バージョン {updateStatus.version}</p>
          )}
          {updateStatus.type === 'downloading' && updateStatus.percent != null && (
            <>
              <div className="w-64 h-2 bg-zinc-800 rounded-full overflow-hidden mx-auto">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${updateStatus.percent}%` }}
                />
              </div>
              <p className="text-zinc-500 text-xs">{updateStatus.percent}%</p>
            </>
          )}
          {updateStatus.type === 'installing' && (
            <p className="text-zinc-500 text-xs">まもなく再起動します...</p>
          )}
        </div>
      </div>
    )
  }

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
        maxAccounts={licenseMaxAccounts}
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
            onAccountAdded={refresh}
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
          onResetSession={() => resetSession(editTarget.id)}
          onDelete={() => handleDeleteAccount(editTarget.id)}
          onOpenBrowser={() => { setActiveAccountId(editTarget.id); setActiveTool(null); setEditTarget(null) }}
          onClose={() => setEditTarget(null)}
          onUseStock={(content, images, topic) => {
            const accountId = editTarget.id
            console.log('[App] onUseStock accountId=', accountId, 'content=', content.slice(0, 30), 'images=', images?.length ?? 0, 'topic=', topic)
            setEditTarget(null)
            setActiveAccountId(accountId)
            setActiveTool(null)
            api.browserView.openCompose(accountId, content, images, topic ?? undefined)
              .then((res) => { if (!res.success) alert(`投稿画面を開けませんでした: ${res.error}`) })
              .catch((err) => alert(`エラー: ${err}`))
          }}
        />
      )}

      {/* 既存IGから作成 ウィザード */}
      {setupWizard && (
        <SetupWizardOverlay
          proxy={setupWizard.proxy}
          onAccountReady={async (newAccountId) => {
            // ブラウザビューを表示するため activeAccountId を設定（サイドバーにも即時反映）
            await refresh()
            setActiveAccountId(newAccountId)
            setActiveTool(null)
          }}
          onComplete={async (newAccountId) => {
            await refresh()
            setActiveAccountId(newAccountId)
            setSetupWizard(null)
          }}
          onCancel={async () => {
            // ウィザードを閉じてもアカウントは保持。サイドバー反映のため refresh
            await refresh()
            setSetupWizard(null)
          }}
        />
      )}
    </div>
  )
}
