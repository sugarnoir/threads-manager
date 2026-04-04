import { getDb } from '../index'

export interface AutopostConfig {
  id:            number
  account_id:    number
  enabled:       boolean
  mode:          'stock' | 'rewrite' | 'random'
  use_api:       boolean
  min_interval:  number   // minutes
  max_interval:  number   // minutes
  next_at:       string | null
  stock_last_id: number | null
  rewrite_idx:   number
  rewrite_texts: string[]
  created_at:    string
  updated_at:    string
}

interface AutopostRow extends Omit<AutopostConfig, 'enabled' | 'use_api' | 'rewrite_texts'> {
  enabled:       number
  use_api:       number
  rewrite_texts: string
}

function parseConfig(row: AutopostRow): AutopostConfig {
  return {
    ...row,
    enabled:       row.enabled === 1,
    use_api:       row.use_api === 1,
    rewrite_texts: JSON.parse(row.rewrite_texts),
  }
}

export function getAutopostConfig(accountId: number): AutopostConfig | null {
  const row = getDb()
    .prepare('SELECT * FROM autopost_configs WHERE account_id = ?')
    .get(accountId) as AutopostRow | undefined
  return row ? parseConfig(row) : null
}

export function getEnabledAutopostConfigs(): AutopostConfig[] {
  const rows = getDb()
    .prepare('SELECT * FROM autopost_configs WHERE enabled = 1')
    .all() as AutopostRow[]
  return rows.map(parseConfig)
}

export function upsertAutopostConfig(data: {
  account_id:    number
  enabled:       boolean
  mode:          'stock' | 'rewrite' | 'random'
  use_api:       boolean
  min_interval:  number
  max_interval:  number
  rewrite_texts: string[]
}): AutopostConfig {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM autopost_configs WHERE account_id = ?')
    .get(data.account_id) as { id: number } | undefined

  if (existing) {
    db.prepare(
      `UPDATE autopost_configs
       SET enabled = ?, mode = ?, use_api = ?, min_interval = ?, max_interval = ?,
           rewrite_texts = ?, updated_at = datetime('now')
       WHERE account_id = ?`
    ).run(
      data.enabled ? 1 : 0,
      data.mode,
      data.use_api ? 1 : 0,
      data.min_interval,
      data.max_interval,
      JSON.stringify(data.rewrite_texts),
      data.account_id
    )
  } else {
    db.prepare(
      `INSERT INTO autopost_configs (account_id, enabled, mode, use_api, min_interval, max_interval, rewrite_texts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.account_id,
      data.enabled ? 1 : 0,
      data.mode,
      data.use_api ? 1 : 0,
      data.min_interval,
      data.max_interval,
      JSON.stringify(data.rewrite_texts)
    )
  }

  return getAutopostConfig(data.account_id)!
}

export function updateAutopostState(
  accountId: number,
  data: { next_at?: string | null; stock_last_id?: number | null; rewrite_idx?: number }
): void {
  const db = getDb()
  if (data.next_at !== undefined) {
    db.prepare(
      "UPDATE autopost_configs SET next_at = ?, updated_at = datetime('now') WHERE account_id = ?"
    ).run(data.next_at, accountId)
  }
  if (data.stock_last_id !== undefined) {
    db.prepare(
      "UPDATE autopost_configs SET stock_last_id = ?, updated_at = datetime('now') WHERE account_id = ?"
    ).run(data.stock_last_id, accountId)
  }
  if (data.rewrite_idx !== undefined) {
    db.prepare(
      "UPDATE autopost_configs SET rewrite_idx = ?, updated_at = datetime('now') WHERE account_id = ?"
    ).run(data.rewrite_idx, accountId)
  }
}

export function resetAutopostNext(accountId: number): void {
  getDb()
    .prepare("UPDATE autopost_configs SET next_at = NULL, updated_at = datetime('now') WHERE account_id = ?")
    .run(accountId)
}

export function setAutopostNextAt(accountId: number, nextAt: string): void {
  getDb()
    .prepare("UPDATE autopost_configs SET next_at = ?, updated_at = datetime('now') WHERE account_id = ?")
    .run(nextAt, accountId)
}
