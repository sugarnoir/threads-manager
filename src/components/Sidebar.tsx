import { useState, useEffect, useRef } from 'react'
import { Account, Group, AutopostConfig, api } from '../lib/ipc'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

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
  maxAccounts?: number | null
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
  challenge:   'bg-yellow-400',
}
const STATUS_LABEL: Record<Account['status'], string> = {
  active:      'ログイン中',
  inactive:    '未確認',
  needs_login: '要ログイン',
  frozen:      '凍結',
  error:       'エラー',
  challenge:   '要確認（人間確認）',
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
  maxAccounts: maxAccountsProp,
}: Props) {
  const [showNumbers, setShowNumbers] = useState(
    () => localStorage.getItem('showAccountNumbers') === 'true'
  )

  // ── 垢数制限チェック（auth:check のレスポンスから直接取得）──────────────
  const accountLimitReached = maxAccountsProp != null && maxAccountsProp > 0 && accounts.length >= maxAccountsProp

  useEffect(() => {
    const handler = () => setShowNumbers(localStorage.getItem('showAccountNumbers') === 'true')
    window.addEventListener('showAccountNumbersChanged', handler)
    return () => window.removeEventListener('showAccountNumbersChanged', handler)
  }, [])

  // グループ関係なく全体の連番マップを作成
  const accountNumberMap = new Map(accounts.map((a, i) => [a.id, i + 1]))

  // ── CSV インポート ────────────────────────────────────────────────────────
  // 自動投稿設定マップ（account_id → config）
  const [autopostMap, setAutopostMap] = useState<Record<number, AutopostConfig>>({})

  const refreshAutopostMap = () => {
    api.autopost.listEnabled().then((configs) => {
      const map: Record<number, AutopostConfig> = {}
      for (const c of configs) map[c.account_id] = c
      setAutopostMap(map)
    }).catch(() => {})
  }

  useEffect(() => { refreshAutopostMap() }, [accounts])

  useEffect(() => {
    const off = api.on('autopost:updated', refreshAutopostMap)
    return off
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedIds(new Set())
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const calcFreqLabel = (cfg: AutopostConfig): string => {
    const avg = (cfg.min_interval + cfg.max_interval) / 2
    if (avg >= 260 && avg <= 310) return '5/日'
    if (avg >= 330 && avg <= 390) return '4/日'
    if (avg >= 440 && avg <= 520) return '3/日'
    if (avg >= 120 && avg <= 180) return '標準'
    if (avg >= 180 && avg <= 240) return '低'
    if (avg >=  90 && avg <= 150) return '高'
    return `${Math.round(1440 / avg)}/日`
  }

  const MARK_CYCLE = [null, '⭐️', '🔴', '🟢'] as const
  const [markOverrides, setMarkOverrides] = useState<Record<number, string | null>>({})

  const handleMarkClick = async (e: React.MouseEvent, account: Account) => {
    e.stopPropagation()
    const current = markOverrides[account.id] ?? account.mark ?? null
    const idx = MARK_CYCLE.indexOf(current as typeof MARK_CYCLE[number])
    const next = MARK_CYCLE[(idx + 1) % MARK_CYCLE.length]
    setMarkOverrides(prev => ({ ...prev, [account.id]: next }))
    await api.accounts.updateMark({ id: account.id, mark: next }).catch(() => {})
  }

  const [csvImporting,   setCsvImporting]   = useState(false)
  const [csvToast,       setCsvToast]       = useState<{ msg: string; ok: boolean } | null>(null)
  const [csvPanelOpen,   setCsvPanelOpen]   = useState(false)
  const [csvGroupSel,    setCsvGroupSel]    = useState<string>('__all__')
  const [csvNewGrpName,  setCsvNewGrpName]  = useState('')
  // handleSidebarCsvFile は onChange コールバックのため ref 経由でグループ選択を受け渡す
  const csvGroupRef = useRef<string>('__all__')

  // CSVインポートのモード（ストック or アカウント）
  const [csvMode, setCsvMode] = useState<'stock' | 'account' | 'cookie' | 'topic'>('stock')
  // アカウント一括インポート用: 連番ポート
  const [acctSequentialPort,    setAcctSequentialPort]    = useState(false)
  const [acctSequentialStart,   setAcctSequentialStart]   = useState('')
  const [acctGroupSel,          setAcctGroupSel]          = useState<string>('__none__')
  const [acctNewGroupName,      setAcctNewGroupName]      = useState('')
  // Cookieログインインポート用
  const [cookieText,         setCookieText]         = useState('')
  const [cookieGroupSel,     setCookieGroupSel]     = useState<string>('__none__')
  const [cookieNewGroupName, setCookieNewGroupName] = useState('')
  const [cookieProxyMode,    setCookieProxyMode]    = useState<'auto' | 'manual' | 'none'>('auto')
  const [cookieProxyStart,   setCookieProxyStart]   = useState('')
  // トピック XLSX 一括追加用
  const [topicGroupSel,     setTopicGroupSel]     = useState<string>('__all__')
  const [topicImporting,    setTopicImporting]    = useState(false)
  const [topicResult,       setTopicResult]       = useState<Array<{ username: string; added: number }> | null>(null)

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
    handleSidebarCsvFile()
  }

  const handleSidebarCsvFile = async () => {
    const fileResult = await api.dialog.openFile()
    if (!fileResult) return
    setCsvImporting(true)
    try {
      let matrix: string[][]
      const buf = new Uint8Array(fileResult.data)

      if (fileResult.name.endsWith('.xlsx')) {
        const wb = XLSX.read(buf, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        matrix = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][])
          .filter(row => row.some(cell => String(cell).trim() !== ''))
          .map(row => row.map(cell => String(cell)))
      } else {
        const text = new TextDecoder().decode(buf)
        const result = Papa.parse(text, { delimiter: ',', skipEmptyLines: true })
        matrix = result.data as string[][]
      }
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

  // ── アカウント一括インポート (CSV) ───────────────────────────────────────
  const handleAccountBulkImport = async () => {
    const fileResult = await api.dialog.openFile()
    if (!fileResult) return

    // グループ決定
    let targetGroup: string | null = null
    if (acctGroupSel === '__new__') {
      const name = acctNewGroupName.trim()
      if (!name) { showCsvToast('新規グループ名を入力してください', false); return }
      const r = await api.groups.create(name)
      if (r.success) setGroups(prev => [...prev, r.group])
      targetGroup = name
    } else if (acctGroupSel !== '__none__') {
      targetGroup = acctGroupSel
    }

    setCsvImporting(true)
    try {
      let matrix: string[][]
      const buf = new Uint8Array(fileResult.data)

      if (fileResult.name.endsWith('.xlsx')) {
        const wb = XLSX.read(buf, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        matrix = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][])
          .filter(row => row.some(cell => String(cell).trim() !== ''))
          .map(row => row.map(cell => String(cell)))
      } else {
        const text = new TextDecoder().decode(buf)
        const result = Papa.parse(text, { delimiter: ',', skipEmptyLines: true })
        matrix = result.data as string[][]
      }
      if (matrix.length === 0) { showCsvToast('空のCSVです', false); return }

      // 1行目がヘッダーの場合は除外
      const firstRow = matrix[0].map(c => c.trim().toLowerCase())
      const hasHeader = firstRow.includes('username') || firstRow[0] === 'username'
      const dataRows = hasHeader ? matrix.slice(1) : matrix

      // 連番ポート
      const seqStartPort = acctSequentialPort ? parseInt(acctSequentialStart, 10) : NaN
      if (acctSequentialPort && (!Number.isFinite(seqStartPort) || seqStartPort <= 0)) {
        showCsvToast('連番の開始ポートが無効です', false)
        return
      }

      const payload = dataRows.map((row, i) => {
        const username = (row[0] ?? '').trim()
        const password = (row[1] ?? '').trim() || null
        const proxy_host = (row[2] ?? '').trim() || null
        let proxy_port: number | null = null
        if (acctSequentialPort && proxy_host) {
          proxy_port = seqStartPort + i
        } else {
          const p = parseInt((row[3] ?? '').trim(), 10)
          proxy_port = Number.isFinite(p) && p > 0 ? p : null
        }
        const proxy_user = (row[4] ?? '').trim() || null
        const proxy_pass = (row[5] ?? '').trim() || null
        return {
          username,
          password,
          proxy_host,
          proxy_port,
          proxy_user,
          proxy_pass,
          group_name: targetGroup,
        }
      }).filter(r => r.username)

      if (payload.length === 0) { showCsvToast('インポート対象の行がありません', false); return }

      const res = await api.accounts.bulkImport(payload)
      const parts = [`${res.imported}件追加`]
      if (res.skipped > 0)       parts.push(`スキップ(重複): ${res.skipped}件`)
      if (res.errors.length > res.skipped) parts.push(`エラー: ${res.errors.length - res.skipped}件`)
      showCsvToast(parts.join(' / '), res.imported > 0)
      setCsvPanelOpen(false)
      if (res.imported > 0) window.dispatchEvent(new CustomEvent('accounts-changed'))
    } catch (err) {
      showCsvToast(`エラー: ${err instanceof Error ? err.message : String(err)}`, false)
    } finally {
      setCsvImporting(false)
    }
  }

  // ── Cookie ログインインポート ────────────────────────────────────────
  const handleCookieLoginImport = async () => {
    const text = cookieText.trim()
    if (!text) { showCsvToast('テキストを入力してください', false); return }

    // グループ決定
    let targetGroup: string | null = null
    if (cookieGroupSel === '__new__') {
      const name = cookieNewGroupName.trim()
      if (!name) { showCsvToast('グループ名を入力してください', false); return }
      const r = await api.groups.create(name)
      if (r.success) setGroups(prev => [...prev, r.group])
      targetGroup = name
    } else if (cookieGroupSel !== '__none__') {
      targetGroup = cookieGroupSel
    }

    setCsvImporting(true)
    try {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      // フォーマット: username|password|token|[cookiesJSON]|email
      const payload = lines.map((line) => {
        // パイプ区切りだが cookies JSON 内に | が含まれる可能性は低い
        // [cookies] の部分を安全に抽出: 最初の [ から最後の ] まで
        const bracketStart = line.indexOf('[')
        const bracketEnd   = line.lastIndexOf(']')

        let username = '', password = '', token = '', email = ''
        let cookies: unknown[] = []

        if (bracketStart !== -1 && bracketEnd !== -1 && bracketEnd > bracketStart) {
          const before = line.slice(0, bracketStart).replace(/\|$/, '')
          const cookieStr = line.slice(bracketStart, bracketEnd + 1)
          const after  = line.slice(bracketEnd + 1).replace(/^\|/, '')

          const beforeParts = before.split('|')
          username = (beforeParts[0] ?? '').trim()
          password = (beforeParts[1] ?? '').trim()
          token    = (beforeParts[2] ?? '').trim()
          email    = after.split('|').filter(Boolean).pop()?.trim() ?? ''

          try { cookies = JSON.parse(cookieStr) } catch { cookies = [] }
        } else {
          // [ ] がない場合はシンプルにパイプ分割
          const parts = line.split('|')
          username = (parts[0] ?? '').trim()
          password = (parts[1] ?? '').trim()
          token    = (parts[2] ?? '').trim()
          email    = (parts[4] ?? '').trim()
        }

        return { username, password, token, cookies, email, group_name: targetGroup }
      }).filter(r => r.username)

      if (payload.length === 0) { showCsvToast('有効な行がありません', false); return }

      console.log(`[CookieImport] payload count=${payload.length}`)
      payload.forEach((p, i) => console.log(`[CookieImport] [${i}] user=${p.username} pw=${p.password?.slice(0,4)}... cookies=${p.cookies?.length} email=${p.email}`))

      const res = await api.accounts.importCookieLogin(payload, {
        proxyMode:      cookieProxyMode,
        proxyStartPort: cookieProxyMode === 'manual' ? parseInt(cookieProxyStart, 10) : undefined,
      })
      const parts = [`${res.imported}件追加`]
      if (res.skipped > 0) parts.push(`スキップ(重複): ${res.skipped}件`)
      if (res.errors.length > res.skipped) parts.push(`エラー: ${res.errors.length - res.skipped}件`)
      showCsvToast(parts.join(' / '), res.imported > 0)
      if (res.imported > 0) {
        setCookieText('')
        setCsvPanelOpen(false)
        // サイドバーのアカウント一覧を更新するためカスタムイベントを発火
        window.dispatchEvent(new CustomEvent('accounts-changed'))
      }
    } catch (err) {
      showCsvToast(`エラー: ${err instanceof Error ? err.message : String(err)}`, false)
    } finally {
      setCsvImporting(false)
    }
  }

  // ── トピック XLSX 一括追加 ──────────────────────────────────────────
  const handleTopicXlsxImport = async () => {
    const fileResult = await api.dialog.openFile()
    if (!fileResult) return
    if (!fileResult.name.endsWith('.xlsx')) {
      showCsvToast('xlsx ファイルを選択してください', false)
      return
    }
    setTopicImporting(true)
    setTopicResult(null)
    try {
      const buf = new Uint8Array(fileResult.data)
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const matrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][]
      if (matrix.length === 0) { showCsvToast('空のXLSXです', false); return }

      const numCols = Math.max(...matrix.map(r => r.length))
      const columns: string[][] = []
      for (let col = 0; col < numCols; col++) {
        columns.push(matrix.map(row => String(row[col] ?? '').trim()).filter(Boolean))
      }

      const targetGroup = topicGroupSel === '__all__' ? null : topicGroupSel
      const res = await api.stocks.bulkAddTopics({ group_name: targetGroup, columns })
      if (res.success && res.results) {
        setTopicResult(res.results)
        const totalAdded = res.results.reduce((s, r) => s + r.added, 0)
        showCsvToast(`${totalAdded}件のトピックを追加（${res.results.length}垢）`, totalAdded > 0)
      } else {
        showCsvToast('トピック追加に失敗しました', false)
      }
    } catch (err) {
      showCsvToast(`エラー: ${err instanceof Error ? err.message : String(err)}`, false)
    } finally {
      setTopicImporting(false)
    }
  }

  const [groupEdit, setGroupEdit] = useState<GroupEditState | null>(null)
  const [newGroupInlineInput, setNewGroupInlineInput] = useState(false)
  const [newGroupInlineValue, setNewGroupInlineValue] = useState('')

  // ── グループ一括メンバー編集 ───────────────────────────────────────────────
  const [groupMemberEdit, setGroupMemberEdit] = useState<{ groupName: string; checkedIds: Set<number> } | null>(null)

  const openGroupMemberModal = (groupName: string) => {
    const checkedIds = new Set(accounts.filter(a => a.group_name === groupName).map(a => a.id))
    setGroupMemberEdit({ groupName, checkedIds })
  }

  const handleGroupMemberSave = () => {
    if (!groupMemberEdit) return
    const { groupName, checkedIds } = groupMemberEdit
    const changed = accounts
      .filter(a => {
        const inGroup = a.group_name === groupName
        const willBeIn = checkedIds.has(a.id)
        return inGroup !== willBeIn
      })
      .map(a => ({ id: a.id, sort_order: a.sort_order, group_name: checkedIds.has(a.id) ? groupName : null }))
    if (changed.length > 0) onReorderAccounts(changed)
    setGroupMemberEdit(null)
  }

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

  // ── Multi-select state ─────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const lastSelectedIdRef = useRef<number | null>(null)
  const draggingIdsRef = useRef<number[]>([])
  const [draggingIdsSet, setDraggingIdsSet] = useState<Set<number>>(new Set())

  // ── Group drag state ──────────────────────────────────────────────────────
  const draggingGroupRef = useRef<string | null>(null)
  const [draggingGroupName, setDraggingGroupName] = useState<string | null>(null)
  const [groupDropTarget, setGroupDropTarget] = useState<{ name: string; position: 'before' | 'after' } | null>(null)

  const handleGroupDragStart = (e: React.DragEvent, groupName: string) => {
    draggingGroupRef.current = groupName
    setDraggingGroupName(groupName)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/group', groupName)
    e.stopPropagation()
  }

  const handleGroupDragEnd = () => {
    draggingGroupRef.current = null
    setDraggingGroupName(null)
    setGroupDropTarget(null)
  }

  const handleGroupDragOver = (e: React.DragEvent, groupName: string) => {
    if (!draggingGroupRef.current || draggingGroupRef.current === groupName) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setGroupDropTarget({ name: groupName, position })
  }

  const handleGroupDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const dragName = draggingGroupRef.current
    draggingGroupRef.current = null
    setDraggingGroupName(null)
    if (!dragName || !groupDropTarget || dragName === groupDropTarget.name) {
      setGroupDropTarget(null)
      return
    }

    const ordered = [...groups]
    const fromIdx = ordered.findIndex(g => g.name === dragName)
    if (fromIdx === -1) { setGroupDropTarget(null); return }
    const [moved] = ordered.splice(fromIdx, 1)
    let toIdx = ordered.findIndex(g => g.name === groupDropTarget.name)
    if (toIdx === -1) { setGroupDropTarget(null); return }
    if (groupDropTarget.position === 'after') toIdx += 1
    ordered.splice(toIdx, 0, moved)

    const updates = ordered.map((g, i) => ({ id: g.id, sort_order: (i + 1) * 1000 }))
    setGroups(ordered.map((g, i) => ({ ...g, sort_order: (i + 1) * 1000 })))
    api.groups.reorder(updates)
    setGroupDropTarget(null)
  }


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
    // If dragging a selected account, drag all selected; otherwise just this one
    const ids = selectedIds.has(accountId) ? [...selectedIds] : [accountId]
    draggingIdRef.current = accountId
    draggingIdsRef.current = ids
    setDraggingId(accountId)
    setDraggingIdsSet(new Set(ids))
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(accountId))
  }

  const handleDragEnd = () => {
    draggingIdRef.current = null
    draggingIdsRef.current = []
    setDraggingId(null)
    setDraggingIdsSet(new Set())
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
    const dragIds = draggingIdsRef.current
    draggingIdRef.current = null
    draggingIdsRef.current = []
    setDraggingId(null)
    setDraggingIdsSet(new Set())
    if (!dragIds.length || dropTarget === null) {
      setDropTarget(null)
      return
    }

    const dragIdSet = new Set(dragIds)
    // Keep original order of dragged accounts
    const draggedAccounts = accounts.filter(a => dragIdSet.has(a.id))
    const remaining = accounts.filter(a => !dragIdSet.has(a.id))

    let newGroupName: string | null = draggedAccounts[0]?.group_name ?? null

    if (dropTarget.kind === 'group-header') {
      newGroupName = dropTarget.groupName || null
      const firstInGroup = remaining.findIndex(a => (a.group_name ?? '') === dropTarget.groupName)
      if (firstInGroup === -1) {
        remaining.push(...draggedAccounts)
      } else {
        remaining.splice(firstInGroup, 0, ...draggedAccounts)
      }
    } else {
      const target = remaining.find(a => a.id === dropTarget.accountId)
      if (!target) { setDropTarget(null); return }
      newGroupName = target.group_name
      const targetIndex = remaining.findIndex(a => a.id === dropTarget.accountId)
      const insertAt = dropTarget.position === 'before' ? targetIndex : targetIndex + 1
      remaining.splice(insertAt, 0, ...draggedAccounts)
    }

    const updates = remaining.map((a, i) => ({
      id: a.id,
      sort_order: i * 1000,
      group_name: dragIdSet.has(a.id) ? newGroupName : a.group_name,
    }))

    onReorderAccounts(updates)
    setDropTarget(null)
    setSelectedIds(new Set())
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
            { id: 'engagement'  as ToolType, label: 'いいね/RT',  Icon: IconHeart, disabled: false },
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

      {/* ── Multi-select banner ── */}
      {selectedIds.size > 0 && (
        <div className="mx-2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-blue-900/50 ring-1 ring-blue-600/40 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-blue-300 font-medium">
            {selectedIds.size}垢選択中 · ドラッグでグループ移動
          </span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-blue-400 hover:text-blue-200 text-[11px] leading-none ml-2"
            title="選択解除"
          >
            ✕
          </button>
        </div>
      )}

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
                <>
                  {groupDropTarget?.name === groupKey && groupDropTarget.position === 'before' && (
                    <div className="mx-2 h-0.5 rounded-full bg-purple-500 my-0.5" />
                  )}
                  <div
                    draggable={!groupRename || groupRename.groupName !== groupKey}
                    onDragStart={(e) => handleGroupDragStart(e, groupKey)}
                    onDragEnd={handleGroupDragEnd}
                    onDragOver={(e) => {
                      if (draggingGroupRef.current) handleGroupDragOver(e, groupKey)
                      else handleGroupHeaderDragOver(e, groupKey)
                    }}
                    onDrop={(e) => {
                      if (draggingIdRef.current !== null) handleDrop(e)
                      else handleGroupDrop(e)
                    }}
                    className={`group/header flex items-center gap-1.5 px-2 pt-3 pb-1.5 mt-2 cursor-default transition-colors rounded-lg border-t border-zinc-700/80 ${
                      draggingGroupName === groupKey
                        ? 'opacity-40'
                        : isGroupDrop(groupKey)
                        ? 'bg-blue-500/20 ring-1 ring-inset ring-blue-500/40'
                        : groupDropTarget?.name === groupKey
                        ? 'bg-purple-500/10'
                        : draggingIdsSet.size > 0
                        ? 'bg-zinc-800/40 ring-1 ring-inset ring-zinc-700/60'
                        : ''
                    }`}
                  >
                    <span
                      className="text-zinc-700 opacity-0 group-hover/header:opacity-100 cursor-grab active:cursor-grabbing text-[10px] leading-none select-none shrink-0"
                      title="ドラッグして並び替え"
                    >
                      ⠿
                    </span>
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
                      <span
                        className={`text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer hover:text-white ${
                          isGroupDrop(groupKey) ? 'text-blue-300' : 'text-zinc-200'
                        }`}
                        title="クリックしてメンバーを一括設定"
                        onClick={(e) => { e.stopPropagation(); if (!draggingId) openGroupMemberModal(groupKey) }}
                      >
                        <span className="opacity-60">▾</span>
                        {groupKey}
                        <span className="ml-1 text-[9px] font-normal text-zinc-500 normal-case tracking-normal">
                          ({grouped[groupKey]?.length ?? 0})
                        </span>
                      </span>
                    )}
                    <div className={`h-px flex-1 transition-colors ${isGroupDrop(groupKey) ? 'bg-blue-500/60' : 'bg-zinc-600/70'}`} />
                    <div className="flex gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); openGroupMemberModal(groupKey) }}
                        title="メンバーを一括設定"
                        className="w-4 h-4 flex items-center justify-center text-zinc-600 hover:text-blue-400 text-[9px] rounded"
                      >
                        ☰
                      </button>
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
                  {groupDropTarget?.name === groupKey && groupDropTarget.position === 'after' && (
                    <div className="mx-2 h-0.5 rounded-full bg-purple-500 my-0.5" />
                  )}
                </>
              )}

              {/* Ungrouped label */}
              {groupKey === '' && allGroupNames.length > 0 && (
                <div
                  className={`flex items-center gap-1.5 px-2 pt-2 pb-1.5 mt-2 rounded-lg border-t border-zinc-700/80 transition-colors ${
                    isGroupDrop('')
                      ? 'bg-blue-500/20 ring-1 ring-inset ring-blue-500/40'
                      : draggingIdsSet.size > 0
                      ? 'bg-zinc-800/40 ring-1 ring-inset ring-zinc-700/60'
                      : ''
                  }`}
                  onDragOver={(e) => handleGroupHeaderDragOver(e, '')}
                  onDrop={handleDrop}
                >
                  <span className={`text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 transition-colors ${
                    isGroupDrop('') ? 'text-blue-300' : 'text-zinc-300'
                  }`}>
                    <span className="opacity-60">▾</span>
                    グループなし
                    <span className="ml-1 text-[9px] font-normal text-zinc-500 normal-case tracking-normal">
                      ({grouped['']?.length ?? 0})
                    </span>
                  </span>
                  <div className={`h-px flex-1 transition-colors ${isGroupDrop('') ? 'bg-blue-500/60' : 'bg-zinc-600/70'}`} />
                </div>
              )}

              {(grouped[groupKey] ?? []).map((account) => {
                const isActive     = activeAccountId === account.id
                const isDragging   = draggingIdsSet.has(account.id)
                const isSelected   = selectedIds.has(account.id)

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
                          : isSelected && !isActive
                          ? 'bg-blue-900/40 ring-1 ring-inset ring-blue-600/50 text-zinc-100'
                          : isActive
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                      }`}
                      onClick={(e) => {
                        if (isDragging) return
                        if (e.metaKey || e.ctrlKey) {
                          // Toggle selection
                          setSelectedIds(prev => {
                            const next = new Set(prev)
                            if (next.has(account.id)) next.delete(account.id)
                            else next.add(account.id)
                            return next
                          })
                          lastSelectedIdRef.current = account.id
                        } else if (e.shiftKey && lastSelectedIdRef.current !== null) {
                          // Range select based on current display order
                          const allDisplayed = accounts
                          const fromIdx = allDisplayed.findIndex(a => a.id === lastSelectedIdRef.current)
                          const toIdx   = allDisplayed.findIndex(a => a.id === account.id)
                          if (fromIdx !== -1 && toIdx !== -1) {
                            const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
                            setSelectedIds(new Set(allDisplayed.slice(start, end + 1).map(a => a.id)))
                          }
                        } else {
                          // Normal click: open account, clear selection
                          setSelectedIds(new Set())
                          lastSelectedIdRef.current = null
                          onOpenAccount(account.id)
                        }
                      }}
                      onContextMenu={(e) => handleContextMenu(e, account.id)}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-blue-500 rounded-r-full" />
                      )}
                      {isSelected && !isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-blue-400/70 rounded-r-full" />
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
                        <p className={`text-[12px] font-semibold truncate leading-tight flex items-center gap-1 ${isActive ? 'text-white' : 'text-zinc-200 group-hover:text-white'}`}>
                          {account.platform === 'x' && (
                            <span className="shrink-0 px-1 py-0 rounded bg-zinc-700 text-zinc-300 text-[8px] font-bold leading-tight">𝕏</span>
                          )}
                          <span className="truncate">{account.display_name ?? account.username}</span>
                          {account.status === 'challenge' && (
                            <span className="shrink-0 text-yellow-400" title="人間確認が必要です">⚠</span>
                          )}
                          {account.reply_ban_status === 'banned' && (
                            <span className="shrink-0 text-red-400" title="リプBAN">⚠️</span>
                          )}
                        </p>
                        <p className="text-[10px] text-zinc-500 truncate leading-tight">
                          @{account.username}
                        </p>
                        {account.follower_count !== null && (() => {
                          const cur  = account.follower_count
                          const prev = account.follower_count_prev
                          const diff = (prev !== null && prev !== undefined) ? cur - prev : null
                          const fmt  = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString()
                          return (
                            <p className="text-[9px] text-zinc-600 truncate leading-tight">
                              フォロワー: {fmt(cur)}
                              {diff !== null && diff !== 0 && (
                                <span className={diff > 0 ? 'text-emerald-500' : 'text-red-500'}>
                                  {' '}{diff > 0 ? `(+${diff})` : `(${diff})`}
                                </span>
                              )}
                            </p>
                          )
                        })()}
                        {/* 自動投稿バッジ */}
                        {autopostMap[account.id] && (() => {
                          const cfg = autopostMap[account.id]
                          const dot = cfg.use_api ? '🟢' : '🟡'
                          const freq = calcFreqLabel(cfg)
                          return (
                            <p className="text-[9px] text-zinc-500 leading-tight">
                              {dot} 自動 {freq}
                            </p>
                          )
                        })()}
                      </div>

                      {/* Mark button */}
                      {(() => {
                        const mark = markOverrides[account.id] ?? account.mark ?? null
                        return (
                          <button
                            onClick={(e) => handleMarkClick(e, account)}
                            title="マークを切り替え"
                            className={`shrink-0 w-5 h-5 rounded flex items-center justify-center transition-all text-[11px] leading-none ${
                              mark
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-white hover:bg-zinc-700'
                            }`}
                          >
                            {mark ?? '○'}
                          </button>
                        )
                      })()}

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

          {/* モード切替タブ */}
          <div className="flex gap-1 mb-3 bg-zinc-800/60 p-0.5 rounded-lg">
            <button
              onClick={() => setCsvMode('stock')}
              className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-colors ${
                csvMode === 'stock' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              ストック
            </button>
            <button
              onClick={() => setCsvMode('account')}
              className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-colors ${
                csvMode === 'account' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              アカウント
            </button>
            <button
              onClick={() => setCsvMode('cookie')}
              className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-colors ${
                csvMode === 'cookie' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Cookie
            </button>
            <button
              onClick={() => setCsvMode('topic')}
              className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-colors ${
                csvMode === 'topic' ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              トピック
            </button>
          </div>

          {csvMode === 'stock' && (
            <>
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
            </>
          )}

          {csvMode === 'account' && (
            <>
              <div className="mb-2 p-2 rounded-lg bg-zinc-950/70 border border-zinc-800">
                <p className="text-zinc-300 text-[10px] font-semibold mb-1">CSVフォーマット</p>
                <code className="block text-[9px] leading-tight text-emerald-300 font-mono whitespace-pre">
                  username,password,{'\n'}proxy_host,proxy_port,{'\n'}proxy_user,proxy_pass
                </code>
                <p className="text-zinc-500 text-[9px] leading-tight mt-1.5">
                  1行目がヘッダー行の場合は自動判定。<br/>
                  パスワード・プロキシは省略可。
                </p>
              </div>

              <label className="block text-zinc-500 text-[10px] mb-1">追加先グループ</label>
              <select
                value={acctGroupSel}
                onChange={e => { setAcctGroupSel(e.target.value); setAcctNewGroupName('') }}
                className="w-full px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 mb-2"
              >
                <option value="__none__">グループなし（未分類）</option>
                {groups.map(g => (
                  <option key={g.name} value={g.name}>{g.name}</option>
                ))}
                <option value="__new__">＋ 新規グループを作成</option>
              </select>
              {acctGroupSel === '__new__' && (
                <input
                  autoFocus
                  value={acctNewGroupName}
                  onChange={e => setAcctNewGroupName(e.target.value)}
                  placeholder="グループ名..."
                  className="w-full px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 mb-2 placeholder-zinc-600"
                />
              )}

              {/* 連番ポートオプション */}
              <label className="flex items-center gap-1.5 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acctSequentialPort}
                  onChange={e => setAcctSequentialPort(e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-zinc-300 text-[10px]">ポートを連番生成（CSVのport列を無視）</span>
              </label>
              {acctSequentialPort && (
                <input
                  type="number"
                  value={acctSequentialStart}
                  onChange={e => setAcctSequentialStart(e.target.value)}
                  placeholder="開始ポート (例: 10001)"
                  className="w-full px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 mb-2 placeholder-zinc-600"
                />
              )}

              <button
                onClick={handleAccountBulkImport}
                disabled={
                  csvImporting ||
                  (acctGroupSel === '__new__' && !acctNewGroupName.trim()) ||
                  (acctSequentialPort && !acctSequentialStart.trim())
                }
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                {csvImporting ? '読込中...' : 'ファイルを選択'}
              </button>
              <p className="text-zinc-600 text-[9px] mt-1.5 leading-tight">
                ※ インポートしたアカウントはログイン未完了状態になります。<br/>
                サイドバーから個別にログインしてください。
              </p>
            </>
          )}

          {csvMode === 'cookie' && (
            <>
              <div className="mb-2 p-2 rounded-lg bg-zinc-950/70 border border-zinc-800">
                <p className="text-zinc-300 text-[10px] font-semibold mb-1">フォーマット（1行1垢）</p>
                <code className="block text-[9px] leading-relaxed text-emerald-300 font-mono whitespace-pre-wrap break-all">
                  username|password|token|[cookies]|email
                </code>
                <p className="text-zinc-500 text-[9px] leading-tight mt-1">
                  cookies は JSON 配列。sessionid を含む場合は active に設定。
                </p>
              </div>

              <textarea
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                rows={5}
                placeholder={'user1|pass1|token1|[{"name":"sessionid","value":"...","domain":".instagram.com"}]|email@example.com'}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-[10px] text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 mb-2 resize-none font-mono leading-tight"
              />

              {/* プロキシ割り当て */}
              <label className="block text-zinc-500 text-[10px] mb-1">プロキシ割り当て</label>
              <div className="flex gap-1 mb-2 bg-zinc-800/60 p-0.5 rounded-lg">
                {([
                  { id: 'auto'   as const, label: '自動（少順）' },
                  { id: 'manual' as const, label: '連番' },
                  { id: 'none'   as const, label: 'なし' },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setCookieProxyMode(opt.id)}
                    className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-colors ${
                      cookieProxyMode === opt.id
                        ? 'bg-blue-600 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {cookieProxyMode === 'manual' && (
                <input
                  type="number"
                  value={cookieProxyStart}
                  onChange={e => setCookieProxyStart(e.target.value)}
                  placeholder="開始ポート (例: 10028)"
                  className="w-full px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 mb-2 placeholder-zinc-600 font-mono"
                />
              )}
              {cookieProxyMode === 'auto' && (
                <p className="text-zinc-600 text-[9px] mb-2 leading-tight">
                  既存垢の decodo プロキシから使用数が少ないポート順に割り当て
                </p>
              )}

              <label className="block text-zinc-500 text-[10px] mb-1">追加先グループ</label>
              <select
                value={cookieGroupSel}
                onChange={e => { setCookieGroupSel(e.target.value); setCookieNewGroupName('') }}
                className="w-full px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 mb-2"
              >
                <option value="__none__">グループなし</option>
                {groups.map(g => (
                  <option key={g.name} value={g.name}>{g.name}</option>
                ))}
                <option value="__new__">＋ 新規グループ</option>
              </select>
              {cookieGroupSel === '__new__' && (
                <input
                  autoFocus
                  value={cookieNewGroupName}
                  onChange={e => setCookieNewGroupName(e.target.value)}
                  placeholder="グループ名..."
                  className="w-full px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 mb-2 placeholder-zinc-600"
                />
              )}

              <button
                onClick={handleCookieLoginImport}
                disabled={
                  csvImporting || !cookieText.trim() ||
                  (cookieGroupSel === '__new__' && !cookieNewGroupName.trim()) ||
                  (cookieProxyMode === 'manual' && !cookieProxyStart.trim())
                }
                className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                {csvImporting ? '読込中...' : 'Cookieインポート実行'}
              </button>
            </>
          )}

          {csvMode === 'topic' && (
            <>
              <p className="text-zinc-500 text-[10px] mb-2 leading-tight">
                XLSX の A列→グループ内1垢目、B列→2垢目... の順で
                トピック未設定のストックにのみ追加。
              </p>

              <label className="block text-zinc-500 text-[10px] mb-1">対象グループ</label>
              <select
                value={topicGroupSel}
                onChange={e => setTopicGroupSel(e.target.value)}
                className="w-full px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 mb-2"
              >
                <option value="__all__">全アカウント（sort順）</option>
                {groups.map(g => (
                  <option key={g.name} value={g.name}>
                    {g.name}（{accounts.filter(a => a.group_name === g.name).length}垢）
                  </option>
                ))}
              </select>

              <button
                onClick={handleTopicXlsxImport}
                disabled={topicImporting}
                className="w-full py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                {topicImporting ? '処理中...' : 'XLSXを選択して追加'}
              </button>

              {topicResult && (
                <div className="mt-2 text-[10px] text-zinc-400 bg-zinc-950/60 rounded-lg px-2 py-1.5 max-h-28 overflow-y-auto space-y-0.5">
                  {topicResult.map((r, i) => (
                    <div key={i}>
                      <span className="text-zinc-600 font-mono">{String.fromCharCode(65 + i)}列</span>
                      {' '}@{r.username}:{' '}
                      <span className={r.added > 0 ? 'text-emerald-400' : 'text-zinc-600'}>
                        {r.added}件追加
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
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

          {/* CSV/xlsxインポートボタン */}
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
          disabled={adding || accountLimitReached}
          title={accountLimitReached ? `アカウント数が上限（${maxAccountsProp}件）に達しました` : undefined}
          style={{ background: (adding || accountLimitReached) ? undefined : 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl disabled:opacity-50 disabled:bg-zinc-700 text-white text-[13px] font-semibold transition-all hover:brightness-110 active:brightness-90"
        >
          {adding ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              待機中...
            </>
          ) : accountLimitReached ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              上限 {maxAccountsProp}垢
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
        <span className="text-zinc-700 text-[10px]">v{__APP_VERSION__}</span>
      </div>

    </aside>

      {/* ── Group member bulk-edit modal ── */}
      {groupMemberEdit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setGroupMemberEdit(null)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-80 shadow-2xl flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-bold text-sm mb-0.5">
              グループ「{groupMemberEdit.groupName}」
            </h3>
            <p className="text-zinc-500 text-xs mb-3">メンバーにするアカウントにチェックを入れてください</p>

            <div className="flex-1 overflow-y-auto space-y-1 min-h-0 mb-4">
              {accounts.map((acc) => {
                const checked = groupMemberEdit.checkedIds.has(acc.id)
                return (
                  <label
                    key={acc.id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-800 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(groupMemberEdit.checkedIds)
                        if (checked) next.delete(acc.id)
                        else next.add(acc.id)
                        setGroupMemberEdit({ ...groupMemberEdit, checkedIds: next })
                      }}
                      className="w-3.5 h-3.5 accent-blue-500 shrink-0"
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-white text-xs font-medium truncate">
                        {acc.display_name ?? `@${acc.username}`}
                      </span>
                      {acc.display_name && (
                        <span className="text-zinc-500 text-[10px] truncate">@{acc.username}</span>
                      )}
                    </div>
                    {acc.group_name && acc.group_name !== groupMemberEdit.groupName && (
                      <span className="ml-auto shrink-0 text-[9px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">
                        {acc.group_name}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>

            <div className="flex gap-2 shrink-0">
              <button
                onClick={handleGroupMemberSave}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                保存（{groupMemberEdit.checkedIds.size}件）
              </button>
              <button
                onClick={() => setGroupMemberEdit(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Group edit modal (clickable group list) ── */}
      {groupEdit && (() => {
        const targetAccount = accounts.find(a => a.id === groupEdit.accountId)
        const currentGroup = targetAccount?.group_name ?? null
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => { setGroupEdit(null); setNewGroupInlineInput(false); setNewGroupInlineValue('') }}
          >
            <div
              className="bg-zinc-900 border border-zinc-700 rounded-2xl w-80 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-4 pb-3 border-b border-zinc-800">
                <h3 className="text-white font-bold text-sm">グループを変更</h3>
                <p className="text-zinc-500 text-xs mt-0.5">
                  @{targetAccount?.username} の所属グループを選択
                </p>
              </div>

              <div className="max-h-80 overflow-y-auto py-1.5">
                {/* 未分類 */}
                <button
                  onClick={() => { onUpdateGroup(groupEdit.accountId, null); setGroupEdit(null) }}
                  className={`w-full flex items-center justify-between px-5 py-2 text-sm transition-colors ${
                    currentGroup === null
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'text-zinc-200 hover:bg-zinc-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-zinc-500">📂</span>
                    グループなし
                  </span>
                  {currentGroup === null && <span className="text-blue-400 text-xs">✓</span>}
                </button>

                {/* 既存グループ一覧 */}
                {groups.map((g) => {
                  const count = accounts.filter(a => a.group_name === g.name).length
                  const isCurrent = currentGroup === g.name
                  return (
                    <button
                      key={g.id}
                      onClick={() => { onUpdateGroup(groupEdit.accountId, g.name); setGroupEdit(null) }}
                      className={`w-full flex items-center justify-between px-5 py-2 text-sm transition-colors ${
                        isCurrent
                          ? 'bg-blue-600/20 text-blue-300'
                          : 'text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-zinc-500">📁</span>
                        <span className="font-medium">{g.name}</span>
                        <span className="text-[10px] text-zinc-500">({count})</span>
                      </span>
                      {isCurrent && <span className="text-blue-400 text-xs">✓</span>}
                    </button>
                  )
                })}

                {/* 新規グループ */}
                {!newGroupInlineInput ? (
                  <button
                    onClick={() => setNewGroupInlineInput(true)}
                    className="w-full flex items-center gap-2 px-5 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors border-t border-zinc-800 mt-1.5"
                  >
                    <span className="text-zinc-500">＋</span>
                    新規グループを作成
                  </button>
                ) : (
                  <div className="px-5 py-2 border-t border-zinc-800 mt-1.5 flex gap-1.5">
                    <input
                      autoFocus
                      value={newGroupInlineValue}
                      onChange={(e) => setNewGroupInlineValue(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          const name = newGroupInlineValue.trim()
                          if (!name) return
                          const r = await api.groups.create(name)
                          if (r.success) setGroups(prev => [...prev, r.group])
                          onUpdateGroup(groupEdit.accountId, name)
                          setGroupEdit(null); setNewGroupInlineInput(false); setNewGroupInlineValue('')
                        }
                        if (e.key === 'Escape') { setNewGroupInlineInput(false); setNewGroupInlineValue('') }
                      }}
                      placeholder="グループ名..."
                      className="flex-1 px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 placeholder-zinc-600"
                    />
                    <button
                      onClick={async () => {
                        const name = newGroupInlineValue.trim()
                        if (!name) return
                        const r = await api.groups.create(name)
                        if (r.success) setGroups(prev => [...prev, r.group])
                        onUpdateGroup(groupEdit.accountId, name)
                        setGroupEdit(null); setNewGroupInlineInput(false); setNewGroupInlineValue('')
                      }}
                      className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors"
                    >
                      作成
                    </button>
                  </div>
                )}
              </div>

              <div className="px-5 py-3 border-t border-zinc-800 flex justify-end">
                <button
                  onClick={() => { setGroupEdit(null); setNewGroupInlineInput(false); setNewGroupInlineValue('') }}
                  className="px-3 py-1.5 text-zinc-400 hover:text-white text-xs transition-colors"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
