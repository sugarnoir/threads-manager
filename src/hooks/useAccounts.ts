import { useState, useEffect, useCallback } from 'react'
import { api, Account } from '../lib/ipc'

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const data = await api.accounts.list()
    setAccounts(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Sidebar の CSV/Cookie インポートからのアカウント一覧更新イベント
  useEffect(() => {
    const handler = () => { refresh() }
    window.addEventListener('accounts-changed', handler)
    return () => window.removeEventListener('accounts-changed', handler)
  }, [refresh])

  useEffect(() => {
    const unsubChallenge = api.on('accounts:challenge-detected', (data) => {
      const { account_id } = data as { account_id: number }
      setAccounts((prev) =>
        prev.map((a) => (a.id === account_id ? { ...a, status: 'challenge' as const } : a))
      )
    })
    const unsubFollower = api.on('accounts:follower-count-updated', (data) => {
      const { account_id, follower_count, follower_count_prev } = data as { account_id: number; follower_count: number; follower_count_prev: number | null }
      setAccounts((prev) =>
        prev.map((a) => (a.id === account_id ? { ...a, follower_count, follower_count_prev } : a))
      )
    })
    const unsubExpired = api.on('accounts:session-expired', (data) => {
      const { account_id } = data as { account_id: number }
      setAccounts((prev) =>
        prev.map((a) => (a.id === account_id ? { ...a, status: 'needs_login' as const } : a))
      )
    })
    return () => { unsubChallenge?.(); unsubFollower?.(); unsubExpired?.() }
  }, [])

  const addAccount = async (options?: {
    proxy_url?: string
    proxy_username?: string
    proxy_password?: string
  }) => {
    const result = await api.accounts.add(options)
    if (result.success) {
      await refresh()
    }
    return result
  }

  const registerAccount = async (options?: {
    proxy_url?: string
    proxy_username?: string
    proxy_password?: string
  }) => {
    const result = await api.accounts.register(options)
    if (result.success) {
      await refresh()
    }
    return result
  }

  const updateProxy = async (data: {
    id: number
    proxy_url: string | null
    proxy_username: string | null
    proxy_password: string | null
  }) => {
    const result = await api.accounts.updateProxy(data)
    if (result.success && result.account) {
      setAccounts((prev) =>
        prev.map((a) => (a.id === data.id ? (result.account as Account) : a))
      )
    }
    return result
  }

  const deleteAccount = async (id: number) => {
    await api.accounts.delete(id)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  const checkStatus = async (id: number) => {
    const result = await api.accounts.check(id)
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, status: result.status as Account['status'] } : a
      )
    )
    return result
  }

  const checkAllAccounts = async (
    onProgress?: (data: { type: string; accountId?: number; status?: string; message?: string; index?: number; total?: number }) => void
  ) => {
    const unsub = onProgress
      ? api.on('accounts:check-progress', (data) => {
          const d = data as { type: string; accountId?: number; status?: string; message?: string; index?: number; total?: number }
          onProgress(d)
          // Update account status in state on each result
          if (d.type === 'result' && d.accountId && d.status) {
            setAccounts((prev) =>
              prev.map((a) => a.id === d.accountId ? { ...a, status: d.status as Account['status'] } : a)
            )
          }
        })
      : null
    try {
      await api.accounts.checkAll()
    } finally {
      unsub?.()
    }
  }

  const updateDisplayName = async (id: number, display_name: string | null) => {
    await api.accounts.updateDisplayName({ id, display_name })
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, display_name } : a))
    )
  }

  const updateGroup = async (id: number, group_name: string | null) => {
    await api.accounts.updateGroup({ id, group_name })
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, group_name } : a))
    )
  }

  const updateMemo = async (id: number, memo: string | null) => {
    await api.accounts.updateMemo({ id, memo })
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, memo } : a))
    )
  }

  const updateSpeedPreset = async (id: number, speed_preset: 'slow' | 'normal' | 'fast') => {
    await api.accounts.updateSpeedPreset({ id, speed_preset })
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, speed_preset } : a))
    )
  }

  const clearCookies = async (id: number) => {
    await api.accounts.clearCookies(id)
  }

  const resetSession = async (id: number) => {
    await api.accounts.resetSession(id)
    setAccounts((prev) =>
      prev.map((a) => a.id === id ? { ...a, status: 'needs_login' as const } : a)
    )
  }

  const reorderAccounts = (updates: { id: number; sort_order: number; group_name: string | null }[]) => {
    // Optimistic update
    setAccounts((prev) => {
      const map = new Map(updates.map((u) => [u.id, u]))
      return prev
        .map((a) => {
          const u = map.get(a.id)
          return u ? { ...a, sort_order: u.sort_order, group_name: u.group_name } : a
        })
        .sort((a, b) => a.sort_order - b.sort_order)
    })
    // Persist
    api.accounts.reorder(updates)
  }

  return { accounts, loading, refresh, addAccount, registerAccount, updateProxy, updateDisplayName, updateGroup, updateMemo, updateSpeedPreset, clearCookies, resetSession, reorderAccounts, deleteAccount, checkStatus, checkAllAccounts }
}
