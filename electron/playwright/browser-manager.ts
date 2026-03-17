import { chromium, BrowserContext, Cookie } from 'playwright'
import fs from 'fs'
import { getAccountById } from '../db/repositories/accounts'
import { generateFingerprint, buildOverrideScript } from '../fingerprint'

export interface ProxyConfig {
  server: string
  username?: string
  password?: string
}

export interface ContextInfo {
  accountId: number
  state: 'idle' | 'busy'
}

// accountId → { context, busyCount }
const pool = new Map<number, { ctx: BrowserContext; busy: number }>()

// Context 状態変化コールバック (IPC 通知用)
let onStatusChange: ((infos: ContextInfo[]) => void) | null = null
export function setStatusChangeCallback(cb: (infos: ContextInfo[]) => void): void {
  onStatusChange = cb
}

function notifyStatusChange(): void {
  onStatusChange?.(getContextInfos())
}

export function getContextInfos(): ContextInfo[] {
  return [...pool.entries()].map(([id, entry]) => ({
    accountId: id,
    state: entry.busy > 0 ? 'busy' : 'idle',
  }))
}

export function getActiveContextIds(): number[] {
  return [...pool.keys()]
}

const BASE_LAUNCH_OPTIONS = {
  args: ['--no-sandbox'],
}

/**
 * アカウントのコンテキストを取得（なければ作成）。
 * headless=true: 自動化処理用（不可視）/ headless=false: ユーザー操作用（可視）
 * session_dir とプロキシは DB から自動で読み込む。
 */
export async function getContext(accountId: number, headless = false): Promise<BrowserContext> {
  const entry = pool.get(accountId)
  if (entry) return entry.ctx

  const account = getAccountById(accountId)
  if (!account) throw new Error(`Account ${accountId} not found`)

  fs.mkdirSync(account.session_dir, { recursive: true })

  const fp = generateFingerprint(accountId)

  const proxy: ProxyConfig | undefined = account.proxy_url
    ? {
        server: account.proxy_url,
        username: account.proxy_username ?? undefined,
        password: account.proxy_password ?? undefined,
      }
    : undefined

  const ctx = await chromium.launchPersistentContext(account.session_dir, {
    ...BASE_LAUNCH_OPTIONS,
    headless,
    userAgent: fp.userAgent,
    locale: fp.language,
    timezoneId: fp.timezone,
    viewport: { width: fp.screenWidth, height: fp.screenHeight },
    ...(proxy ? { proxy } : {}),
  })

  // Inject JS overrides (runs before every page's scripts)
  await ctx.addInitScript(buildOverrideScript(fp))

  // ユーザーがブラウザウィンドウを閉じたとき自動でプールから削除
  ctx.on('close', () => {
    pool.delete(accountId)
    notifyStatusChange()
  })

  // Electron セッション (persist:account-N) のCookieをPlaywrightに同期
  await syncElectronCookiesToContext(ctx, accountId)

  pool.set(accountId, { ctx, busy: 0 })
  notifyStatusChange()
  return ctx
}

/**
 * Electron の persist:account-N セッションに保存されているCookieを
 * Playwright コンテキストに注入する（初回起動時の同期）。
 */
async function syncElectronCookiesToContext(ctx: BrowserContext, accountId: number): Promise<void> {
  try {
    // electron モジュールは main process 側なので動的 import で循環参照を回避
    const { session } = await import('electron')
    const sess = session.fromPartition(`persist:account-${accountId}`)
    const electronCookies = await sess.cookies.get({})
    if (electronCookies.length === 0) return

    const yearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
    const toAdd: Cookie[] = []
    for (const c of electronCookies) {
      if (!c.value || !c.domain) continue
      toAdd.push({
        name:     c.name,
        value:    c.value,
        domain:   c.domain,
        path:     c.path ?? '/',
        expires:  c.expirationDate ?? yearFromNow,
        httpOnly: c.httpOnly ?? false,
        secure:   c.secure ?? true,
        sameSite: (c.sameSite === 'strict' ? 'Strict'
                 : c.sameSite === 'lax'    ? 'Lax'
                 : 'None') as Cookie['sameSite'],
      })
    }
    if (toAdd.length > 0) await ctx.addCookies(toAdd)
  } catch { /* Electron not ready yet or session not found — ignore */ }
}

/**
 * プールに既に存在するコンテキストからCookieを返す。
 * コンテキストが開いていない場合は null を返す（ブラウザを起動しない）。
 */
export async function getContextCookiesIfOpen(accountId: number): Promise<Cookie[] | null> {
  const entry = pool.get(accountId)
  if (!entry) return null
  try {
    return await entry.ctx.cookies()
  } catch {
    return null
  }
}

/**
 * 自動化タスク用: ヘッドレスで context を取得し、排他的にタスクを実行する。
 * 既にプールに可視コンテキストがある場合はそれを再利用する。
 * busy カウントを上げて状態変化を通知する。
 */
export async function withContext<T>(
  accountId: number,
  task: (ctx: BrowserContext) => Promise<T>
): Promise<T> {
  const ctx = await getContext(accountId, true) // 自動化はヘッドレス（不可視）
  const entry = pool.get(accountId)!
  entry.busy++
  notifyStatusChange()
  try {
    return await task(ctx)
  } finally {
    entry.busy--
    notifyStatusChange()
  }
}

/**
 * プロキシ変更後などにコンテキストを再起動する。
 * 次の getContext 呼び出し時に新しい設定で起動される。
 */
export async function reloadContext(accountId: number): Promise<void> {
  await closeContext(accountId)
  // 次回 getContext 時に自動で再作成される
}

export async function closeContext(accountId: number): Promise<void> {
  const entry = pool.get(accountId)
  if (entry) {
    pool.delete(accountId)
    await entry.ctx.close().catch(() => {})
    notifyStatusChange()
  }
}

export async function closeAllContexts(): Promise<void> {
  const ids = [...pool.keys()]
  await Promise.allSettled(ids.map(closeContext))
}

/**
 * ログイン専用ブラウザ（プールに入れない一時的な context）。
 */
export async function openLoginBrowser(
  sessionDir: string,
  proxy?: ProxyConfig
): Promise<BrowserContext> {
  fs.mkdirSync(sessionDir, { recursive: true })
  return chromium.launchPersistentContext(sessionDir, {
    ...BASE_LAUNCH_OPTIONS,
    headless: false, // ログイン UI はユーザーが操作するため可視
    viewport: { width: 480, height: 800 },
    ...(proxy ? { proxy } : {}),
  })
}
