import { getDb } from '../index'

export type EngagementAction = 'like' | 'repost' | 'api_like' | 'api_follow'

export interface Engagement {
  id: number
  account_id: number
  post_url: string
  action: EngagementAction
  status: 'done' | 'failed' | 'already_done'
  error_msg: string | null
  created_at: string
}

export function getEngagements(limit = 100): Engagement[] {
  return getDb()
    .prepare('SELECT * FROM engagements ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Engagement[]
}

export function createEngagement(data: {
  account_id: number
  post_url: string
  action: EngagementAction
  status: Engagement['status']
  error_msg?: string | null
}): Engagement {
  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO engagements (account_id, post_url, action, status, error_msg)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(data.account_id, data.post_url, data.action, data.status, data.error_msg ?? null)
  return db
    .prepare('SELECT * FROM engagements WHERE id = ?')
    .get(result.lastInsertRowid) as Engagement
}
