import { getDb } from '../index'

export interface Group {
  id: number
  name: string
  sort_order: number
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
