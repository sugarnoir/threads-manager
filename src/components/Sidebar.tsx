import { useState, useEffect, useRef } from 'react'
import { Account, Group, api } from '../lib/ipc'

interface Props {
  accounts: Account[]
  activeAccountId: number | null
  activeTool: ToolType | null
  adding: boolean
  onOpenAccount: (id: number) => void
  onEditAccount: (account: Account) => void
  onAddAccount: () => void
  onDeleteAccount: (id: number) => void
  onCheckStatus: (id: number) => void
  onUpdateGroup: (id: number, group: string | null) => void
  onReorderAccounts: (updates: { id: number; sort_order: number; group_name: string | null }[]) => void
  onOpenTool: (tool: ToolType) => void
}

export type ToolType = 'compose' | 'scheduler' | 'engagement' | 'history' | 'auto-register' | 'settings' | 'status' | 'research' | 'templates' | 'proxy' | 'image-list'

interface GroupEditState {
  accountId: number
  value: string
}

interface GroupRenameState {
  groupName: string
  value: string
}

type DropTarget =
  | { kind: 'account'; accountId: number; position: 'before' | 'after' }
  | { kind: 'group-header'; groupName: string }

const STATUS_COLOR: Record<Account['status'], string> = {
  active:      'bg-emerald-400',
  inactive:    'bg-zinc-600',
  needs_login: 'bg-amber-400',
  frozen:      'bg-red-500',
  error:       'bg-red-400',
}
const STATUS_LABEL: Record<Account['status'], string> = {
  active:      'ログイン中',
  inactive:    '未確認',
  needs_login: '要ログイン',
  frozen:      '凍結',
  error:       'エラー',
}

const GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-pink-500 to-rose-500',
  'from-amber-500 to-orange-500',
  'from-teal-500 to-emerald-500',
  'from-indigo-500 to-blue-600',
]
function gradient(id: number) {
  return GRADIENTS[id % GRADIENTS.length]
}
function initials(a: Account) {
  return (a.display_name?.[0] ?? a.username[0]).toUpperCase()
}

// ── SVG Icons ──────────────────────────────────────────────────────────────────

function IconProxy() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function IconBulk() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  )
}

function IconHeart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e00055" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  )
}

// ── Compact tool buttons (bottom) ──────────────────────────────────────────────

const BOTTOM_TOOLS: { id: ToolType; label: string; icon: JSX.Element }[] = [
  {
    id: 'auto-register',
    label: 'secret',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" />
        <line x1="22" y1="11" x2="16" y2="11" />
      </svg>
    ),
  },
  {
    id: 'scheduler',
    label: 'secret',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <line x1="8" y1="14" x2="8" y2="14" />
        <line x1="12" y1="14" x2="12" y2="14" />
        <line x1="16" y1="14" x2="16" y2="14" />
        <line x1="8" y1="18" x2="8" y2="18" />
        <line x1="12" y1="18" x2="12" y2="18" />
      </svg>
    ),
  },
  {
    id: 'templates',
    label: 'テンプレ',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
]

export function Sidebar({
  accounts,
  activeAccountId,
  activeTool,
  adding,
  onOpenAccount,
  onEditAccount,
  onAddAccount,
  onDeleteAccount,
  onCheckStatus,
  onUpdateGroup,
  onReorderAccounts,
  onOpenTool,
}: Props) {
  const [showNumbers, setShowNumbers] = useState(
    () => localStorage.getItem('showAccountNumbers') === 'true'
  )

  useEffect(() => {
    const handler = () => setShowNumbers(localStorage.getItem('showAccountNumbers') === 'true')
    window.addEventListener('showAccountNumbersChanged', handler)
    return () => window.removeEventListener('showAccountNumbersChanged', handler)
  }, [])

  // グループ関係なく全体の連番マップを作成
  const accountNumberMap = new Map(accounts.map((a, i) => [a.id, i + 1]))

  // ── CSV インポート ────────────────────────────────────────────────────────
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [csvImporting,   setCsvImporting]   = useState(false)
  const [csvToast,       setCsvToast]       = useState<{ msg: string; ok: boolean } | null>(null)
  const [csvPanelOpen,   setCsvPanelOpen]   = useState(false)
  const [csvGroupSel,    setCsvGroupSel]    = useState<string>('__all__')
  const [csvNewGrpName,  setCsvNewGrpName]  = useState('')
  // handleSidebarCsvFile は onChange コールバックのため ref 経由でグループ選択を受け渡す
  const csvGroupRef = useRef<string>('__all__')

  const showCsvToast = (msg: string, ok: boolean) => {
    setCsvToast({ msg, ok })
    setTimeout(() => setCsvToast(null), 5000)
  }

  const handleCsvModalConfirm = async () => {
    let sel = csvGroupSel
    if (sel === '__new__') {
      const name = csvNewGrpName.trim()
      if (name) {
        const r = await api.groups.create(name)
        if (r.success) { setGroups(prev => [...prev, r.group]); sel = name }
        else sel = '__all__'
      } else {
        sel = '__all__'
      }
    }
    csvGroupRef.current = sel
    setCsvPanelOpen(false)
    setCsvGroupSel('__all__')
    setCsvNewGrpName('')
    csvInputRef.current?.click()
  }

  const handleSidebarCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setCsvImporting(true)
    try {
      const text = await file.text()
      const parseRow = (line: string): string[] => {
        const cols: string[] = []
        let cur = '', inQ = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ
          } else if (ch === ',' && !inQ) { cols.push(cur); cur = '' } else { cur += ch }
        }
        cols.push(cur)
        return cols
      }
      const matrix = text.split(/\r?\n/).filter(l => l.trim()).map(parseRow)
      if (matrix.length === 0) { showCsvToast('空のCSVです', false); return }

      const payload: Array<{ account_id: number; content: string; image_url: null; image_url_2: null }> = []
      let skippedCols = 0

      // 1行目の全セルが既存グループ名と一致する場合はグループヘッダーモード
      const groupSet = new Set(groups.map(g => g.name))
      const firstRow = matrix[0]
      const hasGroupHeaders =
        firstRow.some(cell => cell.trim() && groupSet.has(cell.trim())) &&
        firstRow.every(cell => !cell.trim() || groupSet.has(cell.trim()))

      if (hasGroupHeaders) {
        // グループヘッダーモード: 列ヘッダー = グループ名 → そのグループの全アカウントに追加
        for (let col = 0; col < firstRow.length; col++) {
          const grpName = firstRow[col]?.trim()
          if (!grpName || !groupSet.has(grpName)) { skippedCols++; continue }
          const grpAccounts = accounts.filter(a => a.group_name === grpName)
          if (!grpAccounts.length) { skippedCols++; continue }
          for (let row = 1; row < matrix.length; row++) {
            const content = matrix[row][col]?.trim() ?? ''
            if (!content) continue
            for (const acct of grpAccounts) {
              payload.push({ account_id: acct.id, content, image_url: null, image_url_2: null })
            }
          }
        }
      } else {
        // インデックスモード: モーダルで選択したグループでアカウントを絞り込み
        const grp = csvGroupRef.current
        const targetAccounts =
          grp === '__all__'  ? accounts :
          grp === '__none__' ? accounts.filter(a => !a.group_name) :
                               accounts.filter(a => a.group_name === grp)

        const numCols = Math.max(...matrix.map(r => r.length))
        for (let col = 0; col < numCols; col++) {
          const account = targetAccounts[col]
          if (!account) { skippedCols++; continue }
          for (let row = 0; row < matrix.length; row++) {
            const content = matrix[row][col]?.trim() ?? ''
            if (!content) continue
            payload.push({ account_id: account.id, content, image_url: null, image_url_2: null })
          }
        }
      }

      if (payload.length === 0) { showCsvToast('インポートできるストックがありません', false); return }

      const res = await api.stocks.importCsv(payload)
      const parts = [`${res.imported}件インポートしました`]
      if (skippedCols > 0)       parts.push(`列超過スキップ: ${skippedCols}列`)
      if (res.errors.length > 0) parts.push(`エラー: ${res.errors.length}件`)
      showCsvToast(parts.join(' / '), res.errors.length === 0 && skippedCols === 0)
    } catch (err) {
      showCsvToast(`エラー: ${err instanceof Error ? err.message : String(err)}`, false)
    } finally {
      setCsvImporting(false)
    }
  }

  const [groupEdit, setGroupEdit] = useState<GroupEditState | null>(null)
  const groupInputRef = useRef<HTMLInputElement>(null)

  const [groups, setGroups] = useState<Group[]>([])
  const [groupRename, setGroupRename] = useState<GroupRenameState | null>(null)
  const groupRenameRef = useRef<HTMLInputElement>(null)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [createGroupValue, setCreateGroupValue] = useState('')
  const createGroupRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.groups.list().then(setGroups)
  }, [])

  useEffect(() => {
    if (groupRename) groupRenameRef.current?.focus()
  }, [groupRename])

  useEffect(() => {
    if (showCreateGroup) createGroupRef.current?.focus()
  }, [showCreateGroup])

  const handleCreateGroup = async () => {
    const name = createGroupValue.trim()
    if (!name) { setShowCreateGroup(false); return }
    const result = await api.groups.create(name)
    if (result.success) setGroups((prev) => [...prev, result.group])
    setCreateGroupValue('')
    setShowCreateGroup(false)
  }

  const handleRenameGroup = async () => {
    if (!groupRename) return
    const newName = groupRename.value.trim()
    if (!newName || newName === groupRename.groupName) { setGroupRename(null); return }
    await api.groups.rename({ oldName: groupRename.groupName, newName })
    setGroups((prev) => prev.map((g) => g.name === groupRename.groupName ? { ...g, name: newName } : g))
    accounts.forEach((a) => {
      if (a.group_name === groupRename.groupName) onUpdateGroup(a.id, newName)
    })
    setGroupRename(null)
  }

  const handleDeleteGroup = async (name: string) => {
    if (!confirm(`グループ「${name}」を削除しますか？\nこのグループのアカウントは未分類になります。`)) return
    await api.groups.delete(name)
    setGroups((prev) => prev.filter((g) => g.name !== name))
    accounts.forEach((a) => {
      if (a.group_name === name) onUpdateGroup(a.id, null)
    })
  }

  const draggingIdRef = useRef<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  useEffect(() => {
    if (groupEdit) groupInputRef.current?.focus()
  }, [groupEdit])

  useEffect(() => {
    const unsub = api.on('accounts:action', (data) => {
      const { type, accountId } = data as { type: string; accountId: number }
      if (type === 'open')       onOpenAccount(accountId)
      if (type === 'check')      onCheckStatus(accountId)
      if (type === 'edit-proxy') {
        const acc = accounts.find(a => a.id === accountId)
        if (acc) onEditAccount(acc)
      }
      if (type === 'edit-group') {
        const acc = accounts.find(a => a.id === accountId)
        setGroupEdit({ accountId, value: acc?.group_name ?? '' })
      }
      if (type === 'delete') {
        const acc = accounts.find(a => a.id === accountId)
        if (acc && confirm(`@${acc.username} を削除しますか？`)) onDeleteAccount(accountId)
      }
    })
    return unsub
  }, [accounts, onOpenAccount, onCheckStatus, onEditAccount, onDeleteAccount])

  const handleContextMenu = (e: React.MouseEvent, accountId: number) => {
    e.preventDefault()
    api.accounts.contextMenu(accountId)
  }

  const handleDragStart = (e: React.DragEvent, accountId: number) => {
    draggingIdRef.current = accountId
    setDraggingId(accountId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(accountId))
  }

  const handleDragEnd = () => {
    draggingIdRef.current = null
    setDraggingId(null)
    setDropTarget(null)
  }

  const handleAccountDragOver = (e: React.DragEvent, accountId: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (draggingIdRef.current === accountId) return
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget({ kind: 'account', accountId, position })
  }

  const handleGroupHeaderDragOver = (e: React.DragEvent, groupName: string) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget({ kind: 'group-header', groupName })
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropTarget(null)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const dragId = draggingIdRef.current
    draggingIdRef.current = null
    setDraggingId(null)  // Reset before state updates to prevent stuck opacity-40
    if (dragId === null || dropTarget === null) {
      setDropTarget(null)
      return
    }

    const orderedAccounts = [...accounts]
    const dragIndex = orderedAccounts.findIndex(a => a.id === dragId)
    if (dragIndex === -1) { setDropTarget(null); return }
    const [draggedAccount] = orderedAccounts.splice(dragIndex, 1)

    let newGroupName: string | null = draggedAccount.group_name

    if (dropTarget.kind === 'group-header') {
      newGroupName = dropTarget.groupName || null
      const firstInGroup = orderedAccounts.findIndex(a => (a.group_name ?? '') === dropTarget.groupName)
      if (firstInGroup === -1) {
        orderedAccounts.push(draggedAccount)
      } else {
        orderedAccounts.splice(firstInGroup, 0, draggedAccount)
      }
    } else {
      const target = orderedAccounts.find(a => a.id === dropTarget.accountId)
      if (!target) { setDropTarget(null); return }
      newGroupName = target.group_name
      const targetIndex = orderedAccounts.findIndex(a => a.id === dropTarget.accountId)
      const insertAt = dropTarget.position === 'before' ? targetIndex : targetIndex + 1
      orderedAccounts.splice(insertAt, 0, draggedAccount)
    }

    const updates = orderedAccounts.map((a, i) => ({
      id: a.id,
      sort_order: i * 1000,
      group_name: a.id === dragId ? newGroupName : a.group_name,
    }))

    onReorderAccounts(updates)
    setDropTarget(null)
  }

  const grouped = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    const key = a.group_name ?? ''
    ;(acc[key] ??= []).push(a)
    return acc
  }, {})
  const canonicalGroupNames = groups.map((g) => g.name)
  const allGroupNames = [
    ...canonicalGroupNames,
    ...Object.keys(grouped).filter(k => k !== '' && !canonicalGroupNames.includes(k)),
  ]
  const groupKeys = ['', ...allGroupNames].filter(k => k === '' ? k in grouped : true)

  const isDropBefore = (id: number) =>
    dropTarget?.kind === 'account' && dropTarget.accountId === id && dropTarget.position === 'before'
  const isDropAfter = (id: number) =>
    dropTarget?.kind === 'account' && dropTarget.accountId === id && dropTarget.position === 'after'
  const isGroupDrop = (groupName: string) =>
    dropTarget?.kind === 'group-header' && dropTarget.groupName === groupName

  return (
    <>
    <aside
      className="w-60 flex flex-col bg-zinc-950 border-r border-zinc-800/60 shrink-0 select-none"
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >

      {/* ── macOS drag area ── */}
      <div
        className="h-9 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* ── Top 3 action buttons ── */}
      <div className="px-3 pb-3 shrink-0">
        <div className="grid grid-cols-4 gap-1.5">
          {([
            { id: 'settings'    as ToolType, label: '設定',       Icon: IconProxy, disabled: false },
            { id: 'image-list'  as ToolType, label: '画像リスト', Icon: IconBulk,  disabled: false },
            { id: 'status'      as ToolType, label: 'ステータス', Icon: IconCheck, disabled: false },
            { id: 'engagement'  as ToolType, label: 'いいね/RT',  Icon: IconHeart, disabled: true  },
          ] as const).map(({ id, label, Icon, disabled }) => {
            const isActive = activeTool === id
            return (
              <div key={id} className="relative">
                <button
                  disabled={disabled}
                  onClick={() => !disabled && onOpenTool(id)}
                  className={`w-full flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-xl text-center transition-all ${
                    disabled
                      ? 'bg-zinc-900 text-zinc-600 cursor-not-allowed opacity-50'
                      : isActive
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                        : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  <Icon />
                  <span className="text-[9px] leading-tight font-medium whitespace-nowrap">{label}</span>
                </button>
                {disabled && (
                  <span className="absolute -top-1.5 -right-1 bg-zinc-700 text-zinc-400 text-[7px] font-bold leading-none px-1 py-0.5 rounded-full whitespace-nowrap">
                    使用不可
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Account list header ── */}
      <div className="flex items-center justify-between px-3 pb-2 shrink-0">
        <span className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">
          アカウント
          {accounts.length > 0 && (
            <span className="ml-1 text-zinc-600 normal-case tracking-normal font-normal">
              ({accounts.length})
            </span>
          )}
        </span>
        <button
          onClick={() => setShowCreateGroup(true)}
          title="グループを作成"
          className="w-5 h-5 flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors text-xs"
        >
          ▤
        </button>
      </div>

      {/* ── Account list ── */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-zinc-700">
            <span className="text-3xl">👤</span>
            <p className="text-xs text-center text-zinc-600">アカウントがありません</p>
          </div>
        ) : (
          groupKeys.map((groupKey) => (
            <div key={groupKey}>
              {/* Group header */}
              {groupKey !== '' && (
                <div
                  className={`group/header flex items-center gap-1.5 px-2 pt-3 pb-1.5 cursor-default transition-colors rounded-lg ${
                    isGroupDrop(groupKey) ? 'bg-blue-500/10' : ''
                  }`}
                  onDragOver={(e) => handleGroupHeaderDragOver(e, groupKey)}
                >
                  {groupRename?.groupName === groupKey ? (
                    <input
                      ref={groupRenameRef}
                      value={groupRename.value}
                      onChange={(e) => setGroupRename({ ...groupRename, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameGroup()
                        if (e.key === 'Escape') setGroupRename(null)
                      }}
                      onBlur={handleRenameGroup}
                      className="px-1 py-0 text-[10px] font-semibold uppercase tracking-widest bg-zinc-800 text-white border border-blue-500 rounded outline-none w-24"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className={`text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors flex items-center gap-1 ${
                      isGroupDrop(groupKey) ? 'text-blue-400' : 'text-zinc-600'
                    }`}>
                      <span className="opacity-60">▾</span>
                      {groupKey}
                    </span>
                  )}
                  <div className={`h-px flex-1 transition-colors ${isGroupDrop(groupKey) ? 'bg-blue-500/50' : 'bg-zinc-800'}`} />
                  <div className="flex gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); setGroupRename({ groupName: groupKey, value: groupKey }) }}
                      title="グループ名変更"
                      className="w-4 h-4 flex items-center justify-center text-zinc-600 hover:text-zinc-300 text-[9px] rounded"
                    >
                      ✎
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteGroup(groupKey) }}
                      title="グループ削除"
                      className="w-4 h-4 flex items-center justify-center text-zinc-600 hover:text-red-400 text-[9px] rounded"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Ungrouped label */}
              {groupKey === '' && allGroupNames.length > 0 && (
                <div
                  className={`flex items-center gap-1.5 px-2 pt-2 pb-1.5 ${isGroupDrop('') ? 'bg-blue-500/10 rounded-lg' : ''}`}
                  onDragOver={(e) => handleGroupHeaderDragOver(e, '')}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-700 flex items-center gap-1">
                    <span className="opacity-60">▾</span>
                    グループなし
                  </span>
                  <div className={`h-px flex-1 ${isGroupDrop('') ? 'bg-blue-500/50' : 'bg-zinc-800/60'}`} />
                </div>
              )}

              {(grouped[groupKey] ?? []).map((account) => {
                const isActive   = activeAccountId === account.id
                const isDragging = draggingId === account.id

                return (
                  <div key={account.id}>
                    {isDropBefore(account.id) && (
                      <div className="mx-2 h-0.5 rounded-full bg-blue-500 my-0.5" />
                    )}

                    <div
                      draggable
                      onDragStart={(e) => handleDragStart(e, account.id)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleAccountDragOver(e, account.id)}
                      className={`group relative w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all duration-100 cursor-pointer ${
                        isDragging
                          ? 'opacity-40 scale-95'
                          : isActive
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                      }`}
                      onClick={() => !isDragging && onOpenAccount(account.id)}
                      onContextMenu={(e) => handleContextMenu(e, account.id)}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-blue-500 rounded-r-full" />
                      )}

                      <span
                        className="absolute left-1 top-1/2 -translate-y-1/2 text-zinc-700 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-[10px] leading-none select-none"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        ⠿
                      </span>

                      {/* 番号バッジ */}
                      {showNumbers && (
                        <span className="shrink-0 w-6 text-center text-[10px] font-mono font-semibold text-zinc-500 leading-none tabular-nums">
                          {accountNumberMap.get(account.id)}
                        </span>
                      )}

                      {/* Avatar */}
                      <div className="relative shrink-0">
                        {account.avatar_url ? (
                          <img
                            src={account.avatar_url}
                            alt={account.username}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient(account.id)} flex items-center justify-center text-white text-xs font-bold shadow-sm`}>
                            {initials(account)}
                          </div>
                        )}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-[1.5px] border-zinc-950 ${STATUS_COLOR[account.status]}`}
                          title={STATUS_LABEL[account.status]}
                        />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-[12px] font-semibold truncate leading-tight ${isActive ? 'text-white' : 'text-zinc-200 group-hover:text-white'}`}>
                          {account.display_name ?? account.username}
                        </p>
                        <p className="text-[10px] text-zinc-500 truncate leading-tight">
                          @{account.username}
                          {account.follower_count !== null && (
                            <span className="ml-1 text-zinc-600">
                              · {account.follower_count >= 10000
                                ? `${(account.follower_count / 10000).toFixed(1)}万`
                                : account.follower_count.toLocaleString()}
                            </span>
                          )}
                        </p>
                      </div>

                      {/* Edit button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onEditAccount(account) }}
                        title="アカウント設定"
                        className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-zinc-600 hover:text-white hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition-all text-[10px] leading-none"
                      >
                        ⚙
                      </button>
                    </div>

                    {isDropAfter(account.id) && (
                      <div className="mx-2 h-0.5 rounded-full bg-blue-500 my-0.5" />
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}

        {/* Create group inline */}
        {showCreateGroup && (
          <div className="mt-2 flex items-center gap-1">
            <input
              ref={createGroupRef}
              value={createGroupValue}
              onChange={(e) => setCreateGroupValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateGroup()
                if (e.key === 'Escape') { setShowCreateGroup(false); setCreateGroupValue('') }
              }}
              placeholder="グループ名"
              className="flex-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 focus:border-blue-500 rounded-lg text-white text-xs placeholder-zinc-600 outline-none"
            />
            <button onClick={handleCreateGroup} className="px-2 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors">追加</button>
            <button onClick={() => { setShowCreateGroup(false); setCreateGroupValue('') }} className="px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded-lg transition-colors">✕</button>
          </div>
        )}
      </div>

      {/* ── CSV インポート インラインパネル ── */}
      {csvPanelOpen && (
        <div className="mx-2 mb-2 shrink-0 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white text-xs font-semibold">CSVインポート</span>
            <button
              onClick={() => { setCsvPanelOpen(false); setCsvGroupSel('__all__'); setCsvNewGrpName('') }}
              className="text-zinc-500 hover:text-white text-sm leading-none"
            >✕</button>
          </div>
          <p className="text-zinc-600 text-[10px] mb-2 leading-tight">
            1行目がグループ名の場合は自動判定
          </p>
          <label className="block text-zinc-500 text-[10px] mb-1">対象グループ</label>
          <select
            value={csvGroupSel}
            onChange={e => { setCsvGroupSel(e.target.value); setCsvNewGrpName('') }}
            className="w-full px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 mb-2"
          >
            <option value="__all__">全アカウント（インデックス順）</option>
            <option value="__none__">グループなし（未分類）</option>
            {groups.map(g => (
              <option key={g.name} value={g.name}>{g.name}（{accounts.filter(a => a.group_name === g.name).length}件）</option>
            ))}
            <option value="__new__">＋ 新規グループを作成</option>
          </select>
          {csvGroupSel === '__new__' && (
            <input
              autoFocus
              value={csvNewGrpName}
              onChange={e => setCsvNewGrpName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCsvModalConfirm() }}
              placeholder="グループ名を入力..."
              className="w-full px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 mb-2 placeholder-zinc-600"
            />
          )}
          <button
            onClick={handleCsvModalConfirm}
            disabled={csvImporting || (csvGroupSel === '__new__' && !csvNewGrpName.trim())}
            className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {csvImporting ? '読込中...' : 'ファイルを選択'}
          </button>
        </div>
      )}

      {/* ── Compact bottom tools (カード型) ── */}
      <div className="px-2 pt-2 border-t border-zinc-800/60 shrink-0">
        {/* CSV インポートトースト */}
        {csvToast && (
          <div className={`mb-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium leading-tight ${
            csvToast.ok
              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
              : 'bg-amber-500/15 border border-amber-500/30 text-amber-400'
          }`}>
            {csvToast.msg}
          </div>
        )}
        <div className="flex gap-1.5">
          {BOTTOM_TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => onOpenTool(t.id)}
              title={t.label}
              style={{ background: activeTool === t.id ? undefined : '#2a2a2a', borderRadius: '8px' }}
              className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 transition-colors text-center ${
                activeTool === t.id
                  ? 'bg-blue-600/25 text-blue-400 rounded-lg'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.icon}
              <span className="text-[9px] leading-none font-medium whitespace-nowrap">{t.label}</span>
            </button>
          ))}

          {/* CSV インポートボタン */}
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleSidebarCsvFile}
          />
          <button
            onClick={() => { setCsvGroupSel('__all__'); setCsvNewGrpName(''); setCsvPanelOpen(v => !v) }}
            disabled={csvImporting}
            title="CSVインポート"
            style={{ background: csvPanelOpen ? undefined : '#2a2a2a', borderRadius: '8px' }}
            className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 transition-colors text-center disabled:opacity-50 ${csvPanelOpen ? 'bg-blue-600/25 text-blue-400' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="12" x2="12" y2="18" />
              <polyline points="9 15 12 18 15 15" />
            </svg>
            <span className="text-[9px] leading-none font-medium whitespace-nowrap">
              {csvImporting ? '読込中' : 'CSV'}
            </span>
          </button>
        </div>
      </div>

      {/* ── Add account + Settings ── */}
      <div className="px-3 pt-3 pb-2 shrink-0 flex gap-2">
        <button
          onClick={onAddAccount}
          disabled={adding}
          style={{ background: adding ? undefined : 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl disabled:opacity-50 disabled:bg-zinc-700 text-white text-[13px] font-semibold transition-all hover:brightness-110 active:brightness-90"
        >
          {adding ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              待機中...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              アカウント追加
            </>
          )}
        </button>

        {/* 設定ボタン */}
        <button
          onClick={() => onOpenTool('proxy')}
          title="プロキシ"
          className="w-10 shrink-0 flex items-center justify-center rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* ── Status bar ── */}
      <div className="px-3 pb-3 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          <span className="text-zinc-500 text-[10px]">
            接続中 {accounts.filter(a => a.status === 'active').length}
          </span>
        </div>
        <span className="text-zinc-700 text-[10px]">v1.0.0</span>
      </div>

    </aside>

      {/* ── Group edit modal ── */}
      {groupEdit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setGroupEdit(null)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-72 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-bold text-sm mb-1">グループ名を設定</h3>
            <p className="text-zinc-500 text-xs mb-3">空白にすると「未分類」になります</p>
            <input
              ref={groupInputRef}
              value={groupEdit.value}
              onChange={(e) => setGroupEdit({ ...groupEdit, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { onUpdateGroup(groupEdit.accountId, groupEdit.value || null); setGroupEdit(null) }
                if (e.key === 'Escape') setGroupEdit(null)
              }}
              placeholder="例: メイン, サブ, 仕事..."
              className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 text-sm placeholder-zinc-600"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { onUpdateGroup(groupEdit.accountId, groupEdit.value || null); setGroupEdit(null) }}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                保存
              </button>
              <button
                onClick={() => setGroupEdit(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
