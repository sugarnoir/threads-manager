import { getDb } from '../index'

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
