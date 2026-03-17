import { getDb } from '../index'

export interface LicenseKey {
  id: number
  key: string
  enabled: number
  note: string | null
  user_name: string | null
  created_at: string
  last_used_at: string | null
}

export function verifyKey(key: string): boolean {
  const db = getDb()
  const row = db.prepare('SELECT id FROM license_keys WHERE key = ? AND enabled = 1').get(key) as { id: number } | undefined
  if (!row) return false
  db.prepare("UPDATE license_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id)
  return true
}

export function getAllKeys(): LicenseKey[] {
  return getDb().prepare('SELECT * FROM license_keys ORDER BY created_at DESC').all() as LicenseKey[]
}

export function createKey(key: string, note?: string, user_name?: string): LicenseKey {
  const db = getDb()
  const result = db.prepare('INSERT INTO license_keys (key, note, user_name) VALUES (?, ?, ?)').run(
    key.trim(),
    note?.trim() ?? null,
    user_name?.trim() ?? null
  )
  return db.prepare('SELECT * FROM license_keys WHERE id = ?').get(result.lastInsertRowid) as LicenseKey
}

export function updateKeyMeta(id: number, data: { note?: string | null; user_name?: string | null }): void {
  getDb().prepare('UPDATE license_keys SET note = ?, user_name = ? WHERE id = ?').run(
    data.note ?? null,
    data.user_name ?? null,
    id
  )
}

export function updateKeyEnabled(id: number, enabled: boolean): void {
  getDb().prepare('UPDATE license_keys SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

export function deleteKey(id: number): void {
  getDb().prepare('DELETE FROM license_keys WHERE id = ?').run(id)
}
