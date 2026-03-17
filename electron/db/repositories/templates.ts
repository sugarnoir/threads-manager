import { getDb } from '../index'

export interface PostTemplate {
  id:         number
  account_id: number | null
  title:      string
  content:    string
  sort_order: number
  created_at: string
  updated_at: string
}

// accountId 指定時: 全共通(NULL) + 指定アカウントのテンプレートを返す
// accountId 未指定: 全テンプレートを返す（管理画面用）
export function getTemplates(accountId?: number | null): PostTemplate[] {
  const db = getDb()
  if (accountId != null) {
    return db
      .prepare(`
        SELECT * FROM post_templates
        WHERE account_id IS NULL OR account_id = ?
        ORDER BY (CASE WHEN account_id IS NULL THEN 0 ELSE 1 END), sort_order ASC, id ASC
      `)
      .all(accountId) as PostTemplate[]
  }
  return db
    .prepare(`
      SELECT * FROM post_templates
      ORDER BY (CASE WHEN account_id IS NULL THEN 0 ELSE 1 END), sort_order ASC, id ASC
    `)
    .all() as PostTemplate[]
}

export function createTemplate(data: {
  title:      string
  content:    string
  account_id?: number | null
}): PostTemplate {
  const db = getDb()
  const accountId = data.account_id ?? null
  const { m } = (accountId === null
    ? db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM post_templates WHERE account_id IS NULL').get()
    : db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM post_templates WHERE account_id = ?').get(accountId)
  ) as { m: number }

  const result = db
    .prepare('INSERT INTO post_templates (account_id, title, content, sort_order) VALUES (?, ?, ?, ?)')
    .run(accountId, data.title, data.content, m + 1000)

  return db.prepare('SELECT * FROM post_templates WHERE id = ?').get(result.lastInsertRowid) as PostTemplate
}

export function updateTemplate(id: number, data: { title: string; content: string }): PostTemplate {
  const db = getDb()
  db.prepare(
    "UPDATE post_templates SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(data.title, data.content, id)
  return db.prepare('SELECT * FROM post_templates WHERE id = ?').get(id) as PostTemplate
}

export function deleteTemplate(id: number): void {
  getDb().prepare('DELETE FROM post_templates WHERE id = ?').run(id)
}
