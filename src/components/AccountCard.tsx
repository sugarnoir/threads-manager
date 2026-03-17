import { Account, ContextInfo } from '../lib/ipc'

interface Props {
  account: Account
  contextInfo: ContextInfo | undefined
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onCheck: () => void
  onEditProxy: () => void
  onOpenBrowser: () => void
  onCloseBrowser: () => void
}

const loginStatusColors: Record<Account['status'], string> = {
  active:      'bg-green-400',
  inactive:    'bg-gray-400',
  needs_login: 'bg-amber-400',
  frozen:      'bg-red-500',
  error:       'bg-red-400',
}
const loginStatusLabels: Record<Account['status'], string> = {
  active:      'ログイン中',
  inactive:    '未確認',
  needs_login: '要ログイン',
  frozen:      '凍結',
  error:       'エラー',
}

function proxyLabel(account: Account): string | null {
  if (!account.proxy_url) return null
  try {
    const url = new URL(account.proxy_url)
    return `${url.protocol.replace(':', '').toUpperCase()} ${url.hostname}:${url.port}`
  } catch {
    return account.proxy_url
  }
}

export function AccountCard({
  account,
  contextInfo,
  selected,
  onSelect,
  onDelete,
  onCheck,
  onEditProxy,
  onOpenBrowser,
  onCloseBrowser,
}: Props) {
  const proxy = proxyLabel(account)
  const isOpen = !!contextInfo
  const isBusy = contextInfo?.state === 'busy'

  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded-xl cursor-pointer border-2 transition-all ${
        selected
          ? 'border-blue-500 bg-blue-50'
          : 'border-transparent bg-white hover:bg-gray-50'
      }`}
    >
      {/* ヘッダー行 */}
      <div className="flex items-center gap-3">
        {/* アバター */}
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
            {account.display_name?.[0] ?? account.username[0].toUpperCase()}
          </div>
          {/* コンテキスト状態インジケータ */}
          {isOpen && (
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                isBusy ? 'bg-orange-400 animate-pulse' : 'bg-blue-500'
              }`}
              title={isBusy ? '実行中' : 'ブラウザ起動中'}
            />
          )}
        </div>

        {/* ユーザー情報 */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-900 truncate">
            {account.display_name ?? account.username}
          </p>
          <p className="text-xs text-gray-500 truncate">@{account.username}</p>
          {proxy && (
            <p className="text-xs text-blue-500 truncate mt-0.5">プロキシ: {proxy}</p>
          )}
        </div>

        {/* ログインステータス */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${loginStatusColors[account.status]}`} />
            <span className="text-xs text-gray-500">{loginStatusLabels[account.status]}</span>
          </div>
          {/* ブラウザ状態バッジ */}
          {isOpen && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
              isBusy
                ? 'bg-orange-100 text-orange-600'
                : 'bg-blue-100 text-blue-600'
            }`}>
              {isBusy ? '実行中' : 'ブラウザ起動中'}
            </span>
          )}
        </div>
      </div>

      {/* アクションボタン行 */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-gray-100">
        <button
          onClick={(e) => { e.stopPropagation(); onCheck() }}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          状態確認
        </button>
        {isOpen ? (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onOpenBrowser() }}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              ブラウザを前面に
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onCloseBrowser() }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              ブラウザを閉じる
            </button>
          </>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenBrowser() }}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            ブラウザを開く
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onEditProxy() }}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          プロキシ
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`@${account.username} を削除しますか？`)) onDelete()
          }}
          className="text-xs text-red-500 hover:text-red-700"
        >
          削除
        </button>
      </div>
    </div>
  )
}
