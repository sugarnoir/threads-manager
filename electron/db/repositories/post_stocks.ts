import { getDb } from '../index'

export interface PostStock {
  id:          number
  account_id:  number
  title:       string | null
  content:     string
  image_url:   string | null
  image_url_2: string | null
  topic:       string | null
  sort_order:  number
  created_at:  string
  updated_at:  string
}

export function getStocksByAccount(accountId: number): PostStock[] {
  return getDb()
    .prepare('SELECT * FROM post_stocks WHERE account_id = ? ORDER BY sort_order ASC, id ASC')
    .all(accountId) as PostStock[]
}

export function createStock(data: {
  account_id:   number
  title?:       string | null
  content:      string
  image_url?:   string | null
  image_url_2?: string | null
  topic?:       string | null
}): PostStock {
  const db = getDb()
  const { c } = db
    .prepare('SELECT COUNT(*) as c FROM post_stocks WHERE account_id = ?')
    .get(data.account_id) as { c: number }
  if (c >= 500) throw new Error('ストックは最大500件までです')

  const { m } = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM post_stocks WHERE account_id = ?')
    .get(data.account_id) as { m: number }

  const result = db
    .prepare('INSERT INTO post_stocks (account_id, title, content, image_url, image_url_2, topic, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(data.account_id, data.title ?? null, data.content, data.image_url ?? null, data.image_url_2 ?? null, data.topic ?? null, m + 1000)

  return db.prepare('SELECT * FROM post_stocks WHERE id = ?').get(result.lastInsertRowid) as PostStock
}

export function updateStock(id: number, data: {
  title?:       string | null
  content:      string
  image_url?:   string | null
  image_url_2?: string | null
  topic?:       string | null
}): PostStock {
  const db = getDb()
  db.prepare(
    "UPDATE post_stocks SET title = ?, content = ?, image_url = ?, image_url_2 = ?, topic = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(data.title ?? null, data.content, data.image_url ?? null, data.image_url_2 ?? null, data.topic ?? null, id)
  return db.prepare('SELECT * FROM post_stocks WHERE id = ?').get(id) as PostStock
}

export function deleteStock(id: number): void {
  getDb().prepare('DELETE FROM post_stocks WHERE id = ?').run(id)
}

export function deleteAllStocks(accountId: number): number {
  const result = getDb().prepare('DELETE FROM post_stocks WHERE account_id = ?').run(accountId)
  return result.changes
}

// groupKey: '__all__' = 全アカウント, '__none__' = グループなし, それ以外 = グループ名
export function deleteAllStocksByGroup(groupKey: string): number {
  const db = getDb()
  if (groupKey === '__all__') {
    return db.prepare('DELETE FROM post_stocks').run().changes
  }
  if (groupKey === '__none__') {
    return db.prepare(
      'DELETE FROM post_stocks WHERE account_id IN (SELECT id FROM accounts WHERE group_name IS NULL)'
    ).run().changes
  }
  return db.prepare(
    'DELETE FROM post_stocks WHERE account_id IN (SELECT id FROM accounts WHERE group_name = ?)'
  ).run(groupKey).changes
}

export function updateAllTopics(accountId: number, topic: string | null): number {
  const result = getDb()
    .prepare("UPDATE post_stocks SET topic = ?, updated_at = datetime('now') WHERE account_id = ?")
    .run(topic, accountId)
  return result.changes
}

/** トピック未設定のストックにのみトピックを設定する（既存トピックは維持） */
export function addTopicToEmptyStocks(accountId: number, topic: string): number {
  const result = getDb()
    .prepare("UPDATE post_stocks SET topic = ?, updated_at = datetime('now') WHERE account_id = ? AND (topic IS NULL OR topic = '')")
    .run(topic, accountId)
  return result.changes
}
