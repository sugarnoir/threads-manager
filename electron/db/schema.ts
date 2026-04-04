import Database from 'better-sqlite3'

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      username        TEXT NOT NULL UNIQUE,
      display_name    TEXT,
      session_dir     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'inactive',
      avatar_url      TEXT,
      proxy_url       TEXT,
      proxy_username  TEXT,
      proxy_password  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      content     TEXT NOT NULL,
      media_paths TEXT NOT NULL DEFAULT '[]',
      status      TEXT NOT NULL DEFAULT 'pending',
      error_msg   TEXT,
      posted_at   TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      content      TEXT NOT NULL,
      media_paths  TEXT NOT NULL DEFAULT '[]',
      scheduled_at TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      post_id      INTEGER REFERENCES posts(id),
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS engagements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      post_url    TEXT NOT NULL,
      action      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      error_msg   TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posts_account_id ON posts(account_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_account_id ON schedules(account_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_scheduled_at ON schedules(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_engagements_account_id ON engagements(account_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_templates (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_post_templates_account_id ON post_templates(account_id);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_stocks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title       TEXT,
      content     TEXT NOT NULL,
      image_url   TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_post_stocks_account_id ON post_stocks(account_id);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS license_keys (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      key          TEXT NOT NULL UNIQUE,
      enabled      INTEGER NOT NULL DEFAULT 1,
      note         TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS autopost_configs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
      enabled       INTEGER NOT NULL DEFAULT 0,
      mode          TEXT NOT NULL DEFAULT 'stock',
      min_interval  INTEGER NOT NULL DEFAULT 60,
      max_interval  INTEGER NOT NULL DEFAULT 120,
      next_at       TEXT,
      stock_last_id INTEGER,
      rewrite_idx   INTEGER NOT NULL DEFAULT 0,
      rewrite_texts TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_autopost_configs_account_id ON autopost_configs(account_id);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_engagement_configs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      action           TEXT NOT NULL DEFAULT 'like',
      target_usernames TEXT NOT NULL DEFAULT '',
      enabled          INTEGER NOT NULL DEFAULT 0,
      min_interval     INTEGER NOT NULL DEFAULT 30,
      max_interval     INTEGER NOT NULL DEFAULT 60,
      next_at          TEXT,
      liked_post_ids   TEXT NOT NULL DEFAULT '[]',
      follow_idx       INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, action)
    );
    CREATE INDEX IF NOT EXISTS idx_auto_engagement_account_id ON auto_engagement_configs(account_id);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS follow_queue (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      target_pk       TEXT NOT NULL,
      target_username TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      followed_at     TEXT,
      UNIQUE(account_id, target_pk)
    );
    CREATE INDEX IF NOT EXISTS idx_follow_queue_account_status ON follow_queue(account_id, status);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS proxy_presets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'http',
      host       TEXT NOT NULL,
      port       INTEGER NOT NULL,
      username   TEXT,
      password   TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_reply_configs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name      TEXT UNIQUE NOT NULL,
      enabled         INTEGER NOT NULL DEFAULT 0,
      check_interval  INTEGER NOT NULL DEFAULT 5,
      reply_texts     TEXT NOT NULL DEFAULT '[]',
      last_checked_at TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_reply_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      reply_texts TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_reply_records (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      parent_post_id TEXT NOT NULL,
      reply_post_id  TEXT NOT NULL,
      reply_username TEXT,
      reply_text     TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      created_at     TEXT NOT NULL,
      UNIQUE(account_id, reply_post_id)
    );
    CREATE INDEX IF NOT EXISTS idx_auto_reply_records_account_id ON auto_reply_records(account_id, status);
  `)

  // auto_reply_configs migration: old schema had account_id, new has group_name
  const arCols = db.prepare("PRAGMA table_info(auto_reply_configs)").all() as { name: string }[]
  if (arCols.some(c => c.name === 'account_id')) {
    db.exec('DROP TABLE IF EXISTS auto_reply_configs')
    db.exec(`
      CREATE TABLE IF NOT EXISTS auto_reply_configs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name      TEXT UNIQUE NOT NULL,
        enabled         INTEGER NOT NULL DEFAULT 0,
        check_interval  INTEGER NOT NULL DEFAULT 5,
        reply_texts     TEXT NOT NULL DEFAULT '[]',
        last_checked_at TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      )
    `)
  }

  // 既存DBへのマイグレーション
  const cols = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]
  const colNames = cols.map((c) => c.name)
  if (!colNames.includes('proxy_url')) {
    db.exec("ALTER TABLE accounts ADD COLUMN proxy_url TEXT")
  }
  if (!colNames.includes('proxy_username')) {
    db.exec("ALTER TABLE accounts ADD COLUMN proxy_username TEXT")
  }
  if (!colNames.includes('proxy_password')) {
    db.exec("ALTER TABLE accounts ADD COLUMN proxy_password TEXT")
  }
  if (!colNames.includes('group_name')) {
    db.exec("ALTER TABLE accounts ADD COLUMN group_name TEXT")
  }
  if (!colNames.includes('memo')) {
    db.exec("ALTER TABLE accounts ADD COLUMN memo TEXT")
  }
  if (!colNames.includes('follower_count')) {
    db.exec("ALTER TABLE accounts ADD COLUMN follower_count INTEGER")
  }
  if (!colNames.includes('follower_count_prev')) {
    db.exec("ALTER TABLE accounts ADD COLUMN follower_count_prev INTEGER")
  }
  if (!colNames.includes('sort_order')) {
    db.exec("ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
    // Initialize existing rows with their current rowid order
    db.exec("UPDATE accounts SET sort_order = id * 1000")
  }
  if (!colNames.includes('speed_preset')) {
    db.exec("ALTER TABLE accounts ADD COLUMN speed_preset TEXT NOT NULL DEFAULT 'normal'")
  }
  if (!colNames.includes('fingerprint')) {
    db.exec("ALTER TABLE accounts ADD COLUMN fingerprint TEXT")
  }
  if (!colNames.includes('user_agent')) {
    db.exec("ALTER TABLE accounts ADD COLUMN user_agent TEXT")
  }

  // post_templates テーブルへの account_id カラム追加
  const templateCols = db.prepare("PRAGMA table_info(post_templates)").all() as { name: string }[]
  if (!templateCols.map(c => c.name).includes('account_id')) {
    db.exec("ALTER TABLE post_templates ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE")
    db.exec("CREATE INDEX IF NOT EXISTS idx_post_templates_account_id ON post_templates(account_id)")
  }

  // autopost_configs テーブルへの use_api カラム追加
  const autopostCols = db.prepare("PRAGMA table_info(autopost_configs)").all() as { name: string }[]
  if (!autopostCols.map(c => c.name).includes('use_api')) {
    db.exec("ALTER TABLE autopost_configs ADD COLUMN use_api INTEGER NOT NULL DEFAULT 0")
  }

  // post_stocks テーブルへの image_url_2 カラム追加
  const stockCols = db.prepare("PRAGMA table_info(post_stocks)").all() as { name: string }[]
  if (!stockCols.map(c => c.name).includes('image_url_2')) {
    db.exec("ALTER TABLE post_stocks ADD COLUMN image_url_2 TEXT")
  }
  if (!stockCols.map(c => c.name).includes('topic')) {
    db.exec("ALTER TABLE post_stocks ADD COLUMN topic TEXT")
  }

  // license_keys テーブルへの user_name カラム追加
  const licenseKeyCols = db.prepare("PRAGMA table_info(license_keys)").all() as { name: string }[]
  if (!licenseKeyCols.map(c => c.name).includes('user_name')) {
    db.exec("ALTER TABLE license_keys ADD COLUMN user_name TEXT")
  }

  // groups テーブルへの既存 group_name のシード (一度だけ実行)
  const groupCount = (db.prepare("SELECT COUNT(*) as c FROM groups").get() as { c: number }).c
  if (groupCount === 0) {
    const existingGroups = db
      .prepare("SELECT DISTINCT group_name FROM accounts WHERE group_name IS NOT NULL AND group_name != ''")
      .all() as { group_name: string }[]
    const insertGroup = db.prepare("INSERT OR IGNORE INTO groups (name, sort_order) VALUES (?, ?)")
    existingGroups.forEach((row, i) => insertGroup.run(row.group_name, (i + 1) * 1000))
  }
}
