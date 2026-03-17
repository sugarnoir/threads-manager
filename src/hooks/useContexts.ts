import { useState, useEffect, useCallback } from 'react'
import { api, ContextInfo } from '../lib/ipc'

export function useContexts() {
  const [contextInfos, setContextInfos] = useState<ContextInfo[]>([])

  const refresh = useCallback(async () => {
    const infos = await api.contexts.list()
    setContextInfos(infos)
  }, [])

  useEffect(() => {
    refresh()
    // メインプロセスからのリアルタイム通知を受け取る
    const unsub = api.on('contexts:status-changed', (data: unknown) => {
      setContextInfos(data as ContextInfo[])
    })
    return unsub
  }, [refresh])

  const openBrowser = async (accountId: number) => {
    await api.contexts.open(accountId)
  }

  const closeBrowser = async (accountId: number) => {
    await api.contexts.close(accountId)
  }

  const getInfo = (accountId: number): ContextInfo | undefined =>
    contextInfos.find((c) => c.accountId === accountId)

  return { contextInfos, openBrowser, closeBrowser, getInfo }
}
