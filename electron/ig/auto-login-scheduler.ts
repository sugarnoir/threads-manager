/**
 * 自動ログイン修復スケジューラ
 *
 * 5分ごとにポーリングし、needs_login かつリトライ可能な垢を自動修復する。
 * リトライ間隔: 30分 → 6時間 → 24時間 (最大3回)
 */

import { session } from 'electron'
import { getDb } from '../db'
import { autoLogin } from './auto-login'
import { sendDiscordNotification } from '../discord'

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5分
const RETRY_DELAYS_MIN = [30, 360, 1440] // 30分, 6時間, 24時間
const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length

let timer: ReturnType<typeof setInterval> | null = null

export function startAutoLoginScheduler(): void {
  if (timer) return
  console.log('[auto-login-scheduler] started')
  // 起動後30秒で初回実行（他の初期化と競合しないように遅延）
  setTimeout(() => void runOnce(), 30_000)
  timer = setInterval(() => void runOnce(), POLL_INTERVAL_MS)
}

export function stopAutoLoginScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function runOnce(): Promise<void> {
  const db = getDb()

  const due = db.prepare(`
    SELECT * FROM accounts
    WHERE status = 'needs_login'
      AND (giveup IS NULL OR giveup = 0)
      AND (next_login_attempt_at IS NULL OR next_login_attempt_at <= datetime('now'))
      AND (login_attempt_count IS NULL OR login_attempt_count < ?)
    ORDER BY next_login_attempt_at ASC
    LIMIT 10
  `).all(MAX_ATTEMPTS) as any[]

  if (due.length === 0) return

  console.log(`[auto-login-scheduler] ${due.length} accounts due for retry`)

  let recovered = 0
  for (const account of due) {
    try {
      const loggedIn = await tryLoginAccount(account)
      if (loggedIn) recovered++
    } catch (e) {
      console.error(`[auto-login-scheduler] error for ${account.username}:`, e instanceof Error ? e.message : e)
    }
    // レート制限対策: 垢間に3-5秒待機
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000))
  }

  if (recovered > 0) {
    console.log(`[auto-login-scheduler] recovered ${recovered}/${due.length}`)
    sendDiscordNotification({
      event: 'auto_login',
      username: 'system',
      message: `自動ログイン復旧: ${recovered}/${due.length} 件成功`,
    }).catch(() => {})
  }
}

async function tryLoginAccount(account: any): Promise<boolean> {
  const permSess = session.fromPartition(`persist:account-${account.id}`)
  const existingCookies = await permSess.cookies.get({ url: 'https://www.instagram.com' }).catch(() => [])

  const result = await autoLogin({
    accountId: account.id,
    username: account.username,
    password: account.ig_password ?? null,
    totpSecret: account.totp_secret ?? null,
    cookies: existingCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? '.instagram.com',
      path: c.path ?? '/',
      secure: c.secure ?? true,
      httpOnly: c.httpOnly ?? false,
      expirationDate: c.expirationDate,
    })),
    proxyUrl: account.proxy_url ?? null,
    proxyUsername: account.proxy_username ?? null,
    proxyPassword: account.proxy_password ?? null,
    permSess,
  })

  const db = getDb()
  if (result.loggedIn) {
    db.prepare(`
      UPDATE accounts
      SET status = 'active',
          last_probe_status = 'alive',
          last_probe_at = datetime('now'),
          next_login_attempt_at = NULL,
          login_attempt_count = 0,
          giveup = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(account.id)
    console.log(`[auto-login-scheduler] ${account.username}: recovered (${result.internalReason})`)
    return true
  }

  const attemptCount = (account.login_attempt_count || 0) + 1
  if (result.giveUp || attemptCount >= MAX_ATTEMPTS) {
    db.prepare(`
      UPDATE accounts
      SET giveup = 1,
          last_probe_status = ?,
          last_probe_at = datetime('now'),
          next_login_attempt_at = NULL,
          login_attempt_count = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(result.internalReason, attemptCount, account.id)
    console.log(`[auto-login-scheduler] ${account.username}: gave up (${result.internalReason})`)
  } else {
    const delayMin = RETRY_DELAYS_MIN[attemptCount - 1]
    db.prepare(`
      UPDATE accounts
      SET last_probe_status = ?,
          last_probe_at = datetime('now'),
          next_login_attempt_at = datetime('now', '+' || ? || ' minutes'),
          login_attempt_count = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(result.internalReason, delayMin, attemptCount, account.id)
    console.log(`[auto-login-scheduler] ${account.username}: retry in ${delayMin}min (${result.internalReason})`)
  }

  return false
}
