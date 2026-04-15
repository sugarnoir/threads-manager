import { getDb } from '../index'

export interface Post {
  id: number
  account_id: number
  content: string
  media_paths: string[]
  status: 'pending' | 'posted' | 'failed'
  error_msg: string | null
  posted_at: string | null
  created_at: string
}

interface PostRow extends Omit<Post, 'media_paths'> {
  media_paths: string
}

function parsePost(row: PostRow): Post {
  return { ...row, media_paths: JSON.parse(row.media_paths) }
}

export function getPostsByAccount(accountId: number, limit = 50): Post[] {
  const rows = getDb()
    .prepare('SELECT * FROM posts WHERE account_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(accountId, limit) as PostRow[]
  return rows.map(parsePost)
}

export function createPost(data: {
  account_id: number
  content: string
  media_paths?: string[]
}): Post {
  const db = getDb()
  const result = db
    .prepare('INSERT INTO posts (account_id, content, media_paths) VALUES (?, ?, ?)')
    .run(data.account_id, data.content, JSON.stringify(data.media_paths ?? []))
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid) as PostRow
  return parsePost(row)
}

/** アカウントの直近の posted_at を返す（投稿がなければ null） */
export function getLastPostedAt(accountId: number): string | null {
  const row = getDb()
    .prepare("SELECT posted_at FROM posts WHERE account_id = ? AND status = 'posted' AND posted_at IS NOT NULL ORDER BY posted_at DESC LIMIT 1")
    .get(accountId) as { posted_at: string } | undefined
  return row?.posted_at ?? null
}

export function updatePostStatus(
  id: number,
  status: Post['status'],
  error_msg?: string
): void {
  getDb()
    .prepare(
      `UPDATE posts SET status = ?, error_msg = ?,
       posted_at = CASE WHEN ? = 'posted' THEN datetime('now') ELSE posted_at END WHERE id = ?`
    )
    .run(status, error_msg ?? null, status, id)
}
