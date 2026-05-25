import { getDb } from '../index'

export interface Account {
  id: number
  username: string
  display_name: string | null
  session_dir: string
  status: 'active' | 'inactive' | 'needs_login' | 'frozen' | 'error' | 'challenge' | 'unverified'
  avatar_url: string | null
  proxy_url: string | null
  proxy_username: string | null
  proxy_password: string | null
  group_name: string | null
  memo: string | null
  follower_count: number | null
  follower_count_prev: number | null
  sort_order: number
  speed_preset: 'slow' | 'normal' | 'fast'
  user_agent: string | null
  ig_password: string | null
  platform: 'threads' | 'instagram' | 'x'
  totp_secret: string | null
  ua_generated_at: string | null
  ua_app_version: string | null
  device_id: string | null
  device_uuid: string | null
  phone_id: string | null
  adid: string | null
  use_unified_headers: boolean
  reply_ban_status: 'ok' | 'banned' | null
  reply_ban_checked_at: string | null
  pinned_post_url: string | null
  pinned_post_status: 'alive' | 'deleted' | 'unknown' | null
  pinned_checked_at: string | null
  ua_type: string | null
  last_probe_status: string | null
  last_probe_at: string | null
  next_login_attempt_at: string | null
  login_attempt_count: number
  giveup: number
  paused_until: string | null
  pause_reason: string | null
  consecutive_failures: number
  mobile_authorization: string | null
  mobile_www_claim: string | null
  mobile_mid: string | null
  mobile_ds_user_id: string | null
  mobile_rur: string | null
  story_link_url: string | null
  pin_check_enabled: number
  threads_setup_status: string | null
  threads_setup_at: string | null
  threads_setup_error: string | null
  threads_setup_attempts: number
  stealth_override: 'on' | 'off' | null
  fingerprint_seed: string | null
  behavior_seed: string | null
  behavior_profile: string | null
  adspower_user_id: string | null
  adspower_status: string | null
  adspower_browser_core: string | null
  created_at: string
  updated_at: string
}

export function getAllAccounts(): Account[] {
  return getDb().prepare('SELECT * FROM accounts ORDER BY sort_order ASC, id ASC').all() as Account[]
}

export function getAccountById(id: number): Account | undefined {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined
}

export function getAccountCount(): number {
  const { c } = getDb().prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number }
  return c
}

export function createAccount(data: {
  username: string
  display_name?: string
  session_dir: string
  proxy_url?: string
  proxy_username?: string
  proxy_password?: string
  user_agent?: string
  ig_password?: string
  platform?: 'threads' | 'x'
}): Account {
  const db = getDb()

  // ライセンスの max_accounts 制限チェック（認証時に app_settings に保存済み）
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'license_max_accounts'").get() as { value: string } | undefined
    const maxStr = row?.value?.trim()
    const { c } = db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number }
    console.log(`[createAccount] license_max_accounts="${maxStr ?? '(not set)'}" current=${c}`)
    if (maxStr) {
      const max = parseInt(maxStr, 10)
      if (Number.isFinite(max) && max > 0) {
        console.log(`[createAccount] limit=${max} current=${c} → ${c >= max ? 'BLOCKED' : 'OK'}`)
        if (c >= max) {
          throw new Error(
            `アカウント数が上限（${max}件）に達しました。\n` +
            `本ツールはサーバーへの負荷を考慮し、1ライセンスにつき最大${max}アカウントまでの利用に制限しております。` +
            `100アカウントを超えてのご利用は現在対応しておりません。ご了承ください。`
          )
        }
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('上限')) throw e
  }

  const maxRow = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM accounts').get() as { m: number }
  const nextOrder = maxRow.m + 1000
  // 新規垢は fingerprint_seed + behavior_seed を自動生成（既存垢は null のまま従来互換）
  const cryptoMod = require('crypto')
  const fpSeed = cryptoMod.randomUUID() as string
  const behaviorSeed = cryptoMod.randomUUID() as string

  const result = db
    .prepare(
      `INSERT INTO accounts (username, display_name, session_dir, proxy_url, proxy_username, proxy_password, sort_order, user_agent, ig_password, platform, fingerprint_seed, behavior_seed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.username,
      data.display_name ?? null,
      data.session_dir,
      data.proxy_url ?? null,
      data.proxy_username ?? null,
      data.proxy_password ?? null,
      nextOrder,
      data.user_agent ?? null,
      data.ig_password ?? null,
      data.platform ?? 'threads',
      fpSeed,
      behaviorSeed,
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

export function updateAccountUsername(id: number, username: string): void {
  getDb()
    .prepare("UPDATE accounts SET username = ?, updated_at = datetime('now') WHERE id = ?")
    .run(username, id)
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

export function updateAccountMark(id: number, mark: string | null): void {
  getDb()
    .prepare("UPDATE accounts SET mark = ?, updated_at = datetime('now') WHERE id = ?")
    .run(mark, id)
}

export function updateAccountUserAgent(id: number, user_agent: string | null): void {
  getDb()
    .prepare("UPDATE accounts SET user_agent = ?, updated_at = datetime('now') WHERE id = ?")
    .run(user_agent, id)
}

export function updateAccountUA(id: number, user_agent: string, ua_generated_at: string, ua_app_version: string): void {
  getDb()
    .prepare("UPDATE accounts SET user_agent = ?, ua_generated_at = ?, ua_app_version = ?, updated_at = datetime('now') WHERE id = ?")
    .run(user_agent, ua_generated_at, ua_app_version, id)
}

export function updateAccountDeviceIds(id: number, ids: { device_id: string; device_uuid: string; phone_id: string; adid: string }): void {
  getDb()
    .prepare("UPDATE accounts SET device_id = ?, device_uuid = ?, phone_id = ?, adid = ?, updated_at = datetime('now') WHERE id = ?")
    .run(ids.device_id, ids.device_uuid, ids.phone_id, ids.adid, id)
}

export function updateAccountUnifiedHeaders(id: number, enabled: boolean): void {
  getDb()
    .prepare("UPDATE accounts SET use_unified_headers = ?, updated_at = datetime('now') WHERE id = ?")
    .run(enabled ? 1 : 0, id)
}

export function updateReplyBanStatus(id: number, status: 'ok' | 'banned', checkedAt: string): void {
  getDb()
    .prepare("UPDATE accounts SET reply_ban_status = ?, reply_ban_checked_at = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, checkedAt, id)
}

export function updateAccountMobileSession(
  id: number,
  data: {
    authorization?: string | null
    www_claim?: string | null
    mid?: string | null
    ds_user_id?: string | null
    rur?: string | null
  },
): void {
  getDb()
    .prepare(`UPDATE accounts SET
      mobile_authorization = COALESCE(?, mobile_authorization),
      mobile_www_claim = COALESCE(?, mobile_www_claim),
      mobile_mid = COALESCE(?, mobile_mid),
      mobile_ds_user_id = COALESCE(?, mobile_ds_user_id),
      mobile_rur = COALESCE(?, mobile_rur),
      updated_at = datetime('now')
    WHERE id = ?`)
    .run(
      data.authorization ?? null,
      data.www_claim ?? null,
      data.mid ?? null,
      data.ds_user_id ?? null,
      data.rur ?? null,
      id,
    )
}

export function pauseAccount(id: number, until: string, reason: string): void {
  getDb()
    .prepare("UPDATE accounts SET paused_until = ?, pause_reason = ?, updated_at = datetime('now') WHERE id = ?")
    .run(until, reason, id)
}

export function unpauseAccount(id: number): void {
  getDb()
    .prepare("UPDATE accounts SET paused_until = NULL, pause_reason = NULL, consecutive_failures = 0, updated_at = datetime('now') WHERE id = ?")
    .run(id)
}

export function incrementFailures(id: number): number {
  const db = getDb()
  db.prepare("UPDATE accounts SET consecutive_failures = consecutive_failures + 1, updated_at = datetime('now') WHERE id = ?").run(id)
  const row = db.prepare("SELECT consecutive_failures FROM accounts WHERE id = ?").get(id) as { consecutive_failures: number } | undefined
  return row?.consecutive_failures ?? 0
}

export function resetFailures(id: number): void {
  getDb()
    .prepare("UPDATE accounts SET consecutive_failures = 0, updated_at = datetime('now') WHERE id = ?")
    .run(id)
}

export function updateProbeStatus(
  id: number,
  status: string,
  uaType?: string,
): void {
  getDb()
    .prepare("UPDATE accounts SET last_probe_status = ?, last_probe_at = datetime('now'), ua_type = COALESCE(?, ua_type), updated_at = datetime('now') WHERE id = ?")
    .run(status, uaType ?? null, id)
}

export function updatePinnedPostStatus(
  id: number,
  url: string | null,
  status: 'alive' | 'deleted' | 'unknown' | null,
): void {
  getDb()
    .prepare("UPDATE accounts SET pinned_post_url = ?, pinned_post_status = ?, pinned_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(url, status, id)
}

export function updateStealthOverride(id: number, override: 'on' | 'off' | null): void {
  getDb()
    .prepare("UPDATE accounts SET stealth_override = ?, updated_at = datetime('now') WHERE id = ?")
    .run(override, id)
}

export function bulkUpdateStealthOverride(ids: number[], override: 'on' | 'off' | null): void {
  const db = getDb()
  const stmt = db.prepare("UPDATE accounts SET stealth_override = ?, updated_at = datetime('now') WHERE id = ?")
  db.transaction(() => {
    for (const id of ids) stmt.run(override, id)
  })()
}

export function updateAccountTotpSecret(id: number, totp_secret: string | null): void {
  getDb()
    .prepare("UPDATE accounts SET totp_secret = ?, updated_at = datetime('now') WHERE id = ?")
    .run(totp_secret, id)
}

export function updateAccountSpeedPreset(id: number, speed_preset: 'slow' | 'normal' | 'fast'): void {
  getDb()
    .prepare("UPDATE accounts SET speed_preset = ?, updated_at = datetime('now') WHERE id = ?")
    .run(speed_preset, id)
}

export function updateAccountFollowerCount(id: number, follower_count: number | null): void {
  const db = getDb()
  // 現在値を prev に退避してから新しい値を保存
  db.prepare(`
    UPDATE accounts
    SET follower_count_prev = follower_count,
        follower_count = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(follower_count, id)
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

export function getAccountFingerprint(id: number): string | null {
  const row = getDb()
    .prepare('SELECT fingerprint FROM accounts WHERE id = ?')
    .get(id) as { fingerprint: string | null } | undefined
  return row?.fingerprint ?? null
}

export function setAccountFingerprint(id: number, fingerprintJson: string): void {
  getDb()
    .prepare("UPDATE accounts SET fingerprint = ?, updated_at = datetime('now') WHERE id = ?")
    .run(fingerprintJson, id)
}
