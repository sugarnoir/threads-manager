/**
 * アカウントステータスによる投稿ガード
 *
 * 全投稿経路で共通利用。将来の { force?: boolean } 拡張を想定した設計。
 */

import type { Account } from '../db/repositories/accounts'

const STATUS_REASONS: Record<string, string> = {
  challenge:   'チャレンジ認証が必要です',
  frozen:      'アカウントが凍結されています',
  needs_login: 'ログインが必要です',
  error:       'エラー状態です',
  inactive:    'アカウントが無効です',
}

export interface GuardResult {
  skip: boolean
  reason?: string
}

/**
 * アカウントが投稿可能かチェック。
 * @param account アカウント情報
 * @param options 将来拡張用（force?: boolean）
 * @returns skip=true ならスキップすべき、reason にスキップ理由
 */
export function shouldSkipForStatus(
  account: Pick<Account, 'status' | 'username'>,
  _options?: { force?: boolean },
): GuardResult {
  // 将来: if (_options?.force) return { skip: false }
  if (account.status === 'active') {
    return { skip: false }
  }
  const reason = STATUS_REASONS[account.status] ?? `不明なステータス (${account.status})`
  return {
    skip: true,
    reason: `アカウントステータス不適格 (${account.status}): ${reason}`,
  }
}
