import { getDb } from '../index'

export interface ResponseAlert {
  id: number
  account_id: number
  error_type: string
  raw_body: string | null
  detected_at: string
}

export function insertAlert(accountId: number, errorType: string, rawBody?: string): ResponseAlert {
  const db = getDb()
  const result = db
    .prepare('INSERT INTO response_alerts (account_id, error_type, raw_body) VALUES (?, ?, ?)')
    .run(accountId, errorType, rawBody?.slice(0, 2000) ?? null)
  return db
    .prepare('SELECT * FROM response_alerts WHERE id = ?')
    .get(result.lastInsertRowid) as ResponseAlert
}

export function getAlerts(limit = 100, offset = 0): ResponseAlert[] {
  return getDb()
    .prepare('SELECT * FROM response_alerts ORDER BY detected_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as ResponseAlert[]
}

export function getAlertsByAccount(accountId: number, limit = 50): ResponseAlert[] {
  return getDb()
    .prepare('SELECT * FROM response_alerts WHERE account_id = ? ORDER BY detected_at DESC LIMIT ?')
    .all(accountId, limit) as ResponseAlert[]
}

export function getAlertsSummary24h(): { error_type: string; count: number }[] {
  return getDb()
    .prepare(
      `SELECT error_type, COUNT(*) as count FROM response_alerts
       WHERE detected_at >= datetime('now', '-24 hours')
       GROUP BY error_type ORDER BY count DESC`
    )
    .all() as { error_type: string; count: number }[]
}

export function getRecentAlertsByAccount(accountId: number, withinMinutes = 60): ResponseAlert[] {
  return getDb()
    .prepare(
      `SELECT * FROM response_alerts
       WHERE account_id = ? AND detected_at >= datetime('now', '-' || ? || ' minutes')
       ORDER BY detected_at DESC`
    )
    .all(accountId, withinMinutes) as ResponseAlert[]
}
