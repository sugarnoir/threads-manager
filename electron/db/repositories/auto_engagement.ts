import { getDb } from '../index'

export interface AutoEngagementConfig {
  id:               number
  account_id:       number
  action:           'like' | 'follow'
  target_usernames: string   // newline-separated list
  enabled:          boolean
  min_interval:     number   // minutes
  max_interval:     number   // minutes
  next_at:          string | null
  liked_post_ids:   string[]  // recently liked media IDs (max 300)
  follow_idx:       number    // current position in follow list
  created_at:       string
  updated_at:       string
}

interface AutoEngagementRow extends Omit<AutoEngagementConfig, 'enabled' | 'liked_post_ids'> {
  enabled:        number
  liked_post_ids: string
}

function parseRow(row: AutoEngagementRow): AutoEngagementConfig {
  return {
    ...row,
    enabled:        row.enabled === 1,
    liked_post_ids: JSON.parse(row.liked_post_ids),
  }
}

export function getAutoEngagementConfig(
  accountId: number,
  action: 'like' | 'follow'
): AutoEngagementConfig | null {
  const row = getDb()
    .prepare('SELECT * FROM auto_engagement_configs WHERE account_id = ? AND action = ?')
    .get(accountId, action) as AutoEngagementRow | undefined
  return row ? parseRow(row) : null
}

export function getEnabledAutoEngagementConfigs(): AutoEngagementConfig[] {
  const rows = getDb()
    .prepare('SELECT * FROM auto_engagement_configs WHERE enabled = 1')
    .all() as AutoEngagementRow[]
  return rows.map(parseRow)
}

export function upsertAutoEngagementConfig(data: {
  account_id:       number
  action:           'like' | 'follow'
  target_usernames: string
  enabled:          boolean
  min_interval:     number
  max_interval:     number
}): AutoEngagementConfig {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM auto_engagement_configs WHERE account_id = ? AND action = ?')
    .get(data.account_id, data.action) as { id: number } | undefined

  if (existing) {
    db.prepare(
      `UPDATE auto_engagement_configs
       SET target_usernames = ?, enabled = ?, min_interval = ?, max_interval = ?,
           updated_at = datetime('now')
       WHERE account_id = ? AND action = ?`
    ).run(
      data.target_usernames,
      data.enabled ? 1 : 0,
      data.min_interval,
      data.max_interval,
      data.account_id,
      data.action
    )
  } else {
    db.prepare(
      `INSERT INTO auto_engagement_configs (account_id, action, target_usernames, enabled, min_interval, max_interval)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      data.account_id,
      data.action,
      data.target_usernames,
      data.enabled ? 1 : 0,
      data.min_interval,
      data.max_interval
    )
  }

  return getAutoEngagementConfig(data.account_id, data.action)!
}

export function updateAutoEngagementState(
  accountId: number,
  action:    'like' | 'follow',
  data: {
    next_at?:        string | null
    liked_post_ids?: string[]
    follow_idx?:     number
  }
): void {
  const db = getDb()
  if (data.next_at !== undefined) {
    db.prepare(
      "UPDATE auto_engagement_configs SET next_at = ?, updated_at = datetime('now') WHERE account_id = ? AND action = ?"
    ).run(data.next_at, accountId, action)
  }
  if (data.liked_post_ids !== undefined) {
    db.prepare(
      "UPDATE auto_engagement_configs SET liked_post_ids = ?, updated_at = datetime('now') WHERE account_id = ? AND action = ?"
    ).run(JSON.stringify(data.liked_post_ids), accountId, action)
  }
  if (data.follow_idx !== undefined) {
    db.prepare(
      "UPDATE auto_engagement_configs SET follow_idx = ?, updated_at = datetime('now') WHERE account_id = ? AND action = ?"
    ).run(data.follow_idx, accountId, action)
  }
}

export function resetAutoEngagementNext(accountId: number, action: 'like' | 'follow'): void {
  getDb()
    .prepare("UPDATE auto_engagement_configs SET next_at = NULL, updated_at = datetime('now') WHERE account_id = ? AND action = ?")
    .run(accountId, action)
}
