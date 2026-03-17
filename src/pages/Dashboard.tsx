import { useState } from 'react'
import { useAccounts } from '../hooks/useAccounts'
import { useContexts } from '../hooks/useContexts'
import { AccountCard } from '../components/AccountCard'
import { AddAccountModal } from '../components/AddAccountModal'
import { ProxyEditPanel } from '../components/ProxyEditPanel'
import { Account } from '../lib/ipc'

interface Props {
  selectedAccountId: number | null
  onSelectAccount: (id: number) => void
}

export function Dashboard({ selectedAccountId, onSelectAccount }: Props) {
  const { accounts, loading, addAccount, deleteAccount, checkStatus, updateProxy } = useAccounts()
  const { getInfo, openBrowser, closeBrowser } = useContexts()
  const [showAddModal, setShowAddModal] = useState(false)
  const [adding, setAdding] = useState(false)
  const [proxyTarget, setProxyTarget] = useState<Account | null>(null)

  const handleAddConfirm = async (
    proxy: { proxy_url: string; proxy_username: string; proxy_password: string } | null
  ) => {
    setShowAddModal(false)
    setAdding(true)
    const result = await addAccount(proxy ? {
      proxy_url: proxy.proxy_url,
      proxy_username: proxy.proxy_username,
      proxy_password: proxy.proxy_password,
    } : undefined)
    setAdding(false)
    if (!result.success) alert(`追加失敗: ${result.error}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        読み込み中...
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-800">アカウント</h2>
          {accounts.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {accounts.length} 件 — ブラウザ起動中:{' '}
              <span className="text-blue-500 font-medium">
                {accounts.filter((a) => getInfo(a.id)).length}
              </span>
            </p>
          )}
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          disabled={adding}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {adding ? 'ログイン待機中...' : '+ 追加'}
        </button>
      </div>

      {/* アカウント一覧 */}
      {accounts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400 gap-3">
          <div className="text-4xl">👤</div>
          <p className="text-sm">アカウントがありません</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="text-blue-600 text-sm hover:underline"
          >
            最初のアカウントを追加する
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              contextInfo={getInfo(account.id)}
              selected={selectedAccountId === account.id}
              onSelect={() => onSelectAccount(account.id)}
              onDelete={() => deleteAccount(account.id)}
              onCheck={() => checkStatus(account.id)}
              onEditProxy={() => setProxyTarget(account)}
              onOpenBrowser={() => openBrowser(account.id)}
              onCloseBrowser={() => closeBrowser(account.id)}
            />
          ))}
        </div>
      )}

      {/* アカウント追加モーダル */}
      {showAddModal && (
        <AddAccountModal
          onConfirm={handleAddConfirm}
          onCancel={() => setShowAddModal(false)}
        />
      )}

      {/* プロキシ編集パネル */}
      {proxyTarget && (
        <ProxyEditPanel
          account={proxyTarget}
          onSave={(data) => updateProxy({ id: proxyTarget.id, ...data })}
          onClose={() => setProxyTarget(null)}
        />
      )}
    </div>
  )
}
