import { getDb } from '../index'

export interface AutoReplyConfig {
  id:              number
  group_name:      string
  enabled:         boolean
  check_interval:  number
  reply_texts:     string[]
  last_checked_at: string | null
  created_at:      string
  updated_at:      string
}

export interface AutoReplyTemplate {
  id:          number
  name:        string
  reply_texts: string[]
  created_at:  string
  updated_at:  string
}

export interface AutoReplyRecord {
  id:             number
  account_id:     number
  parent_post_id: string
  reply_post_id:  string
  reply_username: string | null
  reply_text:     string | null
  status:         'pending' | 'replied' | 'skipped'
  created_at:     string
}

interface AutoReplyConfigRow {
  id:              number
  group_name:      string
  enabled:         number
  check_interval:  number
  reply_texts:     string
  last_checked_at: string | null
  created_at:      string
  updated_at:      string
}

interface AutoReplyTemplateRow {
  id:          number
  name:        string
  reply_texts: string
  created_at:  string
  updated_at:  string
}

function rowToConfig(row: AutoReplyConfigRow): AutoReplyConfig {
  return { ...row, enabled: row.enabled === 1, reply_texts: JSON.parse(row.reply_texts) as string[] }
}

function rowToTemplate(row: AutoReplyTemplateRow): AutoReplyTemplate {
  return { ...row, reply_texts: JSON.parse(row.reply_texts) as string[] }
}

export function getAutoReplyConfig(groupName: string): AutoReplyConfig | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM auto_reply_configs WHERE group_name = ?').get(groupName) as AutoReplyConfigRow | undefined
  return row ? rowToConfig(row) : null
}

export function saveAutoReplyConfig(data: {
  group_name:     string
  enabled:        boolean
  check_interval: number
  reply_texts:    string[]
}): AutoReplyConfig {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO auto_reply_configs (group_name, enabled, check_interval, reply_texts, last_checked_at, created_at, updated_at)
    VALUES (@group_name, @enabled, @check_interval, @reply_texts, NULL, @now, @now)
    ON CONFLICT(group_name) DO UPDATE SET
      enabled         = @enabled,
      check_interval  = @check_interval,
      reply_texts     = @reply_texts,
      updated_at      = @now
  `).run({
    group_name:     data.group_name,
    enabled:        data.enabled ? 1 : 0,
    check_interval: data.check_interval,
    reply_texts:    JSON.stringify(data.reply_texts),
    now,
  })
  return getAutoReplyConfig(data.group_name)!
}

export function updateAutoReplyLastChecked(groupName: string): void {
  const db = getDb()
  db.prepare('UPDATE auto_reply_configs SET last_checked_at = ?, updated_at = ? WHERE group_name = ?')
    .run(new Date().toISOString(), new Date().toISOString(), groupName)
}

export function getAllEnabledAutoReplyConfigs(): AutoReplyConfig[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM auto_reply_configs WHERE enabled = 1").all() as AutoReplyConfigRow[]
  return rows.map(rowToConfig)
}

// Templates
export function getAutoReplyTemplates(): AutoReplyTemplate[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM auto_reply_templates ORDER BY created_at DESC').all() as AutoReplyTemplateRow[]
  return rows.map(rowToTemplate)
}

export function saveAutoReplyTemplate(name: string, replyTexts: string[]): AutoReplyTemplate {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO auto_reply_templates (name, reply_texts, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET reply_texts = excluded.reply_texts, updated_at = excluded.updated_at
  `).run(name, JSON.stringify(replyTexts), now, now)
  return rowToTemplate(db.prepare('SELECT * FROM auto_reply_templates WHERE name = ?').get(name) as AutoReplyTemplateRow)
}

export function deleteAutoReplyTemplate(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM auto_reply_templates WHERE id = ?').run(id)
}

// Records
export function upsertReplyRecord(data: {
  account_id:     number
  parent_post_id: string
  reply_post_id:  string
  reply_username: string | null
  reply_text:     string | null
}): boolean {
  const db = getDb()
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT OR IGNORE INTO auto_reply_records
      (account_id, parent_post_id, reply_post_id, reply_username, reply_text, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(data.account_id, data.parent_post_id, data.reply_post_id, data.reply_username, data.reply_text, now)
  return (result.changes ?? 0) > 0
}

export function getPendingReplyRecords(accountId: number): AutoReplyRecord[] {
  const db = getDb()
  return db.prepare("SELECT * FROM auto_reply_records WHERE account_id = ? AND status = 'pending' ORDER BY created_at ASC")
    .all(accountId) as AutoReplyRecord[]
}

export function updateReplyRecordStatus(id: number, status: 'replied' | 'skipped'): void {
  const db = getDb()
  db.prepare('UPDATE auto_reply_records SET status = ? WHERE id = ?').run(status, id)
}

/** 同じアカウントが同じユーザーに既に返信済みか確認 */
export function hasRepliedToUsername(accountId: number, username: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM auto_reply_records WHERE account_id = ? AND reply_username = ? AND status = 'replied' LIMIT 1")
    .get(accountId, username)
  return !!row
}

export function getReplyRecordsByGroup(groupName: string, limit = 100): AutoReplyRecord[] {
  const db = getDb()
  return db.prepare(`
    SELECT r.* FROM auto_reply_records r
    JOIN accounts a ON r.account_id = a.id
    WHERE a.group_name = ?
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(groupName, limit) as AutoReplyRecord[]
}
