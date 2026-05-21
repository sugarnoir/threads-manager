/**
 * アカウントステータスによる投稿ガード
 *
 * 全投稿経路で共通利用。
 * ステータスチェック + paused_until チェックの統合。
 */

import type { Account } from '../db/repositories/accounts'
import { unpauseAccount } from '../db/repositories/accounts'

const STATUS_REASONS: Record<string, string> = {
  challenge:   'チャレンジ認証が必要です',
  frozen:      'アカウントが凍結されています',
  needs_login: 'ログインが必要です',
  error:       'エラー状態です',
  inactive:    'アカウントが無効です',
  unverified:  '未検証です（アカウントを選択すると自動検証されます）',
}

export interface GuardResult {
  skip: boolean
  reason?: string
}

/**
 * アカウントが投稿可能かチェック。
 * 1. paused_until による停止チェック（期限切れなら自動再開）
 * 2. status による投稿可否チェック
 */
export function shouldSkipForStatus(
  account: Pick<Account, 'id' | 'status' | 'username' | 'paused_until' | 'pause_reason'>,
  _options?: { force?: boolean },
): GuardResult {
  // 1. 停止チェック
  if (account.paused_until) {
    if (account.paused_until === '永続') {
      return { skip: true, reason: `永久停止中: ${account.pause_reason ?? '不明'}` }
    }
    const until = new Date(account.paused_until)
    if (until > new Date()) {
      const remainMin = Math.ceil((until.getTime() - Date.now()) / 60_000)
      return { skip: true, reason: `一時停止中 (残り${remainMin}分): ${account.pause_reason ?? ''}` }
    }
    // 期限切れ → 自動再開
    unpauseAccount(account.id)
  }

  // 2. ステータスチェック
  if (account.status === 'active') {
    return { skip: false }
  }
  const reason = STATUS_REASONS[account.status] ?? `不明なステータス (${account.status})`
  return {
    skip: true,
    reason: `アカウントステータス不適格 (${account.status}): ${reason}`,
  }
}
