/**
 * QuickAddAccountModal
 *
 * username / password / 2FA / group を入力して即座にアカウント追加 + login-probe 実行。
 * 既存の AddAccountModal（ブラウザログイン方式）とは独立。
 */

import { useState, useEffect } from 'react'
import { api, type Group } from '../lib/ipc'
import { registerLoginProbeToast } from './LoginProbeToast'

interface Props {
  onClose: () => void
  onAccountAdded: () => void
}

export function QuickAddAccountModal({ onClose, onAccountAdded }: Props) {
  const [username, setUsername]     = useState('')
  const [password, setPassword]     = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [groupName, setGroupName]   = useState('')
  const [groups, setGroups]         = useState<Group[]>([])
  const [showPw, setShowPw]         = useState(false)
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => {
    api.groups.list().then(setGroups)
  }, [])

  const handleAddAndLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('ユーザー名とパスワードは必須です')
      return
    }
    setBusy(true)
    setError(null)

    try {
      // 1. アカウント作成
      const addResult = await api.accounts.quickAdd({
        username: username.trim(),
        password: password.trim(),
        totp_secret: totpSecret.trim() || undefined,
        group_name: groupName || undefined,
      })
      if (!addResult.success || !addResult.account) {
        setError(addResult.error ?? 'アカウント追加失敗')
        setBusy(false)
        return
      }

      const account = addResult.account
      onAccountAdded()

      // 2. トーストに登録
      registerLoginProbeToast(account.id, account.username)

      // 3. login-probe 実行（非同期で開始、モーダルは閉じる）
      onClose()
      api.loginProbe.single({
        accountId: account.id,
        username: account.username,
        password: password.trim(),
        totpSecret: totpSecret.trim() || undefined,
        skipIfSessionAlive: false,
      }).then((result) => {
        if (result.ok) {
          window.dispatchEvent(new CustomEvent('accounts-changed'))
        }
        // challenge / failed は ChallengeModal / Toast で処理される
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const handleAddOnly = async () => {
    if (!username.trim() || !password.trim()) {
      setError('ユーザー名とパスワードは必須です')
      return
    }
    setBusy(true)
    setError(null)

    try {
      const result = await api.accounts.quickAdd({
        username: username.trim(),
        password: password.trim(),
        totp_secret: totpSecret.trim() || undefined,
        group_name: groupName || undefined,
      })
      if (!result.success) {
        setError(result.error ?? 'アカウント追加失敗')
        setBusy(false)
        return
      }
      onAccountAdded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-sm mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="text-white font-bold text-sm">クイック追加</h2>
          <p className="text-zinc-500 text-xs mt-0.5">ID/PWで追加して即ログイン</p>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3">
          {/* Username */}
          <div>
            <label className="text-zinc-400 text-xs font-medium block mb-1">Instagram ID</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoFocus
              disabled={busy}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50"
            />
          </div>

          {/* Password */}
          <div>
            <label className="text-zinc-400 text-xs font-medium block mb-1">パスワード</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                disabled={busy}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50 pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs"
              >
                {showPw ? '隠す' : '表示'}
              </button>
            </div>
          </div>

          {/* 2FA Secret */}
          <div>
            <label className="text-zinc-400 text-xs font-medium block mb-1">2FA Secret（任意）</label>
            <input
              type="text"
              value={totpSecret}
              onChange={(e) => setTotpSecret(e.target.value)}
              placeholder="BASE32SECRET..."
              disabled={busy}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50"
            />
            <p className="text-zinc-600 text-[10px] mt-1">未入力の場合、2FA画面で手動入力が必要です</p>
          </div>

          {/* Group */}
          <div>
            <label className="text-zinc-400 text-xs font-medium block mb-1">グループ</label>
            <select
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              disabled={busy}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">なし</option>
              {groups.map((g) => (
                <option key={g.id} value={g.name}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleAddOnly}
            disabled={busy}
            className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg transition-colors disabled:opacity-50"
          >
            追加のみ
          </button>
          <button
            type="button"
            onClick={handleAddAndLogin}
            disabled={busy || !username.trim() || !password.trim()}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {busy ? '処理中...' : '追加してログイン'}
          </button>
        </div>
      </div>
    </div>
  )
}
