import { getDb } from '../index'

export interface PostStock {
  id:         number
  account_id: number
  title:      string | null
  content:    string
  image_url:  string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export function getStocksByAccount(accountId: number): PostStock[] {
  return getDb()
    .prepare('SELECT * FROM post_stocks WHERE account_id = ? ORDER BY sort_order ASC, id ASC')
    .all(accountId) as PostStock[]
}

export function createStock(data: {
  account_id: number
  title?:     string | null
  content:    string
  image_url?: string | null
}): PostStock {
  const db = getDb()
  const { c } = db
    .prepare('SELECT COUNT(*) as c FROM post_stocks WHERE account_id = ?')
    .get(data.account_id) as { c: number }
  if (c >= 20) throw new Error('ストックは最大20件までです')

  const { m } = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM post_stocks WHERE account_id = ?')
    .get(data.account_id) as { m: number }

  const result = db
    .prepare('INSERT INTO post_stocks (account_id, title, content, image_url, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(data.account_id, data.title ?? null, data.content, data.image_url ?? null, m + 1000)

  return db.prepare('SELECT * FROM post_stocks WHERE id = ?').get(result.lastInsertRowid) as PostStock
}

export function updateStock(id: number, data: {
  title?:    string | null
  content:   string
  image_url?: string | null
}): PostStock {
  const db = getDb()
  db.prepare(
    "UPDATE post_stocks SET title = ?, content = ?, image_url = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(data.title ?? null, data.content, data.image_url ?? null, id)
  return db.prepare('SELECT * FROM post_stocks WHERE id = ?').get(id) as PostStock
}

export function deleteStock(id: number): void {
  getDb().prepare('DELETE FROM post_stocks WHERE id = ?').run(id)
}
