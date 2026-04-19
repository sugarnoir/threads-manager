import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'

interface ProxyOptions {
  proxy_url:      string
  proxy_username: string
  proxy_password: string
}

interface Props {
  proxy:            ProxyOptions | null
  onAccountReady:   (newAccountId: number) => void   // ログイン成功直後にブラウザビューを表示するため
  onComplete:       (newAccountId: number) => void   // 完了時にサイドバーに反映
  onCancel:         () => void
}

type Step =
  | 'logging_in'        // accounts:add 実行中（IGログイン）
  | 'login_failed'      // ログイン失敗
  | 'name_change'       // プロフィール編集中（手動）
  | 'threads_create'    // Threads作成中（手動）
  | 'completing'        // 完了処理中
  | 'done'              // 完了

/**
 * 「既存Instagramから作成」ウィザード。
 *
 * 流れ:
 *   1) accounts:add IPC で IG ログインウィンドウを開く（プロキシ・iPhone UA 適用済み）
 *   2) ログイン成功 → サイドバーには反映せず、内部で accountId を保持
 *   3) ブラウザビューを開き instagram.com/accounts/edit/ へ遷移（手動でプロフィール名変更）
 *   4) 「次へ」で threads.net へ遷移（手動で Threads 作成）
 *   5) 「完了」でサイドバー更新（onComplete）してウィザード終了
 *
 * Step 3 以降はフルスクリーンモーダルではなく、画面右上に小さく浮かぶパネルとして表示し、
 * ブラウザビューを操作可能にする。
 */
export function SetupWizardOverlay({ proxy, onAccountReady, onComplete, onCancel }: Props) {
  const [step, setStep]               = useState<Step>('logging_in')
  const [error, setError]             = useState<string | null>(null)
  const [accountId, setAccountId]     = useState<number | null>(null)
  const [accountUsername, setAccountUsername] = useState<string | null>(null)

  // 起動時に IG ログインを開始
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.accounts.add({
          login_site: 'instagram',
          ...(proxy ? {
            proxy_url:      proxy.proxy_url,
            proxy_username: proxy.proxy_username,
            proxy_password: proxy.proxy_password,
          } : {}),
        })
        if (cancelled) return

        if (!res.success || !res.account) {
          setError(res.error ?? 'Instagramログインに失敗しました')
          setStep('login_failed')
          return
        }

        const acct = res.account
        setAccountId(acct.id)
        setAccountUsername(acct.username)

        // bot 検知緩和のため少し待機してからブラウザビューを開く
        await new Promise(r => setTimeout(r, 5000))
        if (cancelled) return

        // 親に通知してブラウザビューを表示状態にする（activeAccountId 設定）
        onAccountReady(acct.id)
        // ブラウザビュー初期化を待つ
        await new Promise(r => setTimeout(r, 500))
        if (cancelled) return

        // プロフィール編集ページへ遷移
        await api.browserView.navigate(acct.id, 'https://www.instagram.com/accounts/edit/')
        if (cancelled) return

        setStep('name_change')
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStep('login_failed')
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleNext = async () => {
    if (!accountId) return
    try {
      await api.browserView.navigate(accountId, 'https://www.threads.net/')
      setStep('threads_create')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleComplete = async () => {
    if (!accountId) return
    setStep('completing')
    try {
      // ステータスを active に更新（Cookie が取れていれば did-navigate でも更新されているが念のため）
      await api.accounts.check(accountId).catch(() => {})
      setStep('done')
      onComplete(accountId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('done')
      onComplete(accountId)  // エラーでもアカウントは作成済みなのでサイドバーには反映
    }
  }

  // ── レンダリング ────────────────────────────────────────────────────────
  // step によってモーダル全画面 / フローティングパネルを切り替え

  const isFullScreen = step === 'logging_in' || step === 'login_failed'

  if (isFullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[440px] p-6 space-y-4">
          <div>
            <h3 className="text-white font-bold text-sm">初期設定ウィザード</h3>
            <p className="text-zinc-500 text-xs mt-1">既存Instagramからアカウントを作成</p>
          </div>

          {step === 'logging_in' && (
            <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-zinc-800/60 border border-zinc-700">
              <span className="w-4 h-4 border-2 border-zinc-500 border-t-violet-400 rounded-full animate-spin shrink-0" />
              <div>
                <p className="text-white text-xs font-medium">Step 1 / 3 — Instagramでログイン</p>
                <p className="text-zinc-500 text-[10px] mt-0.5 leading-tight">
                  別ウィンドウで開いたInstagramにログインしてください。<br />
                  プロキシ・iPhone UA は適用済みです。
                </p>
              </div>
            </div>
          )}

          {step === 'login_failed' && (
            <>
              <div className="px-3 py-3 rounded-lg bg-red-500/10 border border-red-500/30">
                <p className="text-red-400 text-xs font-medium">✗ ログインに失敗しました</p>
                {error && <p className="text-red-300/80 text-[10px] mt-1 leading-tight break-all">{error}</p>}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={onCancel}
                  className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs rounded-lg transition-colors"
                >
                  閉じる
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // フローティングパネル（ブラウザビューと共存）
  return (
    <div
      className="fixed top-14 right-4 z-40 w-80 bg-zinc-900/95 backdrop-blur border border-violet-500/40 rounded-xl shadow-2xl shadow-black/60"
      style={{ boxShadow: '0 12px 40px -8px rgba(0,0,0,0.6)' }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-violet-300 text-[11px] font-bold tracking-wide">🧭 初期設定ウィザード</span>
        <button
          onClick={onCancel}
          title="ウィザードを閉じる（アカウントは保持）"
          className="text-zinc-500 hover:text-white text-xs leading-none"
        >
          ✕
        </button>
      </div>

      {/* アカウント情報 */}
      {accountUsername && (
        <div className="px-3 py-2 border-b border-zinc-800 text-[10px] text-zinc-400">
          <span className="text-zinc-500">対象: </span>
          <span className="font-mono text-zinc-200">@{accountUsername}</span>
        </div>
      )}

      <div className="p-3 space-y-3">
        {step === 'name_change' && (
          <>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">2</span>
              <div>
                <p className="text-white text-xs font-medium">プロフィール名を変更</p>
                <p className="text-zinc-500 text-[10px] mt-0.5 leading-tight">
                  ブラウザに <span className="text-zinc-300 font-mono">accounts/edit/</span> を開きました。<br />
                  名前を変更・保存したら「次へ」を押してください。
                </p>
              </div>
            </div>
            <button
              onClick={handleNext}
              className="w-full py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              次へ → Threads作成
            </button>
          </>
        )}

        {step === 'threads_create' && (
          <>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">3</span>
              <div>
                <p className="text-white text-xs font-medium">Threadsアカウントを作成</p>
                <p className="text-zinc-500 text-[10px] mt-0.5 leading-tight">
                  ブラウザに <span className="text-zinc-300 font-mono">threads.net</span> を開きました。<br />
                  プロフィール作成が終わったら「完了」を押してください。
                </p>
              </div>
            </div>
            <button
              onClick={handleComplete}
              className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              ✓ 完了
            </button>
          </>
        )}

        {step === 'completing' && (
          <div className="flex items-center gap-2 text-zinc-300 text-xs px-2 py-2">
            <span className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-emerald-400 rounded-full animate-spin shrink-0" />
            <span>確定処理中...</span>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-2">
            <p className="text-emerald-400 text-xs font-medium">✓ TMに追加しました</p>
            <button
              onClick={onCancel}
              className="w-full py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-xs transition-colors"
            >
              閉じる
            </button>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-[10px] leading-tight">エラー: {error}</p>
        )}
      </div>
    </div>
  )
}
