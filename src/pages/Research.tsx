import { useState, useMemo } from 'react'
import { Account, api } from '../lib/ipc'

function parseCount(v: string | number): number {
  if (typeof v === 'number') return v
  const s = v.replace(/,/g, '')
  if (/万/.test(s)) return Math.round(parseFloat(s) * 10000)
  if (/[kK]/.test(s)) return Math.round(parseFloat(s) * 1000)
  if (/[mM]/.test(s)) return Math.round(parseFloat(s) * 1000000)
  return parseInt(s.replace(/\D/g, '')) || 0
}

interface Props {
  accounts: Account[]
  selectedAccountId: number | null
}

type Tab = 'hashtag' | 'account' | 'keyword' | 'competitive' | 'debug'

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: 'hashtag',     label: 'ハッシュタグ', desc: 'トレンドタグを調査' },
  { id: 'account',     label: 'アカウント分析', desc: 'フォロワー・投稿を分析' },
  { id: 'keyword',     label: 'キーワード検索', desc: '投稿を検索' },
  { id: 'competitive', label: 'コンペ分析',     desc: '人気投稿ランキング' },
  { id: 'debug',       label: '🔧 DEBUG',       desc: 'DOM構造確認' },
]

// ── Hashtag tab ───────────────────────────────────────────────────────────────

function HashtagTab({ accountId }: { accountId: number | null }) {
  const [query, setQuery]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [result, setResult]   = useState<{ hashtag: string; topPosts: { text: string; likes: string; url: string }[] } | null>(null)
  const [sort, setSort]       = useState<'default' | 'likes'>('default')

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accountId || !query.trim()) return
    setLoading(true)
    setError(null)
    const res = await api.research.hashtag({ accountId, hashtag: query.trim() })
    setLoading(false)
    if (res.success) setResult(res.data)
    else setError(res.error ?? '取得に失敗しました')
  }

  const sorted = useMemo(() => {
    if (!result) return []
    const posts = [...result.topPosts]
    if (sort === 'likes') posts.sort((a, b) => parseCount(b.likes) - parseCount(a.likes))
    return posts
  }, [result, sort])

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="#ハッシュタグ を入力..."
          disabled={!accountId || loading}
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 rounded-lg text-white text-sm placeholder-zinc-600 outline-none transition-all disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={!accountId || loading || !query.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          調査
        </button>
      </form>

      {loading && <LoadingBox label="ハッシュタグを調査中..." />}
      {!loading && error && <ErrorBox message={error} />}

      {!loading && result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-blue-400 font-bold text-lg">{result.hashtag}</span>
            {result.topPosts.length > 0 && (
              <SortSelect
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'default', label: 'デフォルト' },
                  { value: 'likes',   label: 'いいね順' },
                ]}
              />
            )}
          </div>
          {sorted.length === 0 ? (
            <p className="text-zinc-500 text-sm">投稿が見つかりませんでした</p>
          ) : (
            <div className="space-y-2">
              {sorted.map((p, i) => (
                <PostCard key={i} text={p.text} likes={p.likes} url={p.url} />
              ))}
            </div>
          )}
        </div>
      )}

      {!accountId && <NoAccountNotice />}
    </div>
  )
}

// ── Account analysis tab ──────────────────────────────────────────────────────

function AccountTab({ accountId }: { accountId: number | null }) {
  const [query, setQuery]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [result, setResult]   = useState<{
    username: string
    displayName: string | null
    bio: string | null
    followerCount: string | null
    avgLikes: number | null
    recentPosts: { text: string; likes: string; replies: string; reposts: string; url: string }[]
  } | null>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accountId || !query.trim()) return
    setLoading(true)
    setError(null)
    const res = await api.research.account({ accountId, targetUsername: query.trim() })
    setLoading(false)
    if (res.success) setResult(res.data)
    else setError(res.error ?? '取得に失敗しました')
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="@ユーザー名 を入力..."
          disabled={!accountId || loading}
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 rounded-lg text-white text-sm placeholder-zinc-600 outline-none transition-all disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={!accountId || loading || !query.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          分析
        </button>
      </form>

      {loading && <LoadingBox label="アカウントを分析中..." />}
      {!loading && error && <ErrorBox message={error} />}

      {!loading && result && (
        <div className="space-y-4">
          {/* Profile card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-white font-bold text-base">{result.displayName ?? `@${result.username}`}</p>
                <p className="text-zinc-500 text-sm">@{result.username}</p>
              </div>
              {result.followerCount && (
                <div className="text-right shrink-0">
                  <p className="text-white font-bold text-lg">{result.followerCount}</p>
                  <p className="text-zinc-500 text-xs">フォロワー</p>
                </div>
              )}
            </div>
            {result.bio && <p className="text-zinc-300 text-sm">{result.bio}</p>}
            {result.avgLikes !== null && (
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-zinc-500 text-xs">平均いいね</span>
                <span className="text-pink-400 font-bold text-sm">{result.avgLikes.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Recent posts */}
          {result.recentPosts.length > 0 && (
            <div className="space-y-2">
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">最近の投稿</p>
              {result.recentPosts.map((p, i) => (
                <PostCard key={i} text={p.text} likes={p.likes} replies={p.replies} reposts={p.reposts} url={p.url} />
              ))}
            </div>
          )}
        </div>
      )}

      {!accountId && <NoAccountNotice />}
    </div>
  )
}

// ── Keyword search tab ────────────────────────────────────────────────────────

type KeywordSort = 'default' | 'likes' | 'reposts' | 'replies' | 'newest'

function KeywordTab({ accountId }: { accountId: number | null }) {
  const [query, setQuery]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [results, setResults] = useState<{
    username: string; text: string; likes: string; replies: string
    reposts: string; url: string; timestamp: string | null
  }[] | null>(null)
  const [sort, setSort] = useState<KeywordSort>('default')

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accountId || !query.trim()) return
    setLoading(true)
    setError(null)
    const res = await api.research.keyword({ accountId, keyword: query.trim() })
    setLoading(false)
    if (res.success) setResults(res.data)
    else setError(res.error ?? '取得に失敗しました')
  }

  const sorted = useMemo(() => {
    if (!results) return []
    const arr = [...results]
    if (sort === 'likes')   arr.sort((a, b) => parseCount(b.likes)   - parseCount(a.likes))
    if (sort === 'reposts') arr.sort((a, b) => parseCount(b.reposts) - parseCount(a.reposts))
    if (sort === 'replies') arr.sort((a, b) => parseCount(b.replies) - parseCount(a.replies))
    if (sort === 'newest')  arr.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
    return arr
  }, [results, sort])

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="キーワードを入力..."
          disabled={!accountId || loading}
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 rounded-lg text-white text-sm placeholder-zinc-600 outline-none transition-all disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={!accountId || loading || !query.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          検索
        </button>
      </form>

      {loading && <LoadingBox label="投稿を検索中..." />}
      {!loading && error && <ErrorBox message={error} />}

      {!loading && results !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-zinc-500 text-xs">{results.length} 件の投稿</p>
            {results.length > 0 && (
              <SortSelect
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'default', label: 'デフォルト' },
                  { value: 'likes',   label: 'いいね順' },
                  { value: 'reposts', label: 'リポスト順' },
                  { value: 'replies', label: '返信順' },
                  { value: 'newest',  label: '新しい順' },
                ]}
              />
            )}
          </div>
          {sorted.length === 0 ? (
            <p className="text-zinc-500 text-sm">投稿が見つかりませんでした</p>
          ) : (
            sorted.map((p, i) => (
              <PostCard
                key={i}
                username={p.username}
                text={p.text}
                likes={p.likes}
                replies={p.replies}
                reposts={p.reposts}
                url={p.url}
                timestamp={p.timestamp}
              />
            ))
          )}
        </div>
      )}

      {!accountId && <NoAccountNotice />}
    </div>
  )
}

// ── Competitive analysis tab ──────────────────────────────────────────────────

type CompetitiveSort = 'score' | 'likes' | 'reposts' | 'replies'

function CompetitiveTab({ accountId }: { accountId: number | null }) {
  const [query, setQuery]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [results, setResults] = useState<{
    username: string; text: string; likes: number; reposts: number
    replies: number; url: string; score: number
  }[] | null>(null)
  const [sort, setSort] = useState<CompetitiveSort>('score')

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accountId || !query.trim()) return
    setLoading(true)
    setError(null)
    const res = await api.research.competitive({ accountId, keyword: query.trim() })
    setLoading(false)
    if (res.success) setResults(res.data)
    else setError(res.error ?? '取得に失敗しました')
  }

  const sorted = useMemo(() => {
    if (!results) return []
    const arr = [...results]
    if (sort === 'score')   arr.sort((a, b) => b.score   - a.score)
    if (sort === 'likes')   arr.sort((a, b) => b.likes   - a.likes)
    if (sort === 'reposts') arr.sort((a, b) => b.reposts - a.reposts)
    if (sort === 'replies') arr.sort((a, b) => b.replies - a.replies)
    return arr
  }, [results, sort])

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="キーワードを入力..."
          disabled={!accountId || loading}
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 rounded-lg text-white text-sm placeholder-zinc-600 outline-none transition-all disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={!accountId || loading || !query.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          分析
        </button>
      </form>

      {loading && <LoadingBox label="コンペ投稿を分析中..." />}
      {!loading && error && <ErrorBox message={error} />}

      {!loading && results !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-zinc-500 text-xs">{results.length} 件</p>
            {results.length > 0 && (
              <SortSelect
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'score',   label: 'エンゲージメント順' },
                  { value: 'likes',   label: 'いいね順' },
                  { value: 'reposts', label: 'リポスト順' },
                  { value: 'replies', label: '返信順' },
                ]}
              />
            )}
          </div>
          {sorted.length === 0 ? (
            <p className="text-zinc-500 text-sm">投稿が見つかりませんでした</p>
          ) : (
            sorted.map((p, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-zinc-600 font-bold text-sm w-6 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    {p.username && (
                      <p className="text-zinc-400 text-xs mb-1">@{p.username}</p>
                    )}
                    <p className="text-zinc-200 text-sm leading-relaxed line-clamp-3">{p.text}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 pl-8">
                  <Stat label="いいね" value={p.likes} color="text-pink-400" />
                  <Stat label="リポスト" value={p.reposts} color="text-green-400" />
                  <Stat label="返信" value={p.replies} color="text-zinc-400" />
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-zinc-600 hover:text-blue-400 text-[11px] transition-colors"
                      onClick={(e) => { e.preventDefault(); api.browserView.navigate(-1 as unknown as number, p.url) }}
                    >
                      開く →
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {!accountId && <NoAccountNotice />}
    </div>
  )
}

// ── Shared components ─────────────────────────────────────────────────────────

function SortSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 text-xs outline-none focus:border-blue-500 cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function PostCard({
  username,
  text,
  likes,
  replies,
  reposts,
  url,
  timestamp,
}: {
  username?: string
  text: string
  likes?: string
  replies?: string
  reposts?: string
  url?: string
  timestamp?: string | null
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
      {username && <p className="text-zinc-400 text-xs">@{username}</p>}
      <p className="text-zinc-200 text-sm leading-relaxed line-clamp-3">{text}</p>
      <div className="flex items-center gap-3">
        {likes !== undefined && <Stat label="いいね" value={likes} color="text-pink-400" />}
        {reposts !== undefined && <Stat label="リポスト" value={reposts} color="text-green-400" />}
        {replies !== undefined && <Stat label="返信" value={replies} color="text-zinc-400" />}
        {timestamp && (
          <span className="ml-auto text-zinc-700 text-[10px]">
            {new Date(timestamp).toLocaleDateString('ja-JP')}
          </span>
        )}
        {!timestamp && url && (
          <span className="ml-auto" />
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  const num = typeof value === 'string' ? value : value.toLocaleString()
  return (
    <div className="flex items-center gap-1">
      <span className={`font-bold text-xs ${color}`}>{num}</span>
      <span className="text-zinc-600 text-[10px]">{label}</span>
    </div>
  )
}

function LoadingBox({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-zinc-400">
      <span className="w-6 h-6 border-2 border-zinc-600 border-t-blue-400 rounded-full animate-spin" />
      <div className="text-center">
        <p className="text-sm">{label}</p>
        <p className="text-xs text-zinc-600 mt-1">Playwrightでページを取得中... 最大30秒かかります</p>
      </div>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  const isTimeout = message.includes('タイムアウト') || message.includes('Timeout') || message.includes('timeout')
  return (
    <div className={`px-4 py-3 rounded-xl text-sm space-y-1 ${isTimeout ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
      <p className="font-semibold">{isTimeout ? '⏱ タイムアウト' : 'エラー'}</p>
      <p className="text-xs opacity-80">{message}</p>
      {isTimeout && (
        <p className="text-xs opacity-60 mt-1">Threadsのサーバーが応答しなかった可能性があります。しばらく待ってから再試行してください。</p>
      )}
    </div>
  )
}

function NoAccountNotice() {
  return (
    <p className="text-zinc-600 text-sm text-center py-4">
      左のサイドバーからアカウントを選択してください
    </p>
  )
}

// ── Debug tab ─────────────────────────────────────────────────────────────────

function DebugTab({ accountId }: { accountId: number | null }) {
  const [query, setQuery]     = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<string | null>(null)

  const handleDebug = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accountId || !query.trim()) return
    setLoading(true)
    setResult('実行中...')
    try {
      const res = await api.research.debug({ accountId, keyword: query.trim() })
      setResult(JSON.stringify(res, null, 2))
    } catch (err) {
      setResult(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-amber-400 text-xs">DOM構造デバッグ（開発用）</p>
      <form onSubmit={handleDebug} className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="キーワード"
          disabled={!accountId || loading}
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-600 outline-none disabled:opacity-40" />
        <button type="submit" disabled={!accountId || loading || !query.trim()}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg">
          調査
        </button>
      </form>
      {loading && <LoadingBox label="DOM情報を取得中... (5秒待機)" />}
      {result && (
        <pre className="text-[10px] text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-lg p-3 overflow-auto max-h-96 whitespace-pre-wrap break-all">
          {result}
        </pre>
      )}
      {!accountId && <NoAccountNotice />}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function Research({ accounts: _accounts, selectedAccountId }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('hashtag')

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex gap-1 px-1 pb-3 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg text-center transition-all text-[11px] ${
              activeTab === tab.id
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <span className="font-semibold">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'hashtag'     && <HashtagTab     accountId={selectedAccountId} />}
        {activeTab === 'account'     && <AccountTab     accountId={selectedAccountId} />}
        {activeTab === 'keyword'     && <KeywordTab     accountId={selectedAccountId} />}
        {activeTab === 'competitive' && <CompetitiveTab accountId={selectedAccountId} />}
        {activeTab === 'debug'       && <DebugTab       accountId={selectedAccountId} />}
      </div>
    </div>
  )
}
