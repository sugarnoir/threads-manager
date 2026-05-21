/**
 * 未検証アカウントのバックグラウンド検証ジョブ
 *
 * 軽量モードでインポートされた 'unverified' 垢を、
 * 15分間隔で1垢ずつ Health Probe → active/needs_login に更新する。
 * Meta のログイン検知を避けるため、時間分散で処理する。
 */

import { session } from 'electron'
import { getDb } from '../db'
import { getAccountById, updateAccountStatus, updateProbeStatus } from '../db/repositories/accounts'
import { probeAccountHealth } from '../ig/health-probe'
import { sanitizeCookies } from '../ig/cookie-sanitizer'
import { selectUA } from '../ig/ua-selector'
import { injectCookies, type RawCookie } from '../browser-views/view-manager'

const INTERVAL_MS = 15 * 60 * 1000  // 15分間隔
let lastProcessedAt = 0
let timer: ReturnType<typeof setInterval> | null = null

export function startUnverifiedCheckJob(): void {
  if (timer) return
  console.log('[unverified-check-job] started (15min interval)')
  timer = setInterval(() => void tick(), 60_000)  // 1分毎にチェック
}

export function stopUnverifiedCheckJob(): void {
  if (timer) { clearInterval(timer); timer = null }
}

async function tick(): Promise<void> {
  const now = Date.now()
  if (now - lastProcessedAt < INTERVAL_MS) return

  const account = getNextUnverified()
  if (!account) return

  lastProcessedAt = now
  console.log(`[unverified-check-job] verifying @${account.username} (id=${account.id})`)

  try {
    await verifyAccount(account)
  } catch (error) {
    console.error(`[unverified-check-job] @${account.username} error:`, error)
  }
}

function getNextUnverified(): { id: number; username: string; proxy_url: string | null; proxy_username: string | null; proxy_password: string | null } | undefined {
  const db = getDb()
  return db.prepare(`
    SELECT id, username, proxy_url, proxy_username, proxy_password
    FROM accounts
    WHERE status = 'unverified'
    ORDER BY id ASC
    LIMIT 1
  `).get() as any
}

async function verifyAccount(account: { id: number; username: string; proxy_url: string | null; proxy_username: string | null; proxy_password: string | null }): Promise<void> {
  // Electron セッションから Cookie を取得
  const sess = session.fromPartition(`persist:account-${account.id}`)
  const allCookies = await sess.cookies.get({})
  const igCookies = allCookies.filter(c =>
    c.domain?.includes('instagram.com') || c.domain?.includes('threads.com')
  )

  if (igCookies.length === 0) {
    console.log(`[unverified-check-job] @${account.username}: no cookies found → needs_login`)
    updateAccountStatus(account.id, 'needs_login')
    return
  }

  const cookiesForProbe = igCookies.map(c => ({ name: c.name, value: c.value }))
  const { type: uaType } = selectUA(cookiesForProbe)

  const probe = await probeAccountHealth({
    cookies: cookiesForProbe,
    proxyUrl: account.proxy_url ?? undefined,
    proxyUsername: account.proxy_url ? (account.proxy_username ?? undefined) : undefined,
    proxyPassword: account.proxy_url ? (account.proxy_password ?? undefined) : undefined,
  })

  updateProbeStatus(account.id, probe.status, uaType)

  if (probe.status === 'alive') {
    updateAccountStatus(account.id, 'active')
    console.log(`[unverified-check-job] @${account.username}: active (userId=${(probe as any).userId})`)
  } else if (probe.status === 'login_required') {
    updateAccountStatus(account.id, 'needs_login')
    console.log(`[unverified-check-job] @${account.username}: needs_login`)
  } else if (probe.status === 'challenge') {
    updateAccountStatus(account.id, 'challenge')
    console.log(`[unverified-check-job] @${account.username}: challenge`)
  } else {
    // rate_limited, unknown → unverified のまま次回再試行
    console.log(`[unverified-check-job] @${account.username}: ${probe.status} → retry later`)
  }
}
