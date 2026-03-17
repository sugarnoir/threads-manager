import { useState, useCallback } from 'react'
import { api, Post } from '../lib/ipc'

export function usePosts(accountId: number | null) {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(false)

  const fetchPosts = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    const data = await api.posts.list(accountId)
    setPosts(data)
    setLoading(false)
  }, [accountId])

  return { posts, loading, fetchPosts }
}
