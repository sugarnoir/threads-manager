import { getDb } from '../index'

export interface Group {
  id: number
  name: string
  sort_order: number
  stealth_enabled: number
  stealth_mode: string | null
}

export function getAllGroups(): Group[] {
  return getDb().prepare('SELECT * FROM groups ORDER BY sort_order ASC, id ASC').all() as Group[]
}

export function createGroup(name: string): Group {
  const db = getDb()
  const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM groups').get() as { m: number | null }).m ?? 0
  const result = db.prepare('INSERT INTO groups (name, sort_order) VALUES (?, ?)').run(name, maxOrder + 1000)
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid) as Group
}

export function renameGroup(oldName: string, newName: string): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('UPDATE groups SET name = ? WHERE name = ?').run(newName, oldName)
    db.prepare("UPDATE accounts SET group_name = ?, updated_at = datetime('now') WHERE group_name = ?").run(newName, oldName)
  })()
}

export function deleteGroup(name: string): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM groups WHERE name = ?').run(name)
    db.prepare("UPDATE accounts SET group_name = NULL, updated_at = datetime('now') WHERE group_name = ?").run(name)
  })()
}

export function reorderGroups(updates: { id: number; sort_order: number }[]): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE groups SET sort_order = ? WHERE id = ?')
  db.transaction(() => {
    for (const u of updates) stmt.run(u.sort_order, u.id)
  })()
}

export function getGroupByName(name: string): Group | undefined {
  return getDb().prepare('SELECT * FROM groups WHERE name = ?').get(name) as Group | undefined
}

export function updateGroupStealth(name: string, enabled: boolean): void {
  getDb().prepare('UPDATE groups SET stealth_enabled = ? WHERE name = ?').run(enabled ? 1 : 0, name)
}

export function updateGroupStealthMode(name: string, mode: string | null): void {
  getDb().prepare('UPDATE groups SET stealth_mode = ? WHERE name = ?').run(mode, name)
}
