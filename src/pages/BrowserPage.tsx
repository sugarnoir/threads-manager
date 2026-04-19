import { useState, useEffect, useRef, useCallback } from 'react'
import { api, Account, ViewInfo } from '../lib/ipc'

interface Props {
  accounts: Account[]
  activeAccountId: number | null
  isVisible: boolean
}

export function BrowserPage({ accounts, activeAccountId, isVisible }: Props) {
  const [viewInfos, setViewInfos] = useState<ViewInfo[]>([])
  const [urlInput, setUrlInput]   = useState('')
  const containerRef   = useRef<HTMLDivElement>(null)
  const setBoundsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null
  const activeInfo    = viewInfos.find((v) => v.accountId === activeAccountId) ?? null

  // ── View info sync ──────────────────────────────────────────────────────

  useEffect(() => {
    api.browserView.list().then(setViewInfos)
    const unsub = api.on('browserView:changed', (data) => {
      setViewInfos(data as ViewInfo[])
    })
    return unsub
  }, [])

  useEffect(() => {
    if (activeInfo?.url && activeInfo.url !== 'about:blank') setUrlInput(activeInfo.url)
  }, [activeInfo?.url])

  // ── Bounds management ───────────────────────────────────────────────────

  // x と width はメインプロセス側で計算するため、y と height のみ取得する
  const getYHeight = useCallback(() => {
    if (!containerRef.current) return null
    const r = containerRef.current.getBoundingClientRect()
    if (r.height === 0) return null
    return { y: Math.round(r.y), height: Math.round(r.height) }
  }, [])

  useEffect(() => {
    if (!isVisible || activeAccountId === null) return
    let cancelled = false
    let frameId: number

    const tryShow = () => {
      if (cancelled) return
      const b = getYHeight()
      if (b) {
        api.browserView.show(activeAccountId, b.y, b.height)
      } else {
        frameId = requestAnimationFrame(tryShow)
      }
    }

    frameId = requestAnimationFrame(tryShow)
    return () => { cancelled = true; cancelAnimationFrame(frameId) }
  }, [isVisible, activeAccountId, getYHeight])

  useEffect(() => {
    if (!isVisible && activeAccountId !== null) api.browserView.hide(activeAccountId)
  }, [isVisible, activeAccountId])

  useEffect(() => {
    if (!isVisible || activeAccountId === null) return
    const update = () => {
      if (setBoundsTimer.current) clearTimeout(setBoundsTimer.current)
      setBoundsTimer.current = setTimeout(() => {
        const b = getYHeight()
        if (b) api.browserView.setBounds(activeAccountId, b.y, b.height)
      }, 32)
    }
    const ro = new ResizeObserver(update)
    if (containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      if (setBoundsTimer.current) clearTimeout(setBoundsTimer.current)
    }
  }, [isVisible, activeAccountId, getYHeight])

  // ── Navigation ──────────────────────────────────────────────────────────

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    if (activeAccountId === null) return
    let url = urlInput.trim()
    if (!url.startsWith('http')) url = `https://${url}`
    api.browserView.navigate(activeAccountId, url)
  }

  // ── Proxy display ───────────────────────────────────────────────────────

  function proxyBadge(account: Account | null) {
    if (!account?.proxy_url) return null
    const m = account.proxy_url.match(/^(https?|socks5):\/\/([^:]+):(\d+)/)
    if (!m) return null
    return { type: m[1].toUpperCase(), host: m[2], port: m[3] }
  }

  const proxy = proxyBadge(activeAccount)

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">

      {/* ── macOS drag area ──────────────────────────────────────────────── */}
      <div
        className="h-9 shrink-0 bg-zinc-950"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* ── Proxy / account info bar ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-1.5 bg-zinc-900/80 border-b border-zinc-800 shrink-0 min-h-[36px]">
        {activeAccount ? (
          <>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-zinc-400 text-xs font-medium">@{activeAccount.username}</span>
            </div>

            <div className="w-px h-3 bg-zinc-700 shrink-0" />

            {proxy ? (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[11px] font-mono font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                  {proxy.type}
                </span>
                <span className="text-zinc-500 text-[11px] font-mono">{proxy.host}:{proxy.port}</span>
                {activeAccount.proxy_username && (
                  <span className="text-zinc-600 text-[10px]">({activeAccount.proxy_username})</span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[11px] font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  直接接続
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="text-zinc-600 text-xs">アカウントを選択</p>
        )}
      </div>

      {/* ── URL / nav bar ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
        {[
          { label: '‹', title: '戻る',       disabled: !activeInfo?.canGoBack,    action: () => activeAccountId && api.browserView.back(activeAccountId) },
          { label: '›', title: '進む',       disabled: !activeInfo?.canGoForward, action: () => activeAccountId && api.browserView.forward(activeAccountId) },
          { label: '↻', title: '再読み込み', disabled: !activeAccountId,          action: () => activeAccountId && api.browserView.reload(activeAccountId) },
        ].map((btn) => (
          <button
            key={btn.title}
            onClick={btn.action}
            disabled={btn.disabled}
            title={btn.title}
            className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-25 transition-colors text-base leading-none"
          >
            {btn.label}
          </button>
        ))}

        {/* Threads / Instagram 切り替え（同一セッションなのでログイン状態は維持される） */}
        {(() => {
          const url = activeInfo?.url ?? ''
          const isInstagram = url.includes('instagram.com')
          const isThreads   = url.includes('threads.com') || url.includes('threads.net')
          return (
            <div className="flex items-center bg-zinc-800 rounded-md p-0.5 ml-1 mr-1">
              <button
                onClick={() => activeAccountId && api.browserView.navigate(activeAccountId, 'https://www.threads.com/')}
                disabled={!activeAccountId}
                title="Threads に切り替え"
                className={`px-2 py-1 rounded text-[11px] font-semibold leading-none transition-colors disabled:opacity-30 ${
                  isThreads
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Threads
              </button>
              <button
                onClick={() => activeAccountId && api.browserView.navigate(activeAccountId, 'https://www.instagram.com/')}
                disabled={!activeAccountId}
                title="Instagram に切り替え"
                className={`px-2 py-1 rounded text-[11px] font-semibold leading-none transition-colors disabled:opacity-30 ${
                  isInstagram
                    ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                IG
              </button>
            </div>
          )
        })()}

        <form onSubmit={handleNavigate} className="flex-1 mx-1">
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder={activeAccountId ? 'URLを入力して Enter...' : 'アカウントを選択してください'}
            disabled={!activeAccountId}
            className="w-full px-3 py-1.5 bg-zinc-800 text-zinc-200 text-xs rounded-lg border border-zinc-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-30 placeholder-zinc-600 transition-all"
          />
        </form>

        {activeInfo?.title && (
          <span className="text-zinc-600 text-[11px] truncate max-w-28 hidden sm:block" title={activeInfo.title}>
            {activeInfo.title}
          </span>
        )}
      </div>

      {/* ── Browser area ─────────────────────────────────────────────────── */}
      <div ref={containerRef} className="flex-1 bg-zinc-950">
        {!activeAccountId && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-700 gap-4">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" className="opacity-40">
              <rect width="56" height="56" rx="16" fill="url(#g)" />
              <text x="50%" y="56%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="28" fontWeight="900">T</text>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#ec4899" />
                  <stop offset="0.5" stopColor="#a855f7" />
                  <stop offset="1" stopColor="#6366f1" />
                </linearGradient>
              </defs>
            </svg>
            <div className="text-center">
              <p className="text-zinc-400 text-sm font-medium">Threads Manager</p>
              <p className="text-zinc-600 text-xs mt-1">左のサイドバーからアカウントを選択</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
