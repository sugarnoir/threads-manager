import { Account } from '../lib/ipc'
import { Composer } from '../pages/Composer'
import { Scheduler } from '../pages/Scheduler'
import { Engagement } from '../pages/Engagement'
import { History } from '../pages/History'
import { Settings, ProxyPresetsSection, ImageGroupsSection, AutoRegisterSection } from '../pages/Settings'
import { StatusCheck } from '../pages/StatusCheck'
import { Research } from '../pages/Research'
import { Templates } from '../pages/Templates'
import type { ToolType } from './Sidebar'

interface Props {
  tool: ToolType
  accounts: Account[]
  selectedAccountId: number | null
  composerInitialContent?: string
  onClose: () => void
  onCheckOne: (id: number) => Promise<{ status: string; message?: string }>
  onCheckAll: (onProgress: (data: { type: string; accountId?: number; status?: string; message?: string; index?: number; total?: number }) => void) => Promise<void>
  onAccountAdded?: () => void
}

const LABELS: Record<ToolType, string> = {
  compose:         '✏️ 投稿',
  scheduler:       '🔒 secret',
  engagement:      '❤️ いいね/RT',
  history:         '📋 履歴',
  'auto-register': '🔒 secret',
  settings:        '⚙️ 設定',
  proxy:           '🔗 プロキシ管理',
  'image-list':    '🖼 画像グループ管理',
  status:          '🔍 ステータス確認',
  research:        '🔎 リサーチ',
  templates:       '📝 テンプレート',
}

export function ToolPanel({ tool, accounts, selectedAccountId, composerInitialContent, onClose, onCheckOne, onCheckAll, onAccountAdded }: Props) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
        <span className="text-white font-semibold text-sm">{LABELS[tool]}</span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors text-base"
          title="閉じる (ブラウザに戻る)"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tool === 'compose' && (
          <Composer accounts={accounts} selectedAccountId={selectedAccountId} initialContent={composerInitialContent} />
        )}
        {tool === 'scheduler' && <Scheduler accounts={accounts} onClose={onClose} />}
        {tool === 'engagement' && <Engagement accounts={accounts} />}
        {tool === 'history' && (
          <History accounts={accounts} selectedAccountId={selectedAccountId} />
        )}
        {tool === 'settings' && <Settings onAccountAdded={onAccountAdded} />}
        {tool === 'auto-register' && <AutoRegisterSection onAccountAdded={onAccountAdded} onClose={onClose} />}
        {tool === 'status' && (
          <StatusCheck
            accounts={accounts}
            onCheckOne={onCheckOne}
            onCheckAll={onCheckAll}
          />
        )}
        {tool === 'research' && (
          <Research accounts={accounts} selectedAccountId={selectedAccountId} />
        )}
        {tool === 'templates' && <Templates accounts={accounts} />}
        {tool === 'proxy' && <ProxyPresetsSection />}
        {tool === 'image-list' && <ImageGroupsSection />}
      </div>
    </div>
  )
}
