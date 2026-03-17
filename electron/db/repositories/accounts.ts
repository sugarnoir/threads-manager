import { getDb } from '../index'

export interface Account {
  id: number
  username: string
  display_name: string | null
  session_dir: string
  status: 'active' | 'inactive' | 'needs_login' | 'frozen' | 'error'
  avatar_url: string | null
  proxy_url: string | null
  proxy_username: string | null
  proxy_password: string | null
  group_name: string | null
  memo: string | null
  follower_count: number | null
  sort_order: number
  speed_preset: 'slow' | 'normal' | 'fast'
  created_at: string
  updated_at: string
}

export function getAllAccounts(): Account[] {
  return getDb().prepare('SELECT * FROM accounts ORDER BY sort_order ASC, id ASC').all() as Account[]
}

export function getAccountById(id: number): Account | undefined {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined
}

export function createAccount(data: {
  username: string
  display_name?: string
  session_dir: string
  proxy_url?: string
  proxy_username?: string
  proxy_password?: string
}): Account {
  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO accounts (username, display_name, session_dir, proxy_url, proxy_username, proxy_password)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.username,
      data.display_name ?? null,
      data.session_dir,
      data.proxy_url ?? null,
      data.proxy_username ?? null,
      data.proxy_password ?? null,
    )
  return getAccountById(result.lastInsertRowid as number)!
}

export function updateAccountStatus(
  id: number,
  status: string,
  extra?: { display_name?: string; avatar_url?: string }
): void {
  getDb()
    .prepare(
      `UPDATE accounts SET status = ?, display_name = COALESCE(?, display_name),
       avatar_url = COALESCE(?, avatar_url), updated_at = datetime('now') WHERE id = ?`
    )
    .run(status, extra?.display_name ?? null, extra?.avatar_url ?? null, id)
}

export function updateAccountProxy(
  id: number,
  proxy: { proxy_url: string | null; proxy_username: string | null; proxy_password: string | null }
): void {
  getDb()
    .prepare(
      `UPDATE accounts SET proxy_url = ?, proxy_username = ?, proxy_password = ?,
       updated_at = datetime('now') WHERE id = ?`
    )
    .run(proxy.proxy_url, proxy.proxy_username, proxy.proxy_password, id)
}

export function updateAccountDisplayName(id: number, display_name: string | null): void {
  getDb()
    .prepare("UPDATE accounts SET display_name = ?, updated_at = datetime('now') WHERE id = ?")
    .run(display_name, id)
}

export function updateAccountGroup(id: number, group_name: string | null): void {
  getDb()
    .prepare("UPDATE accounts SET group_name = ?, updated_at = datetime('now') WHERE id = ?")
    .run(group_name, id)
}

export function updateAccountMemo(id: number, memo: string | null): void {
  getDb()
    .prepare("UPDATE accounts SET memo = ?, updated_at = datetime('now') WHERE id = ?")
    .run(memo, id)
}

export function updateAccountSpeedPreset(id: number, speed_preset: 'slow' | 'normal' | 'fast'): void {
  getDb()
    .prepare("UPDATE accounts SET speed_preset = ?, updated_at = datetime('now') WHERE id = ?")
    .run(speed_preset, id)
}

export function updateAccountFollowerCount(id: number, follower_count: number | null): void {
  getDb()
    .prepare("UPDATE accounts SET follower_count = ?, updated_at = datetime('now') WHERE id = ?")
    .run(follower_count, id)
}

export function reorderAccounts(
  updates: { id: number; sort_order: number; group_name: string | null }[]
): void {
  const db = getDb()
  const stmt = db.prepare(
    "UPDATE accounts SET sort_order = ?, group_name = ?, updated_at = datetime('now') WHERE id = ?"
  )
  const runAll = db.transaction(() => {
    for (const u of updates) stmt.run(u.sort_order, u.group_name, u.id)
  })
  runAll()
}

export function deleteAccount(id: number): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
