import { useState, useEffect } from 'react'
import { api, Post, Account } from '../lib/ipc'
import { StatusBadge } from '../components/StatusBadge'

interface Props {
  accounts: Account[]
  selectedAccountId: number | null
}

export function History({ accounts, selectedAccountId }: Props) {
  const [posts, setPosts] = useState<Post[]>([])
  const [filterAccountId, setFilterAccountId] = useState<number | null>(selectedAccountId)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!filterAccountId) return
    setLoading(true)
    api.posts.list(filterAccountId).then((data) => {
      setPosts(data)
      setLoading(false)
    })
  }, [filterAccountId])

  return (
    <div className="h-full flex flex-col gap-4">
      <h2 className="text-lg font-bold text-gray-800">投稿履歴</h2>

      <select
        value={filterAccountId ?? ''}
        onChange={(e) => setFilterAccountId(Number(e.target.value) || null)}
        className="border border-gray-200 rounded-lg p-2 text-sm"
      >
        <option value="">アカウントを選択</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.username}
          </option>
        ))}
      </select>

      <div className="flex-1 overflow-y-auto space-y-2">
        {loading ? (
          <p className="text-center text-gray-400 text-sm mt-8">読み込み中...</p>
        ) : posts.length === 0 ? (
          <p className="text-center text-gray-400 text-sm mt-8">
            {filterAccountId ? '投稿履歴がありません' : 'アカウントを選択してください'}
          </p>
        ) : (
          posts.map((post) => (
            <div
              key={post.id}
              className="bg-white border border-gray-200 rounded-xl p-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <StatusBadge status={post.status} />
                <span className="text-xs text-gray-400">
                  {post.posted_at
                    ? new Date(post.posted_at).toLocaleString('ja-JP')
                    : new Date(post.created_at).toLocaleString('ja-JP')}
                </span>
              </div>
              <p className="text-sm text-gray-800">{post.content}</p>
              {post.error_msg && (
                <p className="text-xs text-red-500 mt-1">{post.error_msg}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
