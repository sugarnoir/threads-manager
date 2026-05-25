/**
 * ChallengeModal
 *
 * Login probe が challenge / checkpoint / 2FA未設定 等を検知したとき表示するモーダル。
 */

import { useState } from 'react'

export type ChallengeSignalLayer = 'url' | 'dom' | 'network'

export type ChallengeSignal = {
  layer: ChallengeSignalLayer
  value: string
  phase: string
  matchedAt: string
}

export type ChallengeNotification = {
  accountId: number
  username?: string
  phase: string
  signal: ChallengeSignal
}

const PHASE_LABEL: Record<string, string> = {
  idle: '待機中',
  navigating: 'ログイン画面ロード中',
  entering_credentials: 'ID/パスワード入力中',
  awaiting_2fa: '2FA画面到達',
  entering_2fa: '2FAコード入力中',
  challenge_detected: '危険画面検知',
  logged_in: 'ログイン成功',
  failed: '失敗',
}

const LAYER_LABEL: Record<ChallengeSignalLayer, string> = {
  url: 'URL',
  dom: '画面内文字列',
  network: 'API応答',
}

interface Props {
  notification: ChallengeNotification
  onResolved: () => void | Promise<void>
  onDismiss: () => void
}

export function ChallengeModal({ notification, onResolved, onDismiss }: Props) {
  const { accountId, username, phase, signal } = notification
  const [resolving, setResolving] = useState(false)

  const handleResolved = async () => {
    setResolving(true)
    try {
      await onResolved()
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="text-base font-bold text-red-400 flex items-center gap-2">
            <span>手動対応が必要です</span>
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3 text-sm">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <span className="text-zinc-500">アカウント</span>
            <span className="font-mono text-white">
              {username ?? '(unknown)'}{' '}
              <span className="text-zinc-600">#{accountId}</span>
            </span>

            <span className="text-zinc-500">検出フェーズ</span>
            <span className="text-zinc-300">{PHASE_LABEL[phase] ?? phase}</span>

            <span className="text-zinc-500">検出経路</span>
            <span className="text-zinc-300">{LAYER_LABEL[signal.layer as ChallengeSignalLayer] ?? signal.layer}</span>

            <span className="text-zinc-500">検出内容</span>
            <code className="text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded break-all">
              {signal.value}
            </code>

            <span className="text-zinc-500">検出時刻</span>
            <span className="text-xs text-zinc-400">
              {new Date(signal.matchedAt).toLocaleString('ja-JP')}
            </span>
          </div>

          <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-300 text-xs leading-relaxed">
            <p className="font-semibold mb-1">対応手順:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>右側のブラウザ画面でInstagramの認証画面を確認</li>
              <li>本人確認 / 2FA / CAPTCHA等を手動で完了</li>
              <li>ホーム画面までログイン完了したら「解決済み」をクリック</li>
            </ol>
            <p className="mt-2 text-amber-400/80">
              自動処理は完全に停止しています。画面の指示に従って慎重に操作してください。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onDismiss}
            disabled={resolving}
            className="px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
          >
            あとで対応
          </button>
          <button
            type="button"
            onClick={handleResolved}
            disabled={resolving}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {resolving ? '更新中...' : '解決済み'}
          </button>
        </div>
      </div>
    </div>
  )
}
