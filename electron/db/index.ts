import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import { initializeSchema } from './schema'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'threads-manager.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
  }
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
