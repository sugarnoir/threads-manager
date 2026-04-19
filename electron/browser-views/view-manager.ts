import { WebContentsView, session, BrowserWindow, net, clipboard, nativeImage, powerMonitor } from 'electron'
import { toRomaji } from 'wanakana'
import { loadOrCreateFingerprint, buildOverrideScript, writeAccountPreload } from '../fingerprint'
import { pickRandomIphoneUA } from '../utils/iphone-ua'
import { getContextCookiesIfOpen, closeContext } from '../playwright/browser-manager'
import fs from 'fs'
import { getSetting, setSetting } from '../db/repositories/settings'
import { getAccountById, updateAccountStatus } from '../db/repositories/accounts'
import { sendDiscordNotification } from '../discord'

/** チャレンジ（人間確認）ページのURLパターン */
const CHALLENGE_URL_PATTERNS = [
  '/accounts/suspended/',
  '/challenge/',
  'checkpoint',
  '/accounts/login/challenge/',
]

function isChallengeUrl(url: string): boolean {
  return CHALLENGE_URL_PATTERNS.some(p => url.includes(p))
}

/** 「別のアカウントにログイン」など、セッション切れを示すURLパターン */
const SWITCH_ACCOUNT_PATTERNS = [
  '/switch_account',
  'switch_user',
  '/accounts/login',
  '/login',
]

function isSwitchAccountUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('threads.com') && !u.hostname.includes('threads.net')) return false
    return SWITCH_ACCOUNT_PATTERNS.some(p => u.pathname.startsWith(p))
  } catch { return false }
}

const THREADS_URL = 'https://www.threads.com'
const LOGIN_URL   = `${THREADS_URL}/login`

/** サイドバー幅（CSS の w-60 = 15rem = 240px に対応）*/
const SIDEBAR_WIDTH = 240

// ── Cookie helpers ─────────────────────────────────────────────────────────────

export interface RawCookie {
  name: string
  value: string
  domain?: string | null
  path?: string | null
  secure?: boolean | null
  httpOnly?: boolean | null
  expirationDate?: number
  expires?: number
  sameSite?: string | null
}

function toElectronSameSite(v?: string | null): 'no_restriction' | 'lax' | 'strict' {
  if (v === 'Strict' || v === 'strict') return 'strict'
  if (v === 'Lax'    || v === 'lax')    return 'lax'
  return 'no_restriction'
}

export async function injectCookies(cookies: RawCookie[], sess: Electron.Session): Promise<boolean> {
  const yearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 3600

  const hasSession = cookies.some(
    (c) =>
      c.name === 'sessionid' &&
      c.value?.length > 0 &&
      (c.domain?.includes('threads.com') || c.domain?.includes('instagram.com'))
  )
  console.log(`[injectCookies] total=${cookies.length} hasSession=${hasSession}`)
  if (!hasSession) return false

  let setCount = 0
  let failCount = 0
  await Promise.all(cookies.map(async (c) => {
    if (!c.value || !c.domain) {
      console.log(`[injectCookies] SKIP name=${c.name} (no value or domain)`)
      return
    }
    const expiry = c.expirationDate ?? (c.expires !== undefined && c.expires > 0 ? c.expires : yearFromNow)
    const url = `https://${c.domain.replace(/^\./, '')}`
    const sameSite = toElectronSameSite(c.sameSite)
    // Chromium: SameSite=None (no_restriction) は Secure=true が必須
    const secure = sameSite === 'no_restriction' ? true : (c.secure ?? true)
    try {
      await sess.cookies.set({
        url,
        name:           c.name,
        value:          c.value,
        domain:         c.domain,
        path:           c.path ?? '/',
        secure,
        httpOnly:       c.httpOnly ?? false,
        expirationDate: expiry,
        sameSite,
      })
      setCount++
    } catch (e) {
      failCount++
      console.error(`[injectCookies] FAIL name=${c.name} domain=${c.domain} url=${url} secure=${secure} sameSite=${sameSite} error=${(e as Error)?.message}`)
    }
  }))
  console.log(`[injectCookies] done: set=${setCount} fail=${failCount}`)

  return true
}

// ── Profile extraction (main process → Instagram API) ─────────────────────────
//
// メインプロセスから net.fetch で Instagram API を直接叩く。
// レンダラー側の fetch と違い CORS 制限がないため確実に取得できる。
// ds_user_id Cookie → /api/v1/users/{id}/info/ → username + full_name

export async function fetchProfileFromInstagram(
  cookies: Electron.Cookie[],
  popupWebContents?: Electron.WebContents
): Promise<{ username: string; displayName: string | null }> {
  const cookieNames = cookies.map(c => c.name).join(', ')
  console.log(`[fetchProfile] total_cookies=${cookies.length} names=${cookieNames}`)

  const dsUserId  = cookies.find((c) => c.name === 'ds_user_id')?.value
  const csrfToken = cookies.find((c) => c.name === 'csrftoken')?.value ?? ''
  console.log(`[fetchProfile] ds_user_id=${dsUserId ?? 'NOT_FOUND'} csrfToken=${csrfToken ? csrfToken.slice(0,8)+'…' : 'NONE'}`)

  // ── 1. ポップアップ内 JS で fetch（threads.com コンテキスト・Cookie 自動送信） ──
  // ポップアップがまだ生きていればページ内から直接 API を叩く。
  // CORS なし・sessionid の domain 問題もなし。
  if (popupWebContents && !popupWebContents.isDestroyed()) {
    try {
      const result = await popupWebContents.executeJavaScript(`
        (async () => {
          try {
            const r = await fetch('/api/v1/accounts/current_user/?edit=true', {
              headers: { 'X-IG-App-ID': '238260118697367' }
            })
            const d = await r.json()
            console.log('[fetchProfile:js] status=' + r.status + ' user=' + JSON.stringify(d.user))
            return { ok: r.ok, status: r.status, username: d.user?.username || null, displayName: d.user?.full_name || null }
          } catch(e) {
            return { ok: false, status: 0, error: String(e) }
          }
        })()
      `) as { ok: boolean; status: number; username?: string | null; displayName?: string | null; error?: string }
      console.log(`[fetchProfile] js_fetch status=${result.status} username=${result.username ?? 'null'} error=${result.error ?? '-'}`)
      if (result.ok && result.username) return { username: result.username, displayName: result.displayName ?? null }
    } catch (e) {
      console.error(`[fetchProfile] js_fetch exception: ${e}`)
    }
  }

  // ── 2. session.fetch() で threads.com API を叩く ──
  const popupSession = popupWebContents && !popupWebContents.isDestroyed()
    ? popupWebContents.session
    : undefined
  if (popupSession) {
    for (const endpoint of [
      'https://www.threads.com/api/v1/accounts/current_user/?edit=true',
      dsUserId ? `https://www.threads.com/api/v1/users/${dsUserId}/info/` : null,
    ]) {
      if (!endpoint) continue
      try {
        const resp = await popupSession.fetch(endpoint, {
          headers: {
            'X-IG-App-ID': '238260118697367',
            'X-CSRFToken': csrfToken,
            'User-Agent':  'Barcelona 289.0.0.77.109 Android',
          },
        })
        console.log(`[fetchProfile] session_fetch endpoint=${endpoint.replace('https://www.threads.com','')} status=${resp.status}`)
        if (resp.ok) {
          const data = await resp.json() as { user?: { username?: string; full_name?: string } }
          const username    = data.user?.username?.trim()  || null
          const displayName = data.user?.full_name?.trim() || null
          console.log(`[fetchProfile] session_fetch username=${username ?? 'null'}`)
          if (username) return { username, displayName }
        } else {
          const body = await resp.text().catch(() => '')
          console.warn(`[fetchProfile] session_fetch error body=${body.slice(0, 200)}`)
        }
      } catch (e) {
        console.error(`[fetchProfile] session_fetch exception: ${e}`)
      }
    }
  }

  // ── 3. instagram.com API（threads.com cookie + Instagram App ID）──
  if (dsUserId) {
    const cookieHeader = cookies
      .filter((c) => c.value && (c.domain?.includes('instagram.com') || c.domain?.includes('threads.com')))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')
    try {
      const resp = await net.fetch(
        `https://i.instagram.com/api/v1/users/${dsUserId}/info/`,
        {
          headers: {
            Cookie:        cookieHeader,
            'X-CSRFToken': csrfToken,
            'X-IG-App-ID': '936619743392459',
            'User-Agent':  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
          },
        }
      )
      console.log(`[fetchProfile] ig_api status=${resp.status}`)
      if (resp.ok) {
        const data = await resp.json() as { user?: { username?: string; full_name?: string } }
        const username    = data.user?.username?.trim()  || null
        const displayName = data.user?.full_name?.trim() || null
        console.log(`[fetchProfile] ig_api username=${username ?? 'null'}`)
        if (username) return { username, displayName }
      } else {
        const body = await resp.text().catch(() => '')
        console.warn(`[fetchProfile] ig_api error body=${body.slice(0, 200)}`)
      }
    } catch (e) {
      console.error(`[fetchProfile] ig_api exception: ${e}`)
    }
  }

  console.warn(`[fetchProfile] all methods failed, returning unknown`)
  return { username: 'unknown', displayName: null }
}

// ── StatusCheckResult ─────────────────────────────────────────────────────────

export type AccountStatus = 'active' | 'needs_login' | 'frozen' | 'error' | 'challenge'

export interface StatusCheckResult {
  status: AccountStatus
  message?: string
}

const FROZEN_KEYWORDS = [
  'account has been disabled',
  'account was disabled',
  'suspended',
  'temporarily blocked',
  'temporarily restricted',
  'アカウントが無効',
  '一時的にブロック',
  '一時的に制限',
  'ご利用いただけません',
  'account disabled',
  'we suspended your account',
]

// ── ViewInfo ──────────────────────────────────────────────────────────────────

export interface ViewInfo {
  accountId: number
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isActive: boolean
}

// ── ViewManager ────────────────────────────────────────────────────────────────
//
// マルチビュー構造：アカウントごとに WebContentsView を Map で保持する。
// アカウント切り替え時は現在のビューを非表示にして別のビューを表示するだけ。
// 各ビューのセッション・ページ状態はメモリ上に維持され、リロードは発生しない。

/** ゼロサイズ bounds = 「非表示」扱い（removeChildView は使わない）*/
const HIDDEN_BOUNDS: Electron.Rectangle = { x: 0, y: 0, width: 0, height: 0 }

interface ViewEntry {
  view:             WebContentsView
  restoringSession: boolean
  /** loadURL を 1 度だけ実行するためのフラグ */
  loaded:           boolean
}

export interface CapturedResponse {
  url:          string
  body:         string
  timestamp:    number
  friendlyName: string
}

export interface FollowerCandidate {
  pk:       string
  username: string
}

export class ViewManager {
  private views:           Map<number, ViewEntry> = new Map()
  private activeAccountId: number | null          = null
  private mainWindow:      BrowserWindow
  private onChanged:       ((infos: ViewInfo[]) => void) | null = null

  private notifyTimer:    ReturnType<typeof setTimeout> | null    = null
  private showQueue:      Promise<void>                            = Promise.resolve()
  private healthInterval: ReturnType<typeof setInterval> | null   = null

  // CDP キャプチャ
  private capturedData:       CapturedResponse[] = []
  private cdpEnabledAccounts: Set<number>        = new Set()

  constructor(win: BrowserWindow) {
    this.mainWindow = win
    this._setupPowerMonitor()
    this._startHealthCheck()
  }

  /** スリープ復帰時に全ビューを再描画する */
  private _setupPowerMonitor(): void {
    powerMonitor.on('resume', () => {
      console.log('[ViewManager] powerMonitor resume — nudging all views')
      for (const [accountId] of this.views) {
        this.nudgeRepaint(accountId)
      }
    })
  }

  /** 30秒ごとに body.offsetHeight をチェックし、0ならリロード */
  private _startHealthCheck(): void {
    this.healthInterval = setInterval(() => {
      for (const [accountId, entry] of this.views) {
        if (!entry.loaded || entry.view.webContents.isDestroyed()) continue
        const b = entry.view.getBounds()
        if (b.x < 0 || b.width <= 0 || b.height <= 0) continue   // offscreen/hidden
        const url = entry.view.webContents.getURL() ?? ''
        if (!url.includes('threads.com') || url.includes('/login')) continue

        entry.view.webContents.executeJavaScript('document.body ? document.body.offsetHeight : -1')
          .then((h: unknown) => {
            console.log(`[ViewManager] health account=${accountId} offsetHeight=${h}`)
            if (h === 0) {
              console.warn(`[ViewManager] health: blank body detected for account=${accountId}, reloading`)
              entry.view.webContents.reload()
            }
          })
          .catch(() => {})
      }
    }, 30_000)
  }

  setOnChanged(cb: (infos: ViewInfo[]) => void): void {
    this.onChanged = cb
  }

  private notify(): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer)
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      if (this.mainWindow.isDestroyed()) return
      this.onChanged?.(this.getViewInfos())
    }, 150)
  }

  // x と width はウィンドウサイズと SIDEBAR_WIDTH 定数から算出する
  private calcBounds(y: number, height: number): Electron.Rectangle {
    const cb = this.mainWindow.getContentBounds()
    const bounds = {
      x:      SIDEBAR_WIDTH,
      y,
      width:  Math.max(cb.width - SIDEBAR_WIDTH, 0),
      height: Math.max(height, 0),
    }
    console.log('[calcBounds] contentBounds=', cb, '→ viewBounds=', bounds)
    return bounds
  }

  /**
   * ビューを画面外（左外）に移動して「非表示」にする。
   * HIDDEN_BOUNDS (0×0) と異なり GPU コンポジターサーフェスが保持されるため
   * 再表示時に黒くなる問題が起きない。
   */
  private moveOffscreen(view: WebContentsView): void {
    const b = view.getBounds()
    if (b.width <= 0 || b.height <= 0) return
    view.setBounds({ ...b, x: -(b.width + SIDEBAR_WIDTH + 100) })
  }

  // ── Session cookie management ─────────────────────────────────────────────

  private backupCookiesToDb(accountId: number, cookies: RawCookie[]): void {
    try {
      setSetting(`session_cookies_${accountId}`, JSON.stringify(cookies))
    } catch { /* DB not ready */ }
  }

  private async ensureSessionCookies(accountId: number, sess: Electron.Session): Promise<boolean> {
    const existing = await sess.cookies.get({ name: 'sessionid' }).catch(() => [])
    const hasValid = existing.some(
      (c) =>
        c.value.length > 0 &&
        (c.domain?.includes('threads.com') || c.domain?.includes('instagram.com'))
    )
    if (hasValid) return true

    console.log(`[ViewManager] account-${accountId}: no session cookie, trying to restore...`)

    const playwrightCookies = await getContextCookiesIfOpen(accountId)
    if (playwrightCookies && playwrightCookies.length > 0) {
      const ok = await injectCookies(playwrightCookies, sess)
      if (ok) {
        console.log(`[ViewManager] account-${accountId}: restored from Playwright pool`)
        return true
      }
    }

    try {
      const json = getSetting(`session_cookies_${accountId}`)
      if (json) {
        const cookies = JSON.parse(json) as RawCookie[]
        const ok = await injectCookies(cookies, sess)
        if (ok) {
          console.log(`[ViewManager] account-${accountId}: restored from DB backup`)
          return true
        }
      }
    } catch { /* JSON parse error or DB missing */ }

    console.log(`[ViewManager] account-${accountId}: could not restore session — re-login required`)
    return false
  }

  /**
   * セッション切れが確定した際に呼び出す自動リセット処理。
   * 「別のアカウントにログイン」画面検知時や Cookie 復元失敗時に使用。
   */
  private async autoResetSession(accountId: number): Promise<void> {
    console.warn(`[ViewManager] account-${accountId}: auto-resetting session`)

    // 1. WebContentsView の Electron セッション消去
    try {
      const sess = session.fromPartition(`persist:account-${accountId}`)
      await sess.clearStorageData()
    } catch { /* ignore */ }

    // 2. Playwright コンテキスト閉じる + session_dir 削除
    await closeContext(accountId).catch(() => {})
    const account = getAccountById(accountId)
    if (account?.session_dir) {
      try { fs.rmSync(account.session_dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }

    // 3. DB の Cookie バックアップ削除
    try { setSetting(`session_cookies_${accountId}`, '') } catch { /* ignore */ }

    // 4. ステータスを needs_login に更新
    try { updateAccountStatus(accountId, 'needs_login') } catch { /* ignore */ }

    // 5. フロントエンドに通知
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('accounts:session-expired', { account_id: accountId })
    }

    // 6. Discord 通知
    const acct = getAccountById(accountId)
    sendDiscordNotification({
      event:    'account_error',
      username: acct?.username ?? String(accountId),
      message:  'セッションが切れました。再ログインが必要です。',
    }).catch(() => {})

    // 7. WebContentsView を閉じる（再ログインはフロントエンドから操作）
    try { this.closeView(accountId) } catch { /* ignore */ }
  }

  // ── View creation ─────────────────────────────────────────────────────────

  private makeView(accountId: number): WebContentsView {
    const partition = `persist:account-${accountId}`
    const sess = session.fromPartition(partition)

    // DBからフィンガープリントを取得（なければ生成してDBに保存）
    // ※ setProxy は _bgInitView で loadURL より前に await する。
    //   fire-and-forget にすると loadURL 開始後に proxy が設定され、
    //   Chromium が接続を再確立 → did-finish-load が複数回発火 →
    //   nudgeRepaint の setTimeout が干渉して黒画面になるため。
    const fp = loadOrCreateFingerprint(accountId)
    const overrideScript = buildOverrideScript(fp)

    sess.setUserAgent(fp.userAgent)

    // Accept-Language ヘッダーをフィンガープリントに合わせて設定
    sess.webRequest.onBeforeSendHeaders(
      { urls: ['*://*.threads.com/*', '*://*.threads.net/*', '*://*.instagram.com/*'] },
      (details, cb) => {
        details.requestHeaders['Accept-Language'] = fp.languages.join(',')
        cb({ requestHeaders: details.requestHeaders })
      }
    )

    try {
      const preloadPath = writeAccountPreload(accountId, fp)
      sess.setPreloads([preloadPath])
    } catch { /* skip if file write fails */ }

    const view = new WebContentsView({
      webPreferences: {
        session: sess,
        nodeIntegration: false,
        contextIsolation: true,
        devTools: false,
        backgroundThrottling: false,
      },
    })
    // 配布ビルドで vibrancy ウィンドウ上の WebContentsView が黒くなるのを防ぐ
    view.setBackgroundColor('#ffffff')

    // WebRTC IPリーク対策
    // プロキシ使用時: 非プロキシ UDP を全面無効（WebRTC 経由でリアル IP が漏れない）
    // プロキシなし: パブリック IP のみ使用（ローカル LAN アドレスを隠蔽）
    try {
      const acct = getAccountById(accountId)
      view.webContents.setWebRTCIPHandlingPolicy(
        acct?.proxy_url ? 'disable_non_proxied_udp' : 'default_public_interface_only'
      )
    } catch { /* Electron バージョン差異に備えて無視 */ }

    // dom-ready 時にも再注入（preload の async 注入を補完）
    view.webContents.on('dom-ready', () => {
      if (!view.webContents.isDestroyed()) {
        view.webContents.executeJavaScript(overrideScript).catch(() => {})
      }
    })

    // ── 全ナビゲーション後の GPU 再描画 ─────────────────────────────────────
    // _bgInitView の once('did-finish-load') は初回ロードのみ。
    // navigate() や SPA 遷移後も白画面にならないよう永続リスナーで必ず nudge する。
    view.webContents.on('did-finish-load', () => {
      console.log(`[did-finish-load] account=${accountId} url=${view.webContents.getURL().slice(0, 80)}`)
      setTimeout(() => this.nudgeRepaint(accountId),  100)
      setTimeout(() => this.nudgeRepaint(accountId),  500)
      setTimeout(() => this.nudgeRepaint(accountId), 1500)
      setTimeout(() => this.nudgeRepaint(accountId), 3000)
    })

    view.webContents.on('did-navigate', (_event, url) => {
      this.notify()
      const entry = this.views.get(accountId)

      // チャレンジ（人間確認）ページ検知
      if (isChallengeUrl(url)) {
        console.warn(`[did-navigate] account=${accountId} challenge URL detected: ${url}`)
        try { updateAccountStatus(accountId, 'challenge') } catch { /* DB error */ }
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('accounts:challenge-detected', { account_id: accountId, url })
        }
        const acct = getAccountById(accountId)
        sendDiscordNotification({
          event:    'account_error',
          username: acct?.username ?? String(accountId),
          message:  '「人間であることを確認してください」のチャレンジページが表示されました。',
          detail:   url,
        }).catch(() => {})
        return
      }

      if (entry && this.isLoginUrl(url) && !entry.restoringSession) {
        // ログインページへ遷移: Cookie バックアップから自動復元を試みる
        entry.restoringSession = true
        this.ensureSessionCookies(accountId, sess).then((restored) => {
          if (entry) entry.restoringSession = false
          if (restored && this.views.has(accountId) && !view.webContents.isDestroyed()) {
            view.webContents.loadURL(THREADS_URL)
          } else if (!restored) {
            // Cookie 復元失敗 = セッション切れ確定 → 自動リセット
            console.warn(`[did-navigate] account=${accountId} session restore failed, auto-resetting`)
            this.autoResetSession(accountId).catch(() => {})
          }
        }).catch(() => { if (entry) entry.restoringSession = false })

      } else if (entry && !this.isLoginUrl(url) && (url.includes('threads.com') || url.includes('threads.net'))) {
        // ログインページ以外の threads.com へ遷移 = ログイン成功
        // Cookie を確認してセッションが存在すれば DB を active に更新
        sess.cookies.get({}).then((cookies) => {
          const hasSession = cookies.some(
            (c) => c.name === 'sessionid' && c.value.length > 0 &&
              (c.domain?.includes('threads.com') || c.domain?.includes('instagram.com'))
          )
          if (!hasSession) return
          try { updateAccountStatus(accountId, 'active') } catch { /* DB error */ }
          // Cookie を DB にバックアップ（セッション切れ復元に使用）
          const rawCookies = cookies
            .filter((c) => c.value && c.domain)
            .map((c) => ({
              name:           c.name,
              value:          c.value,
              domain:         c.domain,
              path:           c.path,
              secure:         c.secure,
              httpOnly:       c.httpOnly,
              expirationDate: c.expirationDate,
              sameSite:       c.sameSite,
            }))
          this.backupCookiesToDb(accountId, rawCookies)
          console.log(`[did-navigate] account=${accountId} logged in via WebContentsView → status=active`)
        }).catch(() => {})
      }
    })
    view.webContents.on('did-navigate-in-page', (_event, url) => {
      this.notify()
      this.nudgeRepaint(accountId)
      // チャレンジ（人間確認）ページ検知
      if (isChallengeUrl(url)) {
        console.warn(`[did-navigate-in-page] account=${accountId} challenge URL detected: ${url}`)
        try { updateAccountStatus(accountId, 'challenge') } catch { /* DB error */ }
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('accounts:challenge-detected', { account_id: accountId, url })
        }
        const acct = getAccountById(accountId)
        sendDiscordNotification({
          event:    'account_error',
          username: acct?.username ?? String(accountId),
          message:  '「人間であることを確認してください」のチャレンジページが表示されました。',
          detail:   url,
        }).catch(() => {})
        return
      }
      // 「別のアカウントにログイン」など login ページへの SPA 遷移検知
      if (isSwitchAccountUrl(url)) {
        console.warn(`[did-navigate-in-page] account=${accountId} login page detected (SPA): ${url}`)
        const sess2 = session.fromPartition(`persist:account-${accountId}`)
        this.ensureSessionCookies(accountId, sess2).then((restored) => {
          if (restored && this.views.has(accountId) && !view.webContents.isDestroyed()) {
            view.webContents.loadURL(THREADS_URL)
          } else if (!restored) {
            this.autoResetSession(accountId).catch(() => {})
          }
        }).catch(() => {})
        return
      }
      // スレッド投稿ページへの遷移を検出
      if (url.includes('/post/')) {
        console.log(`[THREAD_NAV] account=${accountId} navigated to post page: ${url}`)
      }
    })
    view.webContents.on('page-title-updated',   () => this.notify())

    // プロキシ認証（407）に自動応答する
    try {
      const acct = getAccountById(accountId)
      console.log(`[makeView] account=${accountId} proxy_url=${acct?.proxy_url ?? 'none'} proxy_username=${acct?.proxy_username ?? 'none'}`)
      if (acct?.proxy_username) {
        view.webContents.on('login', (event, _details, authInfo, callback) => {
          console.log(`[login event] account=${accountId} isProxy=${authInfo.isProxy} host=${authInfo.host} scheme=${authInfo.scheme}`)
          if (authInfo.isProxy) {
            event.preventDefault()
            console.log(`[login event] → responding with credentials for account=${accountId}`)
            callback(acct.proxy_username!, acct.proxy_password ?? '')
          }
        })
        console.log(`[makeView] login event listener registered for account=${accountId}`)
      } else {
        console.log(`[makeView] no proxy_username → login listener NOT registered for account=${accountId}`)
      }
    } catch (err) { console.error(`[makeView] proxy setup error account=${accountId}:`, err) }

    // [IMG_CAPTURE] instagram/threads への画像関連POSTリクエストをログ出力
    sess.webRequest.onBeforeRequest(
      { urls: ['*://*.instagram.com/*', '*://*.threads.com/*', '*://*.threads.net/*'] },
      (details, cb) => {
        if (details.method === 'POST') {
          const url = details.url
          let body = ''
          if (details.uploadData) {
            for (const chunk of details.uploadData) {
              if ('bytes' in chunk && chunk.bytes) {
                try { body += Buffer.from(chunk.bytes).toString('utf8') } catch { /* binary */ }
              }
            }
          }
          console.log(`[POST_CAPTURE] account=${accountId} POST ${url}`)
          if (body && (body.includes('LikeMutation') || body.includes('FollowMutation') || body.includes('UnlikeMutation') || body.includes('UnfollowMutation'))) {
            console.log(`[MUTATION_CAPTURE] account=${accountId} POST ${url}`)
            console.log(`[MUTATION_CAPTURE] body: ${body}`)
          }
          if (url.includes('configure_text_only_post')) {
            console.log(`[CONFIGURE_POST_BODY] account=${accountId} body: ${body}`)
          }
        }
        cb({})
      }
    )
    // いいね・フォロー・GraphQL操作を広くキャプチャ
    sess.webRequest.onBeforeSendHeaders(
      { urls: ['*://*.threads.com/*', '*://*.instagram.com/*', '*://*.threads.net/*', '*://*.cdninstagram.com/*'] },
      (details, cb) => {
        if (details.method === 'POST') {
          console.log(`[ENGAGE_CAPTURE] account=${accountId} POST ${details.url}`)
          console.log(`[ENGAGE_CAPTURE] headers: ${JSON.stringify(details.requestHeaders)}`)
        }
        cb({ requestHeaders: details.requestHeaders })
      }
    )

    // ── CDP 自動有効化 ────────────────────────────────────────────────────────
    // makeView 時点では this.views にまだ登録されていないため、
    // enableCdpCapture() を経由せず view を直接使ってアタッチする。
    this.cdpEnabledAccounts.add(accountId)
    const dbgAuto = view.webContents.debugger
    try { dbgAuto.attach('1.3') } catch { /* already attached */ }
    dbgAuto.sendCommand('Network.enable').catch((e: unknown) => {
      console.error(`[CDP] Network.enable failed (auto) account=${accountId}:`, e)
    })

    // requestId → X-FB-Friendly-Name の対応表（リクエスト→レスポンス紐付け用）
    const friendlyNames = new Map<string, string>()

    dbgAuto.on('message', async (_event, method, params: Record<string, unknown>) => {
      // ── リクエスト送信時: X-FB-Friendly-Name を記録 ──────────────────────
      if (method === 'Network.requestWillBeSent') {
        type ReqParams = { requestId: string; request?: { url?: string; headers?: Record<string, string>; postData?: string } }
        const p = params as ReqParams
        const friendlyName = p.request?.headers?.['X-FB-Friendly-Name'] ?? ''
        if (friendlyName) friendlyNames.set(p.requestId, friendlyName)
        // リクエストボディからクエリ名・URLを全ログ出力（一時デバッグ用）
        if (p.request?.url?.includes('graphql') || p.request?.url?.includes('/api/v1/')) {
          const url = p.request.url ?? ''
          const body = p.request.postData ?? ''
          // doc_id, __d (query name) などを抽出
          const docId = body.match(/doc_id=([^&]+)/)?.[1] ?? ''
          const rootField = p.request.headers?.['X-Root-Field-Name'] ?? ''
          console.log(`[REQ_CAPTURE] account=${accountId} [${friendlyName||'?'}] ${url.slice(0,70)} doc_id=${docId} root=${rootField}`)
          if (friendlyName === 'BarcelonaActivityFeedStoryListContainerQuery' && body) {
            const vars = body.match(/variables=([^&]+)/)?.[1] ?? ''
            console.log(`[NOTIF_VARS] doc_id=${docId} variables=${decodeURIComponent(vars)}`)
          }
          if (friendlyName === 'useBarcelonaEditProfileMutation' && body) {
            console.log(`[DOC_ID_CAPTURE] postData: ${body}`)
          }
          if (url.includes('configure_text_only_post')) {
            console.log(`[CDP_CONFIGURE_POST] account=${accountId} postData: ${body}`)
          }
        }
        return
      }

      if (method !== 'Network.responseReceived') return
      type RawResp = { url?: string }
      const url = (params.response as RawResp | undefined)?.url ?? ''
      if (
        !url.includes('threads.net') &&
        !url.includes('threads.com') &&
        !url.includes('instagram.com')
      ) return
      if (
        !url.includes('graphql') &&
        !url.includes('/api/v1/') &&
        !url.includes('/api/graphql')
      ) return
      const requestId = params.requestId as string
      const friendlyName = friendlyNames.get(requestId) ?? ''
      friendlyNames.delete(requestId)
      try {
        type BodyResult = { body: string; base64Encoded: boolean }
        const result = await dbgAuto.sendCommand('Network.getResponseBody', { requestId }) as BodyResult
        const bodyText = result.base64Encoded
          ? Buffer.from(result.body, 'base64').toString('utf8')
          : result.body
        this.capturedData.push({ url, body: bodyText, timestamp: Date.now(), friendlyName: friendlyName || 'unknown' })
        console.log(`[CDP] captured account=${accountId} [${friendlyName || 'unknown'}] ${url.slice(0, 60)} (${bodyText.length} bytes)`)

      } catch { /* body not available */ }
    })
    console.log(`[CDP] auto-enabled for account=${accountId}`)

    return view
  }

  // ── CDP Response Capture ─────────────────────────────────────────────────

  /**
   * 指定アカウントの WebContentsView に CDP（Chrome DevTools Protocol）を
   * アタッチし、Threads / Instagram GraphQL レスポンス本文をメモリに蓄積する。
   * 競合アカウントのフォロワー一覧・リプライ一覧を手動操作でキャプチャする用途。
   */
  enableCdpCapture(accountId: number): boolean {
    const entry = this.views.get(accountId)
    if (!entry) return false
    if (this.cdpEnabledAccounts.has(accountId)) return true

    const dbg = entry.view.webContents.debugger
    try {
      dbg.attach('1.3')
    } catch { /* already attached */ }

    dbg.sendCommand('Network.enable').catch((e: unknown) => {
      console.error('[CDP] Network.enable failed:', e)
    })

    dbg.on('message', async (_event, method, params: Record<string, unknown>) => {
      if (method !== 'Network.responseReceived') return

      type RawResp = { url?: string; mimeType?: string }
      const url = (params.response as RawResp | undefined)?.url ?? ''

      // Threads GraphQL / API エンドポイントのみキャプチャ
      if (
        !url.includes('threads.net') &&
        !url.includes('threads.com') &&
        !url.includes('instagram.com')
      ) return
      if (
        !url.includes('graphql') &&
        !url.includes('/api/v1/') &&
        !url.includes('/api/graphql')
      ) return

      const requestId = params.requestId as string
      try {
        type BodyResult = { body: string; base64Encoded: boolean }
        const result = await dbg.sendCommand('Network.getResponseBody', { requestId }) as BodyResult
        const bodyText = result.base64Encoded
          ? Buffer.from(result.body, 'base64').toString('utf8')
          : result.body

        this.capturedData.push({ url, body: bodyText, timestamp: Date.now(), friendlyName: 'unknown' })
        console.log(`[CDP] captured ${url.slice(0, 80)} (${bodyText.length} bytes)`)
      } catch { /* body not available – streaming or already consumed */ }
    })

    this.cdpEnabledAccounts.add(accountId)
    console.log(`[ViewManager] CDP capture enabled for account=${accountId}`)
    return true
  }

  getCapturedData(): CapturedResponse[] {
    return this.capturedData
  }

  clearCapturedData(): void {
    this.capturedData = []
    console.log('[ViewManager] captured data cleared')
  }

  /**
   * CDP キャプチャ済みレスポンスから競合アカウントのフォロワー候補を抽出する。
   *
   * 対象クエリ:
   *   - BarcelonaFriendshipsFollowersTabQuery       (初回ロード)
   *   - BarcelonaFriendshipsFollowersTabRefetchableQuery (スクロールページネーション)
   *
   * 条件: friendship_status.following === false のユーザーのみ返す。
   * 重複は pk で除去。
   */
  getFollowerCandidates(): FollowerCandidate[] {
    type NodeShape = {
      pk?:               string
      username?:         string
      friendship_status?: { following?: boolean }
    }
    type EdgeShape = { node?: NodeShape }

    const seen = new Set<string>()
    const result: FollowerCandidate[] = []

    for (const entry of this.capturedData) {
      if (
        !entry.friendlyName.includes('FriendshipsFollowersTab')
      ) continue

      let parsed: unknown
      try { parsed = JSON.parse(entry.body) } catch { continue }

      // 初回: data.user.followers.edges
      // ページネーション: data.fetch__XDTUserDict.followers.edges
      const data = (parsed as Record<string, unknown>)?.data as Record<string, unknown> | undefined
      const container =
        (data?.user as Record<string, unknown> | undefined) ??
        (data?.fetch__XDTUserDict as Record<string, unknown> | undefined)

      const edges = (container?.followers as Record<string, unknown> | undefined)
        ?.edges as EdgeShape[] | undefined
      if (!Array.isArray(edges)) continue

      for (const edge of edges) {
        const node = edge.node
        if (!node?.pk || !node.username) continue
        if (node.friendship_status?.following === true) continue  // すでにフォロー済み
        if (seen.has(node.pk)) continue
        seen.add(node.pk)
        result.push({ pk: node.pk, username: node.username })
      }
    }

    console.log(`[ViewManager] getFollowerCandidates → ${result.length} users`)
    return result
  }

  /** 1 つのアカウントビューを破棄してマップから削除する */
  private destroyView(accountId: number): void {
    const entry = this.views.get(accountId)
    if (!entry) return
    try { this.mainWindow.contentView.removeChildView(entry.view) } catch { /* ok */ }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    this.views.delete(accountId)
    if (this.activeAccountId === accountId) this.activeAccountId = null
  }

  private isLoginUrl(url: string): boolean {
    try {
      const u = new URL(url)
      return (u.hostname.includes('threads.com') || u.hostname.includes('threads.net'))
        && (u.pathname.startsWith('/login') || u.pathname.startsWith('/accounts/login'))
    } catch { return false }
  }

  // ── Login flow ────────────────────────────────────────────────────────────

  async startLogin(tempKey: string): Promise<{ username: string; displayName: string | null }> {
    const partition = `persist:login-${tempKey}`

    if (this.mainWindow.isDestroyed()) throw new Error('メインウィンドウが破棄されています')
    const mainBounds = this.mainWindow.getBounds()
    const popupW = 820
    const popupH = 640
    const x = Math.round(mainBounds.x + (mainBounds.width  - popupW) / 2)
    const y = Math.round(mainBounds.y + (mainBounds.height - popupH) / 2)

    const popup = new BrowserWindow({
      width: popupW, height: popupH, x, y,
      parent: this.mainWindow,
      modal: false,
      title: 'Threads にログイン',
      titleBarStyle: 'default',
      webPreferences: { partition, nodeIntegration: false, contextIsolation: true },
    })

    // session は popup が破棄されても有効なため、先に取得しておく
    const popupSession = popup.webContents.session

    popup.loadURL(LOGIN_URL)
    popup.focus()

    return new Promise((resolve, reject) => {
      let done = false
      let pollInterval: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        clearTimeout(timer)
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
        try { if (!popup.isDestroyed()) popup.close() } catch { /* ignore */ }
      }

      const timer = setTimeout(() => {
        if (done) return
        done = true
        cleanup()
        reject(new Error('ログインタイムアウト (5分)'))
      }, 5 * 60 * 1000)

      popup.on('closed', () => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
        reject(new Error('ログインがキャンセルされました'))
      })

      const checkCookies = async () => {
        if (done) return

        let allCookies: Electron.Cookie[] = []
        try {
          allCookies = await popupSession.cookies.get({})
          if (done) return
        } catch { return }

        const hasSession = allCookies.some(
          (c) =>
            c.name === 'sessionid' &&
            c.value.length > 0 &&
            (c.domain?.includes('threads.com') || c.domain?.includes('instagram.com'))
        )
        if (!hasSession) return

        done = true
        clearTimeout(timer)
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null }

        // Cookie はすでに取得済み → ポップアップ JS + Threads API でユーザー名取得
        const wc = !popup.isDestroyed() ? popup.webContents : undefined
        const { username, displayName } = await fetchProfileFromInstagram(allCookies, wc)

        try { if (!popup.isDestroyed()) popup.close() } catch { /* ignore */ }
        resolve({ username, displayName })
      }

      pollInterval = setInterval(checkCookies, 1000)
      try {
        popup.webContents.on('did-navigate',         () => checkCookies())
        popup.webContents.on('did-navigate-in-page', () => checkCookies())
      } catch { /* webContents already destroyed */ }
    })
  }

  /** instagram.com のログインページを既存アカウントのセッションで開き、sessionid を取得 */
  async startInstagramLogin(accountId: number): Promise<void> {
    const partition = `persist:account-${accountId}`
    const acct = getAccountById(accountId)
    const mainBounds = this.mainWindow.getBounds()
    const popupW = 820
    const popupH = 640
    const x = Math.round(mainBounds.x + (mainBounds.width  - popupW) / 2)
    const y = Math.round(mainBounds.y + (mainBounds.height - popupH) / 2)

    // アカウントのセッションにプロキシと UA を事前設定
    const popupSession = session.fromPartition(partition)

    if (acct?.proxy_url) {
      let proxyRules = acct.proxy_url.trim()
      if (!/^https?:\/\/|^socks5?:\/\//i.test(proxyRules)) proxyRules = 'http://' + proxyRules
      console.log(`[InstagramLogin] account=${accountId} setProxy proxyRules=${proxyRules}`)
      await popupSession.setProxy({ proxyRules }).catch((e) =>
        console.error(`[InstagramLogin] setProxy failed: ${(e as Error)?.message}`)
      )
    }

    // アカウントの iPhone UA を使う（なければフィンガープリントから取得）
    const ua = acct?.user_agent ?? loadOrCreateFingerprint(accountId).userAgent
    popupSession.setUserAgent(ua)
    console.log(`[InstagramLogin] account=${accountId} userAgent=${ua.slice(0, 60)}...`)

    const popup = new BrowserWindow({
      width: popupW, height: popupH, x, y,
      parent: this.mainWindow,
      modal: false,
      title: 'Instagram にログイン',
      titleBarStyle: 'default',
      webPreferences: { session: popupSession, nodeIntegration: false, contextIsolation: true },
    })

    // プロキシ認証が必要な場合に自動応答
    if (acct?.proxy_username) {
      popup.webContents.on('login', (event, _details, authInfo, callback) => {
        if (authInfo.isProxy) {
          event.preventDefault()
          callback(acct.proxy_username!, acct.proxy_password ?? '')
        }
      })
    }

    popup.loadURL('https://www.instagram.com/accounts/login/')
    popup.focus()

    return new Promise((resolve, reject) => {
      let done = false
      let pollInterval: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        clearTimeout(timer)
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
        try { if (!popup.isDestroyed()) popup.close() } catch { /* ignore */ }
      }

      const timer = setTimeout(() => {
        if (done) return
        done = true
        cleanup()
        reject(new Error('Instagramログインタイムアウト (5分)'))
      }, 5 * 60 * 1000)

      popup.on('closed', () => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
        resolve()  // 手動クローズも成功扱い
      })

      const checkCookies = async () => {
        if (done) return
        try {
          const allCookies = await popupSession.cookies.get({})
          if (done) return
          const hasSession = allCookies.some(
            c => c.name === 'sessionid' && c.value.length > 0 && c.domain?.includes('instagram.com')
          )
          if (!hasSession) return
          done = true
          clearTimeout(timer)
          if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
          console.log(`[InstagramLogin] account=${accountId} sessionid obtained — waiting 7s before closing`)
          // ログイン検出後すぐに次の操作をするとbot検知されやすいため待機
          await new Promise(r => setTimeout(r, 7000))
          try { if (!popup.isDestroyed()) popup.close() } catch { /* ignore */ }
          resolve()
        } catch { return }
      }

      pollInterval = setInterval(checkCookies, 1000)
      try {
        popup.webContents.on('did-navigate',         () => checkCookies())
        popup.webContents.on('did-navigate-in-page', () => checkCookies())
      } catch { /* webContents already destroyed */ }
    })
  }

  /** Instagram の登録ページをプロキシ付きで開き、sessionid を検出したら完了 */
  async startRegister(
    tempKey: string,
    proxyUrl?: string | null,
    proxyUsername?: string | null,
    proxyPassword?: string | null,
  ): Promise<{ username: string; displayName: string | null }> {
    const INSTAGRAM_SIGNUP_URL = 'https://www.instagram.com/accounts/emailsignup/'
    const partition = `persist:login-${tempKey}`
    const sess = session.fromPartition(partition)

    // プロキシを適用してから URL を読み込む
    if (proxyUrl) {
      await sess.setProxy({ proxyRules: proxyUrl }).catch(() => {})
    }

    const mainBounds = this.mainWindow.getBounds()
    const popupW = 860
    const popupH = 700
    const x = Math.round(mainBounds.x + (mainBounds.width  - popupW) / 2)
    const y = Math.round(mainBounds.y + (mainBounds.height - popupH) / 2)

    const popup = new BrowserWindow({
      width: popupW, height: popupH, x, y,
      parent: this.mainWindow,
      modal: false,
      title: 'Instagramアカウントを作成',
      titleBarStyle: 'default',
      webPreferences: { partition, nodeIntegration: false, contextIsolation: true },
    })

    // プロキシ認証が必要な場合に自動応答
    if (proxyUsername) {
      popup.webContents.on('login', (event, _details, authInfo, callback) => {
        if (authInfo.isProxy) {
          event.preventDefault()
          callback(proxyUsername, proxyPassword ?? '')
        }
      })
    }

    popup.loadURL(INSTAGRAM_SIGNUP_URL)
    popup.focus()

    const registerSession = popup.webContents.session

    return new Promise((resolve, reject) => {
      let done = false
      let pollInterval: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        clearTimeout(timer)
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
        try { if (!popup.isDestroyed()) popup.close() } catch { /* ignore */ }
      }

      const timer = setTimeout(() => {
        if (done) return
        done = true
        cleanup()
        reject(new Error('登録タイムアウト (10分)'))
      }, 10 * 60 * 1000)

      popup.on('closed', () => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
        reject(new Error('ログインがキャンセルされました'))
      })

      const checkCookies = async () => {
        if (done) return

        let allCookies: Electron.Cookie[] = []
        try {
          allCookies = await registerSession.cookies.get({})
          if (done) return
        } catch { return }

        const hasSession = allCookies.some(
          (c) =>
            c.name === 'sessionid' &&
            c.value.length > 0 &&
            (c.domain?.includes('threads.com') || c.domain?.includes('instagram.com'))
        )
        if (!hasSession) return

        done = true
        clearTimeout(timer)
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null }

        const tempSess = session.fromPartition(partition)
        const popupWc = !popup.isDestroyed() ? popup.webContents : undefined
        let { username, displayName } = await fetchProfileFromInstagram(allCookies, popupWc)
        if (username === 'unknown') {
          for (let i = 0; i < 5; i++) {
            await new Promise(r => setTimeout(r, 1000))
            const fresh = await tempSess.cookies.get({}).catch(() => allCookies)
            const wc = !popup.isDestroyed() ? popup.webContents : undefined
            const res = await fetchProfileFromInstagram(fresh, wc)
            if (res.username !== 'unknown') { username = res.username; displayName = res.displayName; break }
          }
        }

        try { if (!popup.isDestroyed()) popup.close() } catch { /* ignore */ }
        resolve({ username, displayName })
      }

      pollInterval = setInterval(checkCookies, 1000)
      try {
        popup.webContents.on('did-navigate',         () => checkCookies())
        popup.webContents.on('did-navigate-in-page', () => checkCookies())
      } catch { /* webContents already destroyed */ }
    })
  }

  async autoRegisterAccount(
    opts: {
      name: string
      email: string
      password: string
      proxyUrl?: string | null
      proxyUsername?: string | null
      proxyPassword?: string | null
    },
    onStatus: (e: { type: string; detail?: string }) => void,
  ): Promise<{ username: string; displayName: string | null; tempKey: string }> {
    const SIGNUP_URL = 'https://www.instagram.com/accounts/signup/email/'
    const tempKey   = `temp-${Date.now()}`
    const partition = `persist:login-${tempKey}`
    const sess      = session.fromPartition(partition)

    // iPhone Safari UA を固定（セッション全体で一貫性を保つ）
    const ua = pickRandomIphoneUA()
    console.log(`[autoRegister] UA=${ua}`)
    sess.setUserAgent(ua)

    if (opts.proxyUrl) {
      let proxyUrl = opts.proxyUrl.trim()
      if (!/^https?:\/\/|^socks5?:\/\//i.test(proxyUrl)) proxyUrl = 'http://' + proxyUrl
      if (opts.proxyUsername && !proxyUrl.includes('@')) {
        // proxyRules はデコード済みの生文字列を渡す必要がある（URLエンコード不可）
        const user = opts.proxyUsername
        const pass = opts.proxyPassword ?? ''
        proxyUrl = proxyUrl.replace(/^(https?:\/\/|socks5?:\/\/)/i, `$1${user}:${pass}@`)
      }
      console.log(`[autoRegister] setProxy START partition=${partition} proxyRules=${proxyUrl}`)
      await sess.setProxy({ proxyRules: proxyUrl })
        .then(() => console.log(`[autoRegister] setProxy DONE`))
        .catch((e) => console.error(`[autoRegister] setProxy FAILED: ${(e as Error)?.message}`))
    }

    // Generate a Latin-only username
    // ひらがな/カタカナはローマ字変換してから不要文字を除去
    const romaji = toRomaji(opts.name)
    const base   = romaji.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) || 'user'
    const digits = String(Math.floor(Math.random() * 900000) + 100000)  // 6桁
    const letter = String.fromCharCode(97 + Math.floor(Math.random() * 26)) // a-z 1文字
    const username = base + digits + letter  // 例: yuki123456a

    const mainBounds = this.mainWindow.getBounds()
    const popupW = 420, popupH = 860
    const x = Math.round(mainBounds.x + (mainBounds.width  - popupW) / 2)
    const y = Math.round(mainBounds.y + (mainBounds.height - popupH) / 2)

    const popup = new BrowserWindow({
      width: popupW, height: popupH, x, y,
      parent: this.mainWindow,
      modal: false,
      resizable: false,  // リサイズ禁止（wd cookie が変わらないようにする）
      title: 'Instagram',
      titleBarStyle: 'default',
      webPreferences: { partition, nodeIntegration: false, contextIsolation: true },
    })

    popup.webContents.on('login', (event, _d, authInfo, callback) => {
      console.log(`[autoRegister] login event isProxy=${authInfo.isProxy} host=${authInfo.host}`)
      if (authInfo.isProxy && opts.proxyUsername) {
        event.preventDefault()
        callback(opts.proxyUsername, opts.proxyPassword ?? '')
      }
    })

    // window.open を同じセッション内の新ウィンドウとして開く
    // popup.loadURL で上書きすると CSRF コンテキストが壊れるため、
    // 新しいウィンドウを開いて同一セッションを共有する
    popup.webContents.setWindowOpenHandler(({ url }) => {
      console.log(`[autoRegister] window.open intercepted url=${url} → opening in same session`)
      const child = new BrowserWindow({
        width: popupW, height: popupH,
        parent: popup,
        modal: false,
        title: 'Instagram',
        webPreferences: { partition, nodeIntegration: false, contextIsolation: true },
      })
      child.loadURL(url)
      return { action: 'deny' }
    })

    // ── デバッグログ ──
    popup.webContents.on('did-start-loading', () =>
      console.log(`[autoRegister] did-start-loading url=${popup.webContents.getURL()}`))
    popup.webContents.on('did-finish-load', () =>
      console.log(`[autoRegister] did-finish-load url=${popup.webContents.getURL()}`))
    popup.webContents.on('did-fail-load', (_e, code, desc, validatedURL) =>
      console.error(`[autoRegister] did-fail-load code=${code} desc=${desc} url=${validatedURL}`))
    popup.webContents.on('did-navigate', (_e, url) =>
      console.log(`[autoRegister] did-navigate url=${url}`))
    popup.webContents.on('did-navigate-in-page', (_e, url) =>
      console.log(`[autoRegister] did-navigate-in-page url=${url}`))
    popup.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.error(`[autoRegister] console[${level}] ${message} (${sourceId}:${line})`)
    })
    // ────────────────

    popup.loadURL(SIGNUP_URL)
    popup.focus()

    let formFilled = false

    // ランダムな成人生年月日を生成（1985〜1999年）
    const bYear  = 1985 + Math.floor(Math.random() * 15)
    const bMonth = 1    + Math.floor(Math.random() * 12)
    const bDay   = 1    + Math.floor(Math.random() * 28)

    // ── フォーム自動入力 ──────────────────────────────────────────────────
    // Instagram は iPhone UA で表示するとモバイル UI になり、
    // デスクトップとはフォーム構造・セレクターが大きく異なる。
    // 複数のセレクター戦略を試し、ページ遷移のたびにリトライする。
    const tryFillForm = async () => {
      if (popup.isDestroyed() || formFilled) return
      await new Promise(r => setTimeout(r, 2500 + Math.random() * 1500))
      if (popup.isDestroyed() || formFilled) return

      try {
        const result = await popup.webContents.executeJavaScript(`
          (async function() {
            var url = location.href;
            var rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
            var wait = ms => new Promise(r => setTimeout(r, ms));

            // React controlled input に値を設定するヘルパー
            async function fill(el, val) {
              if (!el) return false;
              el.focus(); el.click();
              await wait(rand(80, 200));
              // React の value setter を使って state を更新
              var nativeSet = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
              );
              if (nativeSet && nativeSet.set) {
                nativeSet.set.call(el, val);
              } else {
                el.value = val;
              }
              el.dispatchEvent(new Event('input',  { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              await wait(rand(100, 300));
              return true;
            }

            // select 要素に値を設定
            async function selectVal(el, val) {
              if (!el) return false;
              el.value = val;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              await wait(rand(100, 300));
              return true;
            }

            // ── セレクター候補（デスクトップ / モバイル 両対応） ──
            // name 属性 → aria-label → type+順序 の優先度で検索
            function findInput(names, ariaLabels, fallbackType, fallbackIdx) {
              for (var n of names) {
                var el = document.querySelector('input[name="' + n + '"]');
                if (el) return el;
              }
              for (var a of ariaLabels) {
                var el2 = document.querySelector('input[aria-label="' + a + '"]');
                if (el2) return el2;
              }
              if (fallbackType != null) {
                var all = document.querySelectorAll('input[type="' + fallbackType + '"]');
                if (all[fallbackIdx]) return all[fallbackIdx];
              }
              return null;
            }

            // ── DOM ダンプ（デバッグ用） ──
            var inputs = Array.from(document.querySelectorAll('input')).map(function(el) {
              return { name: el.name, type: el.type, ariaLabel: el.getAttribute('aria-label'), placeholder: el.placeholder };
            });
            var selects = Array.from(document.querySelectorAll('select')).map(function(el) {
              return { name: el.name, ariaLabel: el.getAttribute('aria-label'), title: el.title };
            });
            console.log('[autoFill] url=' + url);
            console.log('[autoFill] inputs=' + JSON.stringify(inputs));
            console.log('[autoFill] selects=' + JSON.stringify(selects));

            // ── メールフィールド検出 ──
            var emailEl = findInput(
              ['emailOrPhone', 'email', 'email_or_phone'],
              ['メールアドレスまたは携帯電話番号', 'メールアドレス', 'Email or phone number', 'Email', 'Mobile Number or Email'],
              'text', 0
            );
            if (!emailEl) return { ok: false, reason: 'email_not_found', url: url, inputs: inputs };

            var filled = {};
            filled.email = await fill(emailEl, ${JSON.stringify(opts.email)});

            // ── 名前 ──
            var nameEl = findInput(
              ['fullName', 'full_name'],
              ['名前', 'Full Name', 'Full name'],
              'text', 1
            );
            if (nameEl) { filled.name = await fill(nameEl, ${JSON.stringify(opts.name)}); }

            // ── ユーザーネーム ──
            var userEl = findInput(
              ['username'],
              ['ユーザーネーム', 'Username'],
              'search', 0
            );
            if (!userEl) userEl = findInput([], [], 'text', 3);
            if (userEl) { filled.user = await fill(userEl, ${JSON.stringify(username)}); }

            // ── パスワード ──
            var pwEl = findInput(
              ['password'],
              ['パスワード', 'Password'],
              'password', 0
            );
            if (pwEl) { filled.pw = await fill(pwEl, ${JSON.stringify(opts.password)}); }

            // ── 生年月日 (select 要素の場合) ──
            var monthSel = document.querySelector('select[title="月"]')
              || document.querySelector('select[title="月:"]')
              || document.querySelector('select[aria-label="月"]')
              || document.querySelector('select[title="Month:"]');
            var daySel = document.querySelector('select[title="日"]')
              || document.querySelector('select[title="日:"]')
              || document.querySelector('select[aria-label="日"]')
              || document.querySelector('select[title="Day:"]');
            var yearSel = document.querySelector('select[title="年"]')
              || document.querySelector('select[title="年:"]')
              || document.querySelector('select[aria-label="年"]')
              || document.querySelector('select[title="Year:"]');

            if (monthSel && daySel && yearSel) {
              filled.month = await selectVal(monthSel, ${JSON.stringify(String(bMonth))});
              filled.day   = await selectVal(daySel,   ${JSON.stringify(String(bDay))});
              filled.year  = await selectVal(yearSel,  ${JSON.stringify(String(bYear))});
            }

            // ── 生年月日 (combobox の場合 — デスクトップUI) ──
            if (!monthSel) {
              async function comboSelect(label, text) {
                var combo = document.querySelector('div[role="combobox"][aria-label="' + label + '"]');
                if (!combo) return false;
                combo.click();
                await wait(rand(500, 800));
                var opts2 = Array.from(document.querySelectorAll('[role="option"]')).filter(function(e) { return e.offsetParent !== null; });
                var t = opts2.find(function(e) { return e.textContent.trim() === text; });
                if (t) { t.click(); await wait(rand(200, 400)); return true; }
                return false;
              }
              filled.year  = await comboSelect('年を選択', ${JSON.stringify(String(bYear) + '年')});
              filled.month = await comboSelect('月を選択', ${JSON.stringify(String(bMonth) + '月')});
              filled.day   = await comboSelect('日を選択', ${JSON.stringify(String(bDay) + '日')});
            }

            await wait(rand(500, 1000));
            // 送信ボタン（submit なかったら「登録する/次へ/Sign up/Next」テキストのボタン）
            var btn = document.querySelector('button[type="submit"]');
            if (!btn) {
              var btns = Array.from(document.querySelectorAll('button'));
              btn = btns.find(function(b) { return /登録|次へ|Sign up|Next/i.test(b.textContent); });
            }
            if (btn) btn.click();

            return { ok: true, url: url, filled: filled };
          })()
        `)
        console.log('[autoRegister] tryFillForm result:', JSON.stringify(result))
        if (result?.ok && result.filled?.email) {
          formFilled = true
          onStatus({ type: 'form_filled',    detail: `${opts.email} (${result.url})` })
          onStatus({ type: 'form_submitted', detail: opts.email })
        }
      } catch (e) {
        console.error('[autoRegister] tryFillForm error:', e)
      }
    }

    // ページ読み込み完了時に自動入力を試みる（リトライ付き）
    popup.webContents.on('did-finish-load', () => {
      if (!formFilled) tryFillForm()
    })
    // SPA 遷移対応
    popup.webContents.on('did-navigate-in-page', () => {
      if (!formFilled) setTimeout(() => tryFillForm(), 1500)
    })

    let codeStepNotified = false
    let codeCheckInterval: ReturnType<typeof setInterval> | null = null

    codeCheckInterval = setInterval(async () => {
      if (popup.isDestroyed() || codeStepNotified) {
        if (codeCheckInterval) clearInterval(codeCheckInterval)
        return
      }
      try {
        const hasCodeInput = await popup.webContents.executeJavaScript(`
          !!(document.querySelector('input[name="email_confirmation_code"]') ||
             document.querySelector('input[autocomplete="one-time-code"]') ||
             document.querySelector('input[inputmode="numeric"][maxlength="6"]') ||
             (document.body && (document.body.innerText.includes('確認コード') || document.body.innerText.includes('Confirm your email'))))
        `).catch(() => false)
        if (hasCodeInput && !codeStepNotified) {
          codeStepNotified = true
          if (codeCheckInterval) clearInterval(codeCheckInterval)
          onStatus({ type: 'waiting_code', detail: opts.email })
        }
      } catch { /* ignore */ }
    }, 2000)

    return new Promise((resolve, reject) => {
      let done = false
      let pollInterval: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        clearTimeout(timer)
        if (pollInterval)      clearInterval(pollInterval)
        if (codeCheckInterval) clearInterval(codeCheckInterval)
        if (!popup.isDestroyed()) popup.close()
      }

      const timer = setTimeout(() => {
        if (done) return
        done = true; cleanup()
        reject(new Error('登録タイムアウト (15分)'))
      }, 15 * 60 * 1000)

      popup.on('closed', () => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (pollInterval)      clearInterval(pollInterval)
        if (codeCheckInterval) clearInterval(codeCheckInterval)
        reject(new Error('ブラウザが閉じられました'))
      })

      const checkCookies = async () => {
        if (done) return
        try {
          if (popup.isDestroyed()) return
          const allCookies = await popup.webContents.session.cookies.get({})
          if (done) return
          const hasSession = allCookies.some(
            c => c.name === 'sessionid' && c.value.length > 0 &&
              (c.domain?.includes('threads.com') || c.domain?.includes('instagram.com'))
          )
          if (!hasSession) return

          done = true
          clearTimeout(timer)
          if (pollInterval)      clearInterval(pollInterval)
          if (codeCheckInterval) clearInterval(codeCheckInterval)

          // 登録直後にセッション移行やAPI呼出しをするとアカウントがロックされるため
          // 30秒以上待機してからウィンドウを閉じる
          console.log('[autoRegister] sessionid detected — waiting 30s before closing (anti-lock)')
          onStatus({ type: 'waiting_cooldown', detail: '登録完了。ロック防止のため30秒待機中...' })
          await new Promise(r => setTimeout(r, 30_000))

          try { if (!popup.isDestroyed()) popup.close() } catch { /* ignore */ }
          resolve({ username, displayName: opts.name, tempKey })
        } catch { /* ignore */ }
      }

      pollInterval = setInterval(checkCookies, 1500)
      popup.webContents.on('did-navigate',         () => checkCookies())
      popup.webContents.on('did-navigate-in-page', () => checkCookies())
    })
  }

  async migrateLoginSession(tempKey: string, accountId: number): Promise<void> {
    const tempSession = session.fromPartition(`persist:login-${tempKey}`)
    const permSession = session.fromPartition(`persist:account-${accountId}`)
    const cookies = await tempSession.cookies.get({})

    // DBからプロキシ情報を読み取って永続セッションに即時適用する。
    // _bgInitView でも設定するが、アカウント追加直後に showView が呼ばれた場合に
    // プロキシなしで loadURL が走るのを防ぐためここでも必ず設定する。
    const acct = getAccountById(accountId)
    if (acct?.proxy_url) {
      await permSession.setProxy({ proxyRules: acct.proxy_url }).catch(() => {})
    }

    const yearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 3600

    const normalized: RawCookie[] = cookies.map((c) => ({
      name:           c.name,
      value:          c.value,
      domain:         c.domain,
      path:           c.path,
      secure:         c.secure,
      httpOnly:       c.httpOnly,
      expirationDate: c.expirationDate ?? yearFromNow,
      sameSite:       c.sameSite,
    }))

    await injectCookies(normalized, permSession)
    this.backupCookiesToDb(accountId, normalized)
  }

  // ── View lifecycle ────────────────────────────────────────────────────────
  //
  // 全ビューは一度 addChildView したら closeView まで contentView に留まる。
  // 「非表示」= HIDDEN_BOUNDS (0,0,0,0) で描画領域をゼロにするだけ。
  // removeChildView / addChildView のサイクルを一切行わないことで
  // Electron がビューをリロードするバグを回避する。

  /**
   * 指定アカウントのビューを表示する。
   * - 既存ビューあり → bounds を更新するだけ（リロードなし）
   * - 新規アカウント → ビューを作成して contentView にアタッチ、初回のみ loadURL
   * - 前のアクティブビュー → HIDDEN_BOUNDS で隠す（removeChildView しない）
   */
  showView(accountId: number, y: number, height: number): void {
    // 前のアクティブビューを隠す（破棄・取り外しはしない）
    if (this.activeAccountId !== null && this.activeAccountId !== accountId) {
      const prev = this.views.get(this.activeAccountId)
      if (prev && !prev.view.webContents.isDestroyed()) {
        this.moveOffscreen(prev.view)
      }
    }

    const existing = this.views.get(accountId)

    if (existing && !existing.view.webContents.isDestroyed()) {
      // 既存ビューを再利用 — setBounds で表示するだけ、loadURL は呼ばない
      this.activeAccountId = accountId
      const existBounds = this.calcBounds(y, height)
      console.log(`[showView] EXISTING account=${accountId} y=${y} height=${height} → setBounds`, existBounds)
      existing.view.setBounds(existBounds)
      console.log(`[showView] getBounds after set=`, existing.view.getBounds())

      // setBounds 直後に即時 invalidate — offscreen から戻ったときのGPUサーフェス再生成を促す
      try { existing.view.webContents.invalidate() } catch {}

      // ── URL 状態による分岐 ────────────────────────────────────────────────
      // 1) URL が about:blank (ページ未ロード): loaded フラグをリセットして _bgInitView を再実行
      // 2) threads.com 以外のURLで停止 (ロード失敗等): threads.com をリロード
      // 3) 正常ロード済み or ロード中: nudgeRepaint で GPU 再描画を強制
      const currentUrl = existing.view.webContents.getURL()
      const isBlank     = !currentUrl || currentUrl === 'about:blank'
      const isLoading   = existing.view.webContents.isLoading()
      const isOnThreads = currentUrl?.includes('threads.com') && !currentUrl.includes('/login')

      if (isBlank && !isLoading) {
        console.log(`[showView] account=${accountId} blank page — re-queuing _bgInitView`)
        existing.loaded = false
        this.showQueue = this.showQueue
          .then(() => this._bgInitView(accountId))
          .catch(() => {})
      } else if (!isBlank && !isOnThreads && !isLoading) {
        console.log(`[showView] account=${accountId} not on threads (url="${currentUrl}") — reloading`)
        existing.view.webContents.loadURL(THREADS_URL)
      } else {
        // ロード中 or 正常表示中: GPU コンポジターの再描画を強制
        // ロード中でも nudge することでロード完了後の黒画面を予防する
        this.nudgeRepaint(accountId)
      }

      this.notify()
      return
    }

    // 新規ビュー作成
    const view  = this.makeView(accountId)
    const entry: ViewEntry = { view, restoringSession: false, loaded: false }
    this.views.set(accountId, entry)
    this.activeAccountId = accountId

    // アタッチしてから setBounds（Electron 仕様: アタッチ前の setBounds は無効）
    this.mainWindow.contentView.addChildView(view)
    const newBounds = this.calcBounds(y, height)
    console.log(`[showView] NEW account=${accountId} y=${y} height=${height} → setBounds`, newBounds)
    view.setBounds(newBounds)
    console.log(`[showView] getBounds after set=`, view.getBounds())
    this.notify()

    // バックグラウンドでセッション Cookie を確認して Threads を読み込む（直列化）
    this.showQueue = this.showQueue
      .then(() => this._bgInitView(accountId))
      .catch(() => {})
  }

  private async _bgInitView(accountId: number): Promise<void> {
    const entry = this.views.get(accountId)
    // loaded フラグで二重実行を防ぐ
    if (!entry || entry.loaded || entry.view.webContents.isDestroyed()) return
    entry.loaded = true
    console.log(`[_bgInitView] START account=${accountId} bounds=`, entry.view.getBounds())
    const sess = session.fromPartition(`persist:account-${accountId}`)
    await this.ensureSessionCookies(accountId, sess).catch(() => {})

    // プロキシを loadURL より前に await で設定する。
    // fire-and-forget にすると loadURL 後に proxy が設定され Chromium が接続を再確立するため
    // did-finish-load が複数回発火し nudgeRepaint が干渉して黒画面になる。
    try {
      const acct = getAccountById(accountId)
      if (acct?.proxy_url) {
        console.log(`[_bgInitView] setProxy START account=${accountId} proxyRules=${acct.proxy_url}`)
        await sess.setProxy({ proxyRules: acct.proxy_url })
        console.log(`[_bgInitView] setProxy DONE account=${accountId}`)
      } else {
        console.log(`[_bgInitView] no proxy_url for account=${accountId}`)
      }
    } catch (err) { console.error(`[_bgInitView] setProxy error account=${accountId}:`, err) }

    if (!this.views.has(accountId) || entry.view.webContents.isDestroyed()) return

    // ── リトライ付きロード ───────────────────────────────────────────────────
    // プロキシ接続は初回タイムアウトすることがあるため最大 MAX_RETRIES 回リトライする。
    // プロキシエラー (-130〜-175) は 2 秒後、その他は 5 秒後にリトライ。
    const MAX_RETRIES = 3
    let retryCount = 0
    let loadSucceeded = false

    const attemptLoad = () => {
      const e = this.views.get(accountId)
      if (!e || e.view.webContents.isDestroyed()) return
      console.log(`[_bgInitView] loadURL attempt=${retryCount} account=${accountId}`)
      e.view.webContents.loadURL(THREADS_URL)
    }

    // dom-ready / did-finish-load に成功フラグを立てて nudge する（一度だけ）
    entry.view.webContents.once('dom-ready', () => {
      loadSucceeded = true
      console.log(`[_bgInitView] dom-ready account=${accountId}`)
      this.nudgeRepaint(accountId)
    })
    entry.view.webContents.once('did-finish-load', () => {
      loadSucceeded = true
      console.log(`[_bgInitView] did-finish-load account=${accountId}`)
      setTimeout(() => this.nudgeRepaint(accountId),  100)
      setTimeout(() => this.nudgeRepaint(accountId),  500)
      setTimeout(() => this.nudgeRepaint(accountId), 1500)
      setTimeout(() => this.nudgeRepaint(accountId), 3000)
    })

    // did-fail-load: リトライ処理（再帰的に登録）
    const onFailLoad = (_e: Electron.Event, errCode: number, errDesc: string, failedUrl: string) => {
      console.log(`[_bgInitView] did-fail-load account=${accountId} errCode=${errCode} errDesc=${errDesc} url=${failedUrl}`)
      // -3 = USER_ABORTED (SPA ナビゲーションによる中断) → 無視
      if (errCode === -3) return
      if (retryCount >= MAX_RETRIES) {
        console.log(`[_bgInitView] max retries reached account=${accountId}`)
        return
      }
      retryCount++
      // プロキシ関連エラー (-130〜-175): 認証待ちも含め 2 秒後にリトライ
      // その他のネットワークエラー: 5 秒後にリトライ
      const isProxyErr = errCode >= -175 && errCode <= -130
      const delay = isProxyErr ? 2_000 : 5_000
      console.log(`[_bgInitView] scheduling retry #${retryCount} in ${delay}ms (isProxy=${isProxyErr}) account=${accountId}`)
      setTimeout(() => {
        const e = this.views.get(accountId)
        if (!e || e.view.webContents.isDestroyed() || loadSucceeded) return
        const url = e.view.webContents.getURL()
        if (!url || url === 'about:blank' || url.startsWith('chrome-error://')) {
          e.view.webContents.once('did-fail-load', onFailLoad)
          attemptLoad()
        }
      }, delay)
    }
    entry.view.webContents.once('did-fail-load', onFailLoad)

    // ── blank watchdog ───────────────────────────────────────────────────────
    // プロキシ認証待ち等で about:blank のまま止まるケースに備え、
    // 12 秒後も blank なら強制リトライ（カウンタは消費しない）。
    setTimeout(() => {
      const e = this.views.get(accountId)
      if (!e || e.view.webContents.isDestroyed() || loadSucceeded) return
      const url = e.view.webContents.getURL()
      if (!url || url === 'about:blank') {
        console.log(`[_bgInitView] blank watchdog firing for account=${accountId}, reloading`)
        e.view.webContents.loadURL(THREADS_URL)
      }
    }, 12_000)

    attemptLoad()
  }

  /**
   * macOS vibrancy ウィンドウ上で WebContentsView が黒くなる問題の根本対策。
   *
   * 3段階で GPU コンポジターを強制的に再描画させる:
   *   1. webContents.invalidate() でレンダラーに直接再描画を要求
   *   2. setBackgroundColor トグルで Chromium コンポジターのサーフェスを更新
   *   3. setBounds ±1px bouncing で GPU コンポジターレイヤーを再合成
   *
   * target を先にキャプチャし、setTimeout 内では target の値に戻すことで
   * updateBounds が割り込んでも正しい値に復元できる。
   * moveOffscreen で画面外にある間は nudge 不要（x < 0 で早期リターン）。
   */
  private nudgeRepaint(accountId: number): void {
    const e = this.views.get(accountId)
    if (!e || e.view.webContents.isDestroyed()) return
    const target = e.view.getBounds()
    if (target.width <= 0 || target.height <= 0) return
    // 画面外（moveOffscreen）なら nudge 不要
    if (target.x < 0) return

    // ─── Phase 1 (即時): invalidate + 背景色トグル ───────────────────────────
    // webContents.invalidate() はレンダラープロセスに「全領域を再描画せよ」と伝える。
    // setBackgroundColor トグルは Chromium の CALayer/コンポジターサーフェスを更新し
    // macOS vibrancy 特有の黒画面を解消する。
    try { e.view.webContents.invalidate() } catch {}
    try {
      e.view.setBackgroundColor('#fffffe')   // わずかにオフホワイト → GPU サーフェス再生成を誘発
      setTimeout(() => {
        const ex = this.views.get(accountId)
        if (ex && !ex.view.webContents.isDestroyed()) {
          ex.view.setBackgroundColor('#ffffff')
        }
      }, 80)
    } catch {}

    // ─── Phase 1b (200ms): JS リフロー — 白画面対策 ──────────────────────────
    // GPU サーフェスは存在するが描画内容がコンポジットされない白画面に対して、
    // ページ側で reflow を強制することでブラウザのペイント処理を再トリガーする。
    setTimeout(() => {
      const ex = this.views.get(accountId)
      if (!ex || ex.view.webContents.isDestroyed()) return
      ex.view.webContents.executeJavaScript(
        'try{document.body.getBoundingClientRect();window.dispatchEvent(new Event("resize"))}catch{}'
      ).catch(() => {})
    }, 200)

    // ─── Phase 2 (0ms / 50ms): 幅 ±1px で GPU コンポジターレイヤーを再合成 ──
    e.view.setBounds({ ...target, width: target.width + 1 })
    setTimeout(() => {
      const e2 = this.views.get(accountId)
      if (!e2 || e2.view.webContents.isDestroyed()) return
      const cur = e2.view.getBounds()
      if (cur.x < 0) return
      e2.view.setBounds({ ...cur, width: target.width })
      try { e2.view.webContents.invalidate() } catch {}
    }, 50)

    // ─── Phase 3 (400ms / 450ms): 高さ ±1px で頑固な黒画面を解消 ────────────
    setTimeout(() => {
      const e3 = this.views.get(accountId)
      if (!e3 || e3.view.webContents.isDestroyed()) return
      const b = e3.view.getBounds()
      if (b.x < 0 || b.width <= 0 || b.height <= 0) return
      try { e3.view.webContents.invalidate() } catch {}
      e3.view.setBounds({ ...b, height: b.height + 1 })
      setTimeout(() => {
        const e4 = this.views.get(accountId)
        if (!e4 || e4.view.webContents.isDestroyed()) return
        const b4 = e4.view.getBounds()
        if (b4.x < 0) return
        e4.view.setBounds({ ...b4, height: target.height })
        try { e4.view.webContents.invalidate() } catch {}
      }, 50)
    }, 400)

    // ─── Phase 4 (1200ms): 最終フォールバック invalidate ────────────────────
    // 上記3フェーズで解消しなかった場合のバックストップ
    setTimeout(() => {
      const e5 = this.views.get(accountId)
      if (!e5 || e5.view.webContents.isDestroyed()) return
      const b5 = e5.view.getBounds()
      if (b5.x < 0 || b5.width <= 0) return
      try { e5.view.webContents.invalidate() } catch {}
      e5.view.setBounds({ ...b5, width: b5.width + 1 })
      setTimeout(() => {
        const e6 = this.views.get(accountId)
        if (!e6 || e6.view.webContents.isDestroyed()) return
        const b6 = e6.view.getBounds()
        if (b6.x < 0) return
        e6.view.setBounds({ ...b6, width: target.width })
      }, 50)
    }, 1200)
  }

  /**
   * ビューを「非表示」にする。contentView からは取り外さない。
   * isVisible=false のとき（ツールパネル表示中など）に呼ばれる。
   * GPU サーフェスを保持するため moveOffscreen を使う。
   */
  hideView(accountId: number): void {
    const entry = this.views.get(accountId)
    if (entry && !entry.view.webContents.isDestroyed()) {
      this.moveOffscreen(entry.view)
    }
    this.notify()
  }

  /** ビューを完全に破棄する（アカウント削除時など）。 */
  closeView(accountId: number): void {
    this.destroyView(accountId)
    this.notify()
  }

  /** リサイズ時に bounds を更新する。リサイズ後の黒画面を防ぐため invalidate も呼ぶ。 */
  updateBounds(accountId: number, y: number, height: number): void {
    if (this.activeAccountId !== accountId) return
    const entry = this.views.get(accountId)
    if (entry && !entry.view.webContents.isDestroyed()) {
      entry.view.setBounds(this.calcBounds(y, height))
      try { entry.view.webContents.invalidate() } catch {}
    }
  }

  /**
   * viewが存在しない場合バックグラウンドで作成し、
   * threads.com が実際にロードされるまで最大30秒待機する。
   */
  async ensureViewLoaded(accountId: number): Promise<boolean> {
    // まずviewを作成/ロード開始
    const existing = this.views.get(accountId)
    if (!existing) {
      console.log(`[ensureView] creating background view for account=${accountId}`)
      const view  = this.makeView(accountId)
      const entry: ViewEntry = { view, restoringSession: false, loaded: false }
      this.views.set(accountId, entry)
      this.mainWindow.contentView.addChildView(view)
      view.setBounds({ x: -1200, y: 0, width: 1000, height: 800 })
      this._bgInitView(accountId).catch(() => {})  // fire, waitは下のポーリングで
    }
    // URLが threads.com になるまで最大30秒ポーリング
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const e = this.views.get(accountId)
      if (e && !e.view.webContents.isDestroyed()) {
        const url = e.view.webContents.getURL() ?? ''
        if (url.includes('threads.com') && !url.includes('/login')) {
          // loaded フラグも確実に立てる
          e.loaded = true
          return true
        }
      }
      await new Promise(r => setTimeout(r, 1000))
    }
    console.warn(`[ensureView] account=${accountId} timed out waiting for threads.com`)
    return false
  }

  navigate(accountId: number, url: string): void {
    const entry = this.views.get(accountId)
    if (entry && !entry.view.webContents.isDestroyed()) {
      entry.view.webContents.loadURL(url)
    }
  }

  goBack(accountId: number): void {
    const entry = this.views.get(accountId)
    if (entry && !entry.view.webContents.isDestroyed()) entry.view.webContents.goBack()
  }

  goForward(accountId: number): void {
    const entry = this.views.get(accountId)
    if (entry && !entry.view.webContents.isDestroyed()) entry.view.webContents.goForward()
  }

  reload(accountId: number): void {
    const entry = this.views.get(accountId)
    if (entry && !entry.view.webContents.isDestroyed()) entry.view.webContents.reload()
  }

  /**
   * ビューを破棄して再作成する（プロキシ設定変更後に呼ぶ）。
   * login イベントリスナーは makeView 時にスナップショットされるため、
   * reload() では新しいプロキシ認証情報が反映されない。
   * アクティブなビューの場合はそのまま同じ位置に再表示する。
   */
  reinitView(accountId: number): void {
    const entry = this.views.get(accountId)
    if (!entry) return

    const isActive = this.activeAccountId === accountId
    let savedBounds: Electron.Rectangle | null = null
    if (isActive && !entry.view.webContents.isDestroyed()) {
      const b = entry.view.getBounds()
      if (b.width > 0 && b.height > 0) savedBounds = b
    }

    this.destroyView(accountId)

    if (isActive && savedBounds) {
      this.showView(accountId, savedBounds.y, savedBounds.height)
    }

    this.notify()
  }

  getViewInfos(): ViewInfo[] {
    if (this.activeAccountId === null) return []
    const entry = this.views.get(this.activeAccountId)
    if (!entry || entry.view.webContents.isDestroyed()) return []
    return [{
      accountId:    this.activeAccountId,
      url:          entry.view.webContents.getURL(),
      title:        entry.view.webContents.getTitle(),
      canGoBack:    entry.view.webContents.canGoBack(),
      canGoForward: entry.view.webContents.canGoForward(),
      isActive:     true,
    }]
  }

  getActiveAccountId(): number | null { return this.activeAccountId }

  // ── Compose with pre-filled text ─────────────────────────────────────────
  //
  // /compose URL に直接遷移してテキストを自動入力する。
  // ボタンクリック方式は SPA ナビゲーションが発生すると executeJavaScript の
  // コンテキストが消滅するため、loadURL 方式に統一する。

  async openCompose(accountId: number, content: string, images: string[] = [], topic?: string): Promise<{ success: boolean; error?: string }> {
    console.log(`[openCompose] account=${accountId} content=${content.slice(0, 30)}...`)

    // ── Step 1: ビューを取得 or 新規作成 ────────────────────────────────────
    let entry = this.views.get(accountId)

    if (!entry || entry.view.webContents.isDestroyed()) {
      const view = this.makeView(accountId)
      entry = { view, restoringSession: false, loaded: false }
      this.views.set(accountId, entry)
      this.mainWindow.contentView.addChildView(view)
      view.setBounds(HIDDEN_BOUNDS)
    }

    const wc = entry.view.webContents

    try {
      // ── Step 2: Cookie を確保 ─────────────────────────────────────────────
      if (!entry.loaded) {
        entry.loaded = true
        const sess = session.fromPartition(`persist:account-${accountId}`)
        await this.ensureSessionCookies(accountId, sess).catch(() => {})
      }

      if (wc.isDestroyed()) return { success: false, error: 'View destroyed' }

      // ── Step 3: Threads ホームを確保（ページ未ロード or ログインページの場合のみ遷移）──
      // /compose に直接 loadURL すると SPA が compose ダイアログを開かない。
      // ホームでボタンクリック → SPA ルーティングでダイアログを開く方式を採用。
      const currentUrl = wc.getURL()
      const onThreads   = currentUrl?.includes('threads.com') && !currentUrl.includes('/login')

      if (!onThreads || wc.isLoading()) {
        console.log(`[openCompose] loading home (current: ${currentUrl})`)
        await new Promise<void>((resolve) => {
          const done = () => {
            wc.removeListener('did-finish-load', done)
            wc.removeListener('did-fail-load',   done)
            resolve()
          }
          wc.once('did-finish-load', done)
          wc.once('did-fail-load',   done)
          wc.loadURL(THREADS_URL)
          setTimeout(resolve, 15_000)
        })
        await new Promise((r) => setTimeout(r, 800))
      }

      if (wc.isDestroyed()) return { success: false, error: 'View destroyed' }
      if (wc.getURL().includes('/login')) {
        return { success: false, error: 'セッションが切れています。ブラウザで再ログインしてください。' }
      }

      console.log(`[openCompose] executing script on: ${wc.getURL()}`)

      // ── Step 4: compose ダイアログを開いてテキスト入力（SPA 内で完結）───
      // loadURL で /compose に遷移すると SPA がダイアログを開かないため、
      // ホームページ上でナビゲーションの compose ボタンをクリックする。
      // SPA ルーティングはページ遷移なし（同一 JS コンテキスト）なので
      // executeJavaScript のスクリプトが継続して動作する。
      const contentJson = JSON.stringify(content)
      const topicJson = JSON.stringify(topic ?? null)

      const script = `
        (async function() {
          var text = ${contentJson};
          var topicVal = ${topicJson};

          function waitFor(selectors, timeoutMs) {
            var sel = Array.isArray(selectors) ? selectors.join(', ') : selectors;
            return new Promise(function(resolve) {
              var el = document.querySelector(sel);
              if (el) return resolve(el);
              var deadline = Date.now() + timeoutMs;
              var id = setInterval(function() {
                var found = document.querySelector(sel);
                if (found) { clearInterval(id); resolve(found); return; }
                if (Date.now() > deadline) { clearInterval(id); resolve(null); }
              }, 100);
            });
          }

          function fillText(area, text) {
            area.focus();
            // Lexical エディタへの入力: execCommand('insertText') が標準的手法
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            var ok = document.execCommand('insertText', false, text);
            console.log('[openCompose] insertText ok=' + ok + ' len=' + area.textContent.length);
            // フォールバック: DataTransfer paste
            if (!ok || area.textContent.trim() === '') {
              try {
                var dt = new DataTransfer();
                dt.setData('text/plain', text);
                area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
              } catch(e) { console.log('[openCompose] paste err', e); }
            }
          }

          var COMPOSE_BTN_SELS = [
            '[aria-label="作成"]',
            '[aria-label="新しいスレッドを作成"]',
            '[aria-label="Create new thread"]',
            '[aria-label="新規スレッド"]',
            '[aria-label="New thread"]',
            '[aria-label="スレッドを作成"]',
            '[aria-label="Create a thread"]',
            '[aria-label="Threads を作成"]',
            '[aria-label="Create a Thread"]',
          ];

          // フィード上部のインライン入力エリア（ダイアログ不要）
          var INLINE_SELS = [
            '[placeholder*="スレッドを開始"]',
            '[placeholder*="Start a thread"]',
            '[placeholder*="いま何"]',
            '[placeholder*="What"]',
          ];

          // compose ダイアログ内またはインラインのテキストエリア
          var TEXT_AREA_SELS = [
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"][data-lexical-editor="true"]',
            'div[contenteditable="true"][aria-multiline]',
            'div[contenteditable="true"]',
          ];

          // まずインライン入力エリアを試す（すでにページ上にある）
          var inline = document.querySelector(INLINE_SELS.join(', '));
          if (inline) {
            console.log('[openCompose] inline compose found, clicking');
            inline.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await new Promise(function(r) { setTimeout(r, 400); });
          } else {
            // ナビゲーションの compose ボタンをクリック
            console.log('[openCompose] waiting for compose button...');
            var btn = await waitFor(COMPOSE_BTN_SELS, 8000);
            if (!btn) {
              // ページ上の全 aria-label を調べてデバッグ情報を返す
              var labels = Array.from(document.querySelectorAll('[aria-label]'))
                .map(function(el) { return el.getAttribute('aria-label'); })
                .filter(function(l) { return l && l.length < 60; })
                .slice(0, 20);
              return { ok: false, error: 'compose ボタン未検出. labels=' + JSON.stringify(labels) };
            }
            console.log('[openCompose] compose btn found, clicking');
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await new Promise(function(r) { setTimeout(r, 600); });
          }

          // テキストエリアを探して入力
          var area = await waitFor(TEXT_AREA_SELS, 10000);
          if (!area) {
            var allEdit = Array.from(document.querySelectorAll('[contenteditable]'))
              .map(function(el) { return el.tagName + '[role=' + el.getAttribute('role') + '][data-lexical=' + el.getAttribute('data-lexical-editor') + ']'; });
            return { ok: false, error: 'テキストエリア未検出. editables=' + JSON.stringify(allEdit) };
          }

          console.log('[openCompose] textarea found: role=' + area.getAttribute('role'));

          // Lexical は beforeinput イベントを処理後に DOM を非同期更新するため
          // イベント発火 → 200ms 待機 → 結果確認 の順で実行する
          area.focus();
          area.dispatchEvent(new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: text,
            bubbles: true,
            cancelable: true,
          }));
          await new Promise(function(r) { setTimeout(r, 200); });
          console.log('[openCompose] after beforeinput len=' + area.textContent.length);

          // beforeinput で入力できなかった場合は execCommand / paste にフォールバック
          if (area.textContent.trim().length === 0) {
            fillText(area, text);
          }

          // トピック自動入力
          if (topicVal) {
            var TOPIC_BTN_SELS = [
              '[aria-label="トピックを追加"]',
              '[aria-label="Add topic"]',
              '[aria-label="Add a topic"]',
              '[aria-label="トピック"]',
              '[aria-label="Topic"]',
              '[aria-label="トピックを選択"]',
            ];
            var topicBtn = await waitFor(TOPIC_BTN_SELS, 3000);
            if (!topicBtn) {
              var allBtns2 = Array.from(document.querySelectorAll('div[role="button"], button, [role="menuitem"], span'));
              topicBtn = allBtns2.find(function(el) {
                var t = (el.textContent || '').trim();
                return t === 'トピックを追加' || t === 'Add topic' || t === 'Add a topic' || t === 'トピック' || t === 'Topic';
              }) || null;
            }
            console.log('[openCompose] topic btn:', topicBtn ? (topicBtn.getAttribute('aria-label') || topicBtn.textContent.trim()) : 'not found');

            if (topicBtn) {
              topicBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

              var topicInput = await waitFor([
                'input[placeholder*="トピック"]',
                'input[placeholder*="topic"]',
                'input[placeholder*="Topic"]',
                'input[placeholder*="Search"]',
                'input[placeholder*="検索"]',
                'div[contenteditable="true"][aria-label*="トピック"]',
                'div[contenteditable="true"][aria-label*="topic"]',
                'div[contenteditable="true"][aria-label*="Topic"]',
                'input[type="text"]',
                'input[type="search"]',
              ], 4000);

              if (topicInput) {
                console.log('[openCompose] topic input found: tag=' + topicInput.tagName + ' placeholder="' + topicInput.getAttribute('placeholder') + '"');
                topicInput.focus();
                if (topicInput.tagName === 'INPUT') {
                  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                  nativeInputValueSetter.call(topicInput, topicVal);
                  topicInput.dispatchEvent(new Event('input', { bubbles: true }));
                  topicInput.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                  topicInput.dispatchEvent(new InputEvent('beforeinput', {
                    inputType: 'insertText',
                    data: topicVal,
                    bubbles: true,
                    cancelable: true,
                  }));
                  await new Promise(function(r) { setTimeout(r, 150); });
                  if (!topicInput.textContent || topicInput.textContent.trim().length === 0) {
                    document.execCommand('insertText', false, topicVal);
                  }
                }
                // 候補リストからマッチするトピックを選択
                await new Promise(function(r) { setTimeout(r, 500); });
                var topicItems = Array.from(document.querySelectorAll('div[role="option"], div[role="listitem"], li'));
                var matchItem = topicItems.find(function(el) {
                  return (el.textContent || '').trim().toLowerCase().includes(topicVal.toLowerCase());
                });
                if (matchItem) {
                  console.log('[openCompose] topic candidate matched: ' + matchItem.textContent.trim());
                  matchItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                }
              } else {
                console.log('[openCompose] topic input not found after click');
              }
            } else {
              console.log('[openCompose] topic button not found');
            }
          }

          return { ok: true, len: area.textContent.length };
        })()
      `

      const res = await Promise.race<{ ok: boolean; error?: string; len?: number }>([
        wc.executeJavaScript(script),
        new Promise<{ ok: false; error: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, error: 'JS タイムアウト (25秒)' }), 25_000)
        ),
      ])

      console.log(`[openCompose] result:`, res)
      if (!res?.ok) return { success: false, error: res?.error ?? '失敗' }
      if (images.length === 0) return { success: true }

      // ── Step 5: 画像をクリップボード経由で貼り付け ───────────────────────
      // テキスト入力後 500ms 待ってから画像をペースト
      await new Promise((r) => setTimeout(r, 500))
      // nativeImage → clipboard.writeImage → wc.paste() で貼り付ける
      // ローカルファイル(file://): HTTPS コンテキストから file:// は読めないため
      //   メインプロセスで nativeImage.createFromPath() を使う
      // HTTP URL: net.fetch で取得して Buffer → nativeImage
      const pasteKey = process.platform === 'darwin' ? 'meta' : 'control'
      for (const imgData of images.slice(0, 2)) {
        if (!imgData || wc.isDestroyed()) break
        console.log(`[openCompose] processing image: ${imgData.slice(0, 80)}`)
        try {
          let ni: Electron.NativeImage | null = null

          if (imgData.startsWith('data:')) {
            // data URL: そのまま nativeImage に変換
            ni = nativeImage.createFromDataURL(imgData)
            console.log(`[openCompose] data URL → nativeImage: ${ni.getSize().width}x${ni.getSize().height} empty=${ni.isEmpty()}`)

          } else if (imgData.startsWith('file://')) {
            // ローカルファイル: メインプロセスで直接読み込む（HTTPS コンテキスト不要）
            const filePath = imgData.replace(/^file:\/\//, '')
            console.log(`[openCompose] local file path: ${filePath}`)
            ni = nativeImage.createFromPath(filePath)
            console.log(`[openCompose] createFromPath: ${ni.getSize().width}x${ni.getSize().height} empty=${ni.isEmpty()}`)

          } else {
            // HTTP(S) URL: net.fetch で取得して Buffer から nativeImage を作成
            console.log(`[openCompose] fetching URL: ${imgData.slice(0, 80)}`)
            const resp = await Promise.race([
              net.fetch(imgData),
              new Promise<null>((r) => setTimeout(() => r(null), 10000)),
            ])
            if (!resp || !('ok' in resp) || !resp.ok) {
              console.warn(`[openCompose] fetch failed: ${imgData.slice(0, 80)}`)
              continue
            }
            const buf = Buffer.from(await resp.arrayBuffer())
            ni = nativeImage.createFromBuffer(buf)
            console.log(`[openCompose] URL → nativeImage: ${ni.getSize().width}x${ni.getSize().height} empty=${ni.isEmpty()}`)
          }

          if (!ni || ni.isEmpty()) {
            console.warn('[openCompose] nativeImage is empty, skipping')
            continue
          }

          clipboard.writeImage(ni)
          await new Promise((r) => setTimeout(r, 300))

          wc.focus()
          wc.paste()
          console.log('[openCompose] wc.paste() called')
          await new Promise((r) => setTimeout(r, 800))

          console.log('[openCompose] pasted image')
        } catch (e) {
          console.warn('[openCompose] image paste error:', e)
        }
      }

      return { success: true }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[openCompose] error:', msg)
      return { success: false, error: msg }
    }
  }

  // ── Status check via WebContentsView ────────────────────────────────────
  //
  // Playwright の代わりに WebContentsView で threads.com に遷移してステータスを確認。
  // 配布ビルドに Playwright Chromium が含まれていなくても動作する。

  async checkStatus(accountId: number): Promise<StatusCheckResult> {
    try {
      // ビューを取得または作成（非表示の一時ビューとして利用）
      let entry = this.views.get(accountId)
      if (!entry || entry.view.webContents.isDestroyed()) {
        const view = this.makeView(accountId)
        entry = { view, restoringSession: false, loaded: false }
        this.views.set(accountId, entry)
        this.mainWindow.contentView.addChildView(view)
        view.setBounds(HIDDEN_BOUNDS)
      }

      const wc = entry.view.webContents

      // セッション Cookie を確保
      if (!entry.loaded) {
        entry.loaded = true
        const sess = session.fromPartition(`persist:account-${accountId}`)
        await this.ensureSessionCookies(accountId, sess).catch(() => {})
      }

      if (wc.isDestroyed()) return { status: 'error', message: 'View destroyed' }

      // 既に threads.com でロード済みなら遷移不要
      const currentUrl = wc.getURL()
      const alreadyOnThreads =
        currentUrl?.includes('threads.com') &&
        !currentUrl.includes('/login') &&
        !wc.isLoading()

      if (!alreadyOnThreads) {
        wc.loadURL(THREADS_URL)
        // ページが安定するまでポーリング（リダイレクトを含む）
        const deadline = Date.now() + 20_000
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 500))
          if (!wc.isLoading()) break
        }
        // クッキー復元 → リダイレクト完了を待つ余裕
        await new Promise((r) => setTimeout(r, 500))
      }

      if (wc.isDestroyed()) return { status: 'error', message: 'View destroyed' }

      const finalUrl = wc.getURL()

      if (finalUrl.includes('/login')) {
        return { status: 'needs_login', message: 'セッションが切れています。再ログインが必要です。' }
      }

      try {
        const bodyText = (await wc.executeJavaScript('document.body?.innerText ?? ""')) as string
        const isFrozen = FROZEN_KEYWORDS.some((kw) =>
          bodyText.toLowerCase().includes(kw.toLowerCase())
        )
        if (isFrozen) {
          return { status: 'frozen', message: 'アカウントが凍結または制限されています。' }
        }
      } catch { /* DOM 未準備の場合は無視 */ }

      if (finalUrl.includes('threads.com')) {
        return { status: 'active' }
      }

      return { status: 'error', message: `予期しないURL: ${finalUrl}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { status: 'error', message: msg }
    }
  }

  closeAll(): void {
    for (const accountId of [...this.views.keys()]) {
      this.destroyView(accountId)
    }
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer)
      this.notifyTimer = null
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _manager: ViewManager | null = null

export function initViewManager(win: BrowserWindow): ViewManager {
  _manager = new ViewManager(win)
  return _manager
}

export function getViewManager(): ViewManager {
  if (!_manager) throw new Error('ViewManager not initialized')
  return _manager
}

/** 指定アカウントのブラウザビューの WebContents を返す（未開放なら null） */
export function getViewWebContents(accountId: number): Electron.WebContents | null {
  if (!_manager) return null
  const entry = (_manager as unknown as { views: Map<number, { view: { webContents: Electron.WebContents } }> })
    .views.get(accountId)
  if (!entry || entry.view.webContents.isDestroyed()) return null
  return entry.view.webContents
}

/**
 * ロード済み WebContentsView の JavaScript コンテキストから
 * LSD / fbDtsg トークンを取得する。
 * ビューが未開放の場合は null を返す。
 */
export async function extractPageApiTokens(
  accountId: number
): Promise<{ lsd: string; fbDtsg: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (_manager as any)?.views?.get(accountId) as
    | { view: { webContents: Electron.WebContents }; loaded?: boolean }
    | undefined
  if (!entry) return null
  const wc = entry.view?.webContents
  if (!wc || wc.isDestroyed() || !entry.loaded) return null
  const url = wc.getURL() ?? ''
  if (!url.includes('threads.com') || url.includes('/login')) return null

  try {
    const result = await wc.executeJavaScript(
      `(function() {
        var lsd = '', fbDtsg = '';
        try { lsd    = require('LSD').token; } catch(e) {}
        try { fbDtsg = require('DTSGInitialData').token; } catch(e) {}
        if (!lsd || !fbDtsg) {
          var h = document.documentElement.innerHTML;
          if (!lsd) {
            var m = h.match(/"LSD",\\[\\],\\{"token":"([^"]+)"/) || h.match(/"lsd":"([^"]+)"/);
            if (m) lsd = m[1];
          }
          if (!fbDtsg) {
            var m2 = h.match(/"DTSGInitialData",\\[\\],\\{"token":"([^"]+)"/) ||
                     h.match(/"DTSGInitData",\\[\\],\\{"token":"([^"]+)"/) ||
                     h.match(/"fb_dtsg":"([^"]+)"/) ||
                     h.match(/"token":"(AQ[^"]+)"/);
            if (m2) fbDtsg = m2[1];
          }
        }
        return { lsd: lsd || '', fbDtsg: fbDtsg || '' };
      })()`,
      true
    )
    return result as { lsd: string; fbDtsg: string }
  } catch {
    return null
  }
}

/**
 * ロード済み WebContentsView の fetch() を使って HTTP POST を実行する。
 * 同一オリジンリクエストになるため SameSite Cookie 制限を受けない。
 * ビューが未開放の場合は null を返す。
 */
export async function fetchViaView(
  accountId: number,
  url:       string,
  headers:   Record<string, string>,
  body:      string
): Promise<{ status: number; body: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (_manager as any)?.views?.get(accountId) as
    | { view: { webContents: Electron.WebContents }; loaded?: boolean }
    | undefined
  if (!entry) return null
  const wc = entry.view?.webContents
  if (!wc || wc.isDestroyed() || !entry.loaded) return null
  const viewUrl = wc.getURL() ?? ''
  if (!viewUrl.includes('threads.com') || viewUrl.includes('/login')) return null

  // JSON.stringify で安全にシリアライズしてインジェクションを防ぐ
  const headersJson = JSON.stringify(headers)
  const bodyJson    = JSON.stringify(body)
  const urlJson     = JSON.stringify(url)

  try {
    const result = await wc.executeJavaScript(
      `(async function() {
        try {
          var resp = await fetch(${urlJson}, {
            method: 'POST',
            headers: ${headersJson},
            body: ${bodyJson},
            credentials: 'include',
          });
          var text = await resp.text();
          return { status: resp.status, body: text };
        } catch(e) {
          return { status: 0, body: '', error: e.message };
        }
      })()`,
      true
    )
    const r = result as { status: number; body: string; error?: string }
    if (r.error) {
      console.error(`[ViewFetch] fetch error: ${r.error}`)
      return null
    }
    return { status: r.status, body: r.body }
  } catch (e) {
    console.error(`[ViewFetch] executeJavaScript error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** viewが存在しない場合バックグラウンドで作成してロードを待つ */
export async function ensureViewLoaded(accountId: number): Promise<boolean> {
  if (!_manager) return false
  return _manager.ensureViewLoaded(accountId)
}

/**
 * ロード済み WebContentsView の JS コンテキストから GraphQL で通知一覧を取得する。
 * JS 内から fetch するため SameSite 制限を受けず、ページ上のトークンをそのまま使える。
 * ページ上の JS バンドルを走査して現在の doc_id を動的取得してから GraphQL を呼ぶ。
 */
/**
 * ロード済み WebContentsView で SPA クライアントサイドナビゲーションを使い、
 * fetch をインターセプトして通知 GraphQL レスポンスを取得する。
 * ページリロードなしで /notifications/ に遷移するため JS コンテキストが維持される。
 */
export async function fetchNotificationsViaJS(accountId: number): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (_manager as any)?.views?.get(accountId) as
    | { view: { webContents: Electron.WebContents } }
    | undefined
  if (!entry) return null
  const wc = entry.view?.webContents
  if (!wc || wc.isDestroyed()) return null
  const viewUrl = wc.getURL() ?? ''
  if (!viewUrl.includes('threads.com') || viewUrl.includes('/login')) return null

  try {
    const result = await wc.executeJavaScript(`
      (async function() {
        try {
          // fetch をインターセプトして通知 GraphQL レスポンスを捕捉
          var captured = null;
          var origFetch = window.fetch;
          window.fetch = async function() {
            var r = await origFetch.apply(this, arguments);
            try {
              var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
              if (!captured && url.includes('graphql/query')) {
                var clone = r.clone();
                var text = await clone.text();
                if (text.includes('text_feed__notifications') || text.includes('ActivityFeed')) {
                  captured = text;
                }
              }
            } catch(e) {}
            return r;
          };

          // SPA クライアントサイドナビゲーションで /notifications/ へ遷移
          // history.pushState + popstate でルーターを起動する
          var origPath = window.location.pathname;
          if (origPath !== '/notifications/') {
            window.history.pushState(null, '', '/notifications/');
            window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
          }

          // 最大15秒待機
          var waited = 0;
          while (!captured && waited < 15000) {
            await new Promise(function(r) { setTimeout(r, 300); });
            waited += 300;
          }

          // fetch を元に戻す
          window.fetch = origFetch;

          // 元のパスに戻る
          if (origPath !== '/notifications/') {
            window.history.pushState(null, '', origPath);
            window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
          }

          return captured ? { status: 200, body: captured } : { error: 'timeout or no notification query fired' };
        } catch(e) {
          return { error: String(e) };
        }
      })()
    `, true)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = result as any
    console.log(`[fetchNotificationsViaJS] account=${accountId} status=${res?.status ?? '?'} body=${(res?.body ?? res?.error ?? '').slice(0, 300)}`)
    if (res?.status === 200 && res.body) return res.body as string
    return null
  } catch (e) {
    console.error(`[fetchNotificationsViaJS] error account=${accountId}:`, e)
    return null
  }
}

/**
 * WebContentsView の JS コンテキストから GET リクエストを実行する。
 * same-origin fetch なので UA・Cookie が正しく送信される。
 */
export async function getViaView(
  accountId: number,
  path:      string,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (_manager as any)?.views?.get(accountId) as
    | { view: { webContents: Electron.WebContents }; loaded?: boolean }
    | undefined
  if (!entry) return null
  const wc = entry.view?.webContents
  if (!wc || wc.isDestroyed() || !entry.loaded) return null
  const viewUrl = wc.getURL() ?? ''
  if (!viewUrl.includes('threads.com') || viewUrl.includes('/login')) return null

  const headersJson = JSON.stringify({ 'X-IG-App-ID': '238260118697367', ...extraHeaders })
  const pathJson    = JSON.stringify(path)

  try {
    const result = await wc.executeJavaScript(
      `(async function() {
        try {
          var resp = await fetch(${pathJson}, {
            method: 'GET',
            headers: ${headersJson},
            credentials: 'include',
          });
          var text = await resp.text();
          return { status: resp.status, body: text };
        } catch(e) {
          return { status: 0, body: '', error: e.message };
        }
      })()`,
      true
    )
    const r = result as { status: number; body: string; error?: string }
    if (r.error) { console.error(`[getViaView] fetch error: ${r.error}`); return null }
    return { status: r.status, body: r.body }
  } catch (e) {
    console.error(`[getViaView] executeJavaScript error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/**
 * WebContentsView の JS コンテキストから /api/v1/media/configure_text_only_post/ を呼ぶ。
 * same-origin fetch なので sessionid SameSite 制限を受けない。
 */
export async function restPostTextViaView(
  accountId: number,
  text:      string,
  topic?:    string
): Promise<{ status: number; body: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (_manager as any)?.views?.get(accountId) as
    | { view: { webContents: Electron.WebContents }; loaded?: boolean }
    | undefined
  if (!entry) return null
  const wc = entry.view?.webContents
  if (!wc || wc.isDestroyed() || !entry.loaded) return null
  const viewUrl = wc.getURL() ?? ''
  if (!viewUrl.includes('threads.com') || viewUrl.includes('/login')) return null

  // Node.js 側のセッションから csrftoken を取得
  const { session: electronSessionText } = await import('electron')
  const sessText = electronSessionText.fromPartition(`persist:account-${accountId}`)
  const allCookiesText = await sessText.cookies.get({}).catch(() => [] as Electron.Cookie[])
  const csrftokenText = allCookiesText.find(c => c.name === 'csrftoken' && c.domain?.includes('threads.com'))?.value
                     ?? allCookiesText.find(c => c.name === 'csrftoken')?.value
                     ?? ''
  console.log(`[RestPostText] account=${accountId} topic=${JSON.stringify(topic ?? null)} csrftoken=${csrftokenText.slice(0, 8) || '(empty)'}…`)

  const textJson    = JSON.stringify(text)
  const topicJson   = JSON.stringify(topic ?? null)
  const csrftokenJs = JSON.stringify(csrftokenText)

  try {
    const result = await wc.executeJavaScript(
      `(async function() {
        try {
          var csrftoken  = ${csrftokenJs};
          var uploadId   = Date.now().toString();
          var selfId     = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
          var textVal    = ${textJson};
          var topicVal   = ${topicJson};
          var appInfo    = JSON.stringify({
            community_flair_id: null,
            entry_point: 'main_tab_bar',
            excluded_inline_media_ids: '[]',
            fediverse_composer_enabled: true,
            is_reply_approval_enabled: false,
            is_spoiler_media: false,
            link_attachment_url: null,
            reply_control: 0,
            self_thread_context_id: selfId,
            snippet_attachment: null,
            special_effects_enabled_str: null,
            tag_header: topicVal ? { display_text: topicVal } : null,
            text_with_entities: { entities: [], text: textVal }
          });
          var params = new URLSearchParams({
            audience: 'default',
            barcelona_source_reply_id: '',
            caption: textVal,
            creator_geo_gating_info: JSON.stringify({ whitelist_country_codes: [] }),
            cross_share_info: '',
            custom_accessibility_caption: '',
            gen_ai_detection_method: '',
            internal_features: '',
            is_meta_only_post: '',
            is_paid_partnership: '',
            is_upload_type_override_allowed: '1',
            music_params: '',
            publish_mode: 'text_post',
            should_include_permalink: 'true',
            text_post_app_info: appInfo,
            upload_id: uploadId,
          });
          var resp = await fetch('/api/v1/media/configure_text_only_post/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'x-csrftoken':  csrftoken,
              'x-ig-app-id':  '238260118697367',
              'x-asbd-id':    '129477',
            },
            body: params.toString(),
            credentials: 'include',
          });
          var body = await resp.text();
          return { status: resp.status, body: body };
        } catch(e) {
          return { status: 0, body: '', error: e.message };
        }
      })()`,
      true
    )
    const r = result as { status: number; body: string; error?: string }
    if (r.error) {
      console.error(`[RestPost] fetch error: ${r.error}`)
      return null
    }
    return { status: r.status, body: r.body }
  } catch (e) {
    console.error(`[RestPost] executeJavaScript error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/**
 * 画像付き投稿を WebContentsView の JS コンテキストから実行する。
 *
 * 手順:
 *   1. 各画像ファイルを base64 → Uint8Array に変換し /rupload_igphoto/fb_uploader_{id} へバイナリ POST
 *   2. 取得した upload_id で /api/v1/media/configure_text_post_app_feed/ へ POST
 *
 * same-origin fetch なので sessionid SameSite 制限を受けない。
 * imagePaths は Node.js 側で読み込んだローカルファイルパスの配列。
 */
export async function restPostMediaViaView(
  accountId:  number,
  text:       string,
  imagePaths: string[],
  topic?:     string
): Promise<{ status: number; body: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (_manager as any)?.views?.get(accountId) as
    | { view: { webContents: Electron.WebContents }; loaded?: boolean }
    | undefined
  if (!entry) return null
  const wc = entry.view?.webContents
  if (!wc || wc.isDestroyed() || !entry.loaded) return null
  const viewUrl = wc.getURL() ?? ''
  if (!viewUrl.includes('threads.com') || viewUrl.includes('/login')) return null

  // Node.js 側で画像ファイルを読み込み base64 に変換して JS へ渡す
  const { readFileSync, existsSync } = await import('fs')
  const images = imagePaths
    .filter(p => existsSync(p))
    .map(p => {
      const buf  = readFileSync(p)
      const mime = p.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
      return { data: buf.toString('base64'), mime, size: buf.length }
    })

  if (images.length === 0) return null

  // Node.js 側のセッションから csrftoken を取得（document.cookie は Threads ページで制限される）
  const { session: electronSession } = await import('electron')
  const sess = electronSession.fromPartition(`persist:account-${accountId}`)
  const allCookies = await sess.cookies.get({}).catch(() => [] as Electron.Cookie[])
  const csrftoken = allCookies.find(c => c.name === 'csrftoken' && c.domain?.includes('threads.com'))?.value
                 ?? allCookies.find(c => c.name === 'csrftoken')?.value
                 ?? ''
  console.log(`[RestPostMedia] account=${accountId} csrftoken=${csrftoken.slice(0, 8) || '(empty)'}…`)

  const textJson    = JSON.stringify(text)
  const topicJson   = JSON.stringify(topic ?? null)
  const imagesJson  = JSON.stringify(images)
  const csrftokenJs = JSON.stringify(csrftoken)

  try {
    const result = await wc.executeJavaScript(
      `(async function() {
        try {
          var csrftoken       = ${csrftokenJs};
          var images          = ${imagesJson};
          var uploadIds       = [];
          var isSidecar       = images.length > 1;
          var clientSidecarId = isSidecar ? Date.now().toString() : '';

          // ── Step 1: 各画像をアップロード ──────────────────────────────────
          for (var i = 0; i < images.length; i++) {
            if (i > 0) await new Promise(function(r) { setTimeout(r, 200); });
            var uploadId = Date.now().toString();
            uploadIds.push(uploadId);

            // base64 → Uint8Array
            var b64    = images[i].data;
            var mime   = images[i].mime;
            var size   = images[i].size;
            var bin    = atob(b64);
            var bytes  = new Uint8Array(bin.length);
            for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);

            var ruploadParams = { media_type: 1, upload_id: uploadId };
            if (isSidecar) { ruploadParams.is_sidecar = '1'; ruploadParams.client_sidecar_id = clientSidecarId; }

            var upResp = await fetch('/rupload_igphoto/fb_uploader_' + uploadId, {
              method: 'POST',
              headers: {
                'x-entity-type':               mime,
                'x-entity-length':             String(size),
                'x-entity-name':               'fb_uploader_' + uploadId,
                'x-instagram-rupload-params':  JSON.stringify(ruploadParams),
                'offset':                      '0',
                'content-type':                'application/octet-stream',
                'x-csrftoken':                 csrftoken,
                'x-ig-app-id':                 '238260118697367',
                'x-asbd-id':                   '129477',
              },
              body: bytes,
              credentials: 'include',
            });
            if (!upResp.ok) {
              var upBody = await upResp.text();
              return { status: upResp.status, body: upBody, error: 'upload failed image ' + i };
            }
            // サーバーが返す upload_id があればそちらを使う
            try {
              var upJson = await upResp.clone().json();
              if (upJson && upJson.upload_id) uploadIds[uploadIds.length - 1] = String(upJson.upload_id);
            } catch (_) { /* レスポンスが JSON でない場合は無視 */ }
          }

          // ── Step 2: configure ──────────────────────────────────────────────
          var textVal   = ${textJson};
          var topicVal  = ${topicJson};
          var selfId    = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
          var appInfo = JSON.stringify({
            community_flair_id: null,
            entry_point: 'main_tab_bar',
            excluded_inline_media_ids: '[]',
            fediverse_composer_enabled: true,
            gif_media_id: null,
            is_reply_approval_enabled: false,
            is_spoiler_media: false,
            link_attachment_url: null,
            reply_control: 0,
            self_thread_context_id: selfId,
            snippet_attachment: null,
            special_effects_enabled_str: null,
            tag_header: topicVal ? { display_text: topicVal } : null,
            text_with_entities: { entities: [], text: textVal },
          });
          var cfgResp;
          if (uploadIds.length === 1) {
            // ── 1枚: configure_text_post_app_feed (URL-encoded) ──────────────
            var params = new URLSearchParams({
              audience: 'default',
              barcelona_source_reply_id: '',
              caption: textVal,
              creator_geo_gating_info: JSON.stringify({ whitelist_country_codes: [] }),
              cross_share_info: '',
              custom_accessibility_caption: '',
              gen_ai_detection_method: '',
              internal_features: '',
              is_meta_only_post: '',
              is_paid_partnership: '',
              is_threads: 'true',
              is_upload_type_override_allowed: '1',
              should_include_permalink: 'true',
              text_post_app_info: appInfo,
              upload_id: uploadIds[0],
              usertags: '',
            });
            cfgResp = await fetch('/api/v1/media/configure_text_post_app_feed/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-csrftoken':  csrftoken,
                'x-ig-app-id':  '238260118697367',
                'x-asbd-id':    '129477',
              },
              body: params.toString(),
              credentials: 'include',
            });
          } else {
            // ── 複数枚: configure_text_post_app_sidecar (JSON) ───────────────
            var sidecarBody = JSON.stringify({
              audience: 'default',
              caption: textVal,
              children_metadata: uploadIds.map(function(uid) { return { upload_id: uid }; }),
              client_sidecar_id: clientSidecarId,
              creator_geo_gating_info: JSON.stringify({ whitelist_country_codes: [] }),
              internal_features: '',
              is_threads: true,
              is_upload_type_override_allowed: '1',
              should_include_permalink: true,
              text_post_app_info: appInfo,
            });
            cfgResp = await fetch('/api/v1/media/configure_text_post_app_sidecar/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-csrftoken':  csrftoken,
                'x-ig-app-id':  '238260118697367',
                'x-asbd-id':    '129477',
              },
              body: sidecarBody,
              credentials: 'include',
            });
          }
          var cfgBody = await cfgResp.text();
          return { status: cfgResp.status, body: cfgBody };
        } catch(e) {
          return { status: 0, body: '', error: e.message };
        }
      })()`,
      true
    )
    const r = result as { status: number; body: string; error?: string }
    if (r.error) {
      console.error(`[RestPostMedia] error: ${r.error}`)
      return null
    }
    return { status: r.status, body: r.body }
  } catch (e) {
    console.error(`[RestPostMedia] executeJavaScript error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/**
 * アップロード済みの upload_ids を使い、WebContentsView の JS から sidecar configure を実行する。
 * doPost（手動Cookie）では sidecar configure が 400 になるため、ブラウザセッションのまま呼ぶ。
 */
export async function configureSidecarViaView(opts: {
  accountId:      number
  text:           string
  uploadIds:      string[]
  topic?:         string
  clientSidecarId: string
}): Promise<{ status: number; body: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allKeys = [...((_manager as any)?.views?.keys() ?? [])]
  console.log(`[configureSidecarViaView] views keys=${JSON.stringify(allKeys)} accountId=${opts.accountId}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (_manager as any)?.views?.get(opts.accountId) as
    | { view: { webContents: Electron.WebContents }; loaded?: boolean }
    | undefined
  if (!entry) { console.warn(`[configureSidecarViaView] no entry for account=${opts.accountId}`); return null }
  const wc = entry.view?.webContents
  if (!wc || wc.isDestroyed()) { console.warn(`[configureSidecarViaView] webContents unavailable`); return null }
  if (!entry.loaded) { console.warn(`[configureSidecarViaView] entry.loaded=false`); return null }
  const viewUrl = wc.getURL() ?? ''
  console.log(`[configureSidecarViaView] viewUrl=${viewUrl}`)
  if (!viewUrl.includes('threads.com') || viewUrl.includes('/login')) {
    console.warn(`[configureSidecarViaView] URL check failed: ${viewUrl}`)
    return null
  }

  const { session: electronSession } = await import('electron')
  const sess = electronSession.fromPartition(`persist:account-${opts.accountId}`)
  const allCookies = await sess.cookies.get({}).catch(() => [] as Electron.Cookie[])
  const csrftoken = allCookies.find(c => c.name === 'csrftoken' && c.domain?.includes('threads.com'))?.value
                 ?? allCookies.find(c => c.name === 'csrftoken')?.value ?? ''

  const selfId = crypto.randomUUID()
  const appInfo = JSON.stringify({
    community_flair_id: null,
    entry_point: 'main_tab_bar',
    excluded_inline_media_ids: '[]',
    fediverse_composer_enabled: true,
    gif_media_id: null,
    is_reply_approval_enabled: false,
    is_spoiler_media: false,
    link_attachment_url: null,
    reply_control: 0,
    self_thread_context_id: selfId,
    snippet_attachment: null,
    special_effects_enabled_str: null,
    tag_header: opts.topic ? { display_text: opts.topic } : null,
    text_with_entities: { entities: [], text: opts.text },
  })

  const bodyObj = {
    audience: 'default',
    barcelona_source_reply_id: '',
    caption: opts.text,
    children_metadata: opts.uploadIds.map(uid => ({
      upload_id: uid,
      scene_type: null,
      scene_capture_type: '',
    })),
    client_sidecar_id: opts.clientSidecarId,
    creator_geo_gating_info: JSON.stringify({ whitelist_country_codes: [] }),
    cross_share_info: '',
    custom_accessibility_caption: '',
    gen_ai_detection_method: '',
    internal_features: '',
    is_meta_only_post: '',
    is_paid_partnership: '',
    is_threads: 'true',
    is_upload_type_override_allowed: '1',
    should_include_permalink: 'true',
    text_post_app_info: appInfo,
    usertags: '',
  }

  const bodyJs     = JSON.stringify(JSON.stringify(bodyObj))  // JS文字列リテラルとして安全に埋め込む
  const csrftokenJs = JSON.stringify(csrftoken)

  console.log(`[configureSidecarViaView] account=${opts.accountId} uploadIds=${JSON.stringify(opts.uploadIds)} sidecarId=${opts.clientSidecarId} csrftoken=${csrftoken.slice(0,8)}...`)
  console.log(`[configureSidecarViaView] body=${JSON.stringify(bodyObj)}`)

  try {
    const result = await wc.executeJavaScript(
      `(async function() {
        try {
          var csrftoken = ${csrftokenJs};
          var body      = ${bodyJs};
          var resp = await fetch('/api/v1/media/configure_text_post_app_sidecar/', {
            method: 'POST',
            headers: {
              'Content-Type':       'text/plain;charset=UTF-8',
              'x-csrftoken':        csrftoken,
              'x-ig-app-id':        '238260118697367',
              'x-asbd-id':          '359341',
              'x-instagram-ajax':   '0',
              'x-bloks-version-id': '86eaac606b7c5e9b45f4357f86082d05eace8411e43d3f754d885bf54a759a71',
            },
            body: body,
            credentials: 'include',
          });
          var text = await resp.text();
          var hdrs = {};
          resp.headers.forEach(function(v, k) { hdrs[k] = v; });
          return { status: resp.status, body: text, headers: hdrs };
        } catch(e) {
          return { status: 0, body: '', error: e.message };
        }
      })()`,
      true
    )
    const r = result as { status: number; body: string; headers?: Record<string, string>; error?: string }
    if (r.error) {
      console.error(`[configureSidecarViaView] error: ${r.error}`)
      return null
    }
    console.log(`[configureSidecarViaView] status=${r.status}`)
    console.log(`[configureSidecarViaView] resp-headers=${JSON.stringify(r.headers ?? {})}`)
    console.log(`[configureSidecarViaView] resp-body=${r.body}`)
    return { status: r.status, body: r.body }
  } catch (e) {
    console.error(`[configureSidecarViaView] executeJavaScript error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ── GraphQL helpers (like / follow) ──────────────────────────────────────────

const THREADS_GRAPHQL_URL = 'https://www.threads.com/api/graphql'
const LIKE_DOC_ID         = '24753372994365040'
const FOLLOW_DOC_ID       = '26234294899535416'
// BarcelonaActivityFeedListPaginationQuery (activity ページの通知一覧取得クエリ)
const NOTIF_DOC_ID        = '26652441151048593'
const BLOKS_VERSION_ID    = '86eaac606b7c5e9b45f4357f86082d05eace8411e43d3f754d885bf54a759a71'

/** View の JS コンテキストで GraphQL ミューテーションを実行する共通ヘルパー */
async function graphqlViaView(opts: {
  accountId:    number
  docId:        string
  friendlyName: string
  variables:    Record<string, unknown>
}): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (_manager as any)?.views?.get(opts.accountId) as
    | { view: { webContents: Electron.WebContents }; loaded?: boolean }
    | undefined
  if (!entry?.view?.webContents || entry.view.webContents.isDestroyed() || !entry.loaded) {
    return { ok: false, error: 'view not available' }
  }
  const wc = entry.view.webContents
  const viewUrl = wc.getURL() ?? ''
  if (!viewUrl.includes('threads.com') || viewUrl.includes('/login')) {
    return { ok: false, error: `view URL invalid: ${viewUrl}` }
  }

  const tokens = await extractPageApiTokens(opts.accountId).catch(() => null)
  if (!tokens?.fbDtsg || !tokens?.lsd) {
    return { ok: false, error: 'fb_dtsg/lsd unavailable' }
  }

  const { session: electronSession } = await import('electron')
  const sess = electronSession.fromPartition(`persist:account-${opts.accountId}`)
  const allCookies = await sess.cookies.get({}).catch(() => [] as Electron.Cookie[])
  const csrftoken = allCookies.find(c => c.name === 'csrftoken' && c.domain?.includes('threads.com'))?.value
                 ?? allCookies.find(c => c.name === 'csrftoken')?.value ?? ''

  const fbDtsgJs   = JSON.stringify(tokens.fbDtsg)
  const lsdJs      = JSON.stringify(tokens.lsd)
  const csrfJs     = JSON.stringify(csrftoken)
  const varsJs     = JSON.stringify(JSON.stringify(opts.variables))
  const docIdJs    = JSON.stringify(opts.docId)
  const nameJs     = JSON.stringify(opts.friendlyName)
  const gqlUrlJs   = JSON.stringify(THREADS_GRAPHQL_URL)
  const bloksJs    = JSON.stringify(BLOKS_VERSION_ID)

  console.log(`[graphqlViaView] account=${opts.accountId} ${opts.friendlyName}`)

  try {
    const result = await wc.executeJavaScript(
      `(async function() {
        try {
          var fbDtsg   = ${fbDtsgJs};
          var lsd      = ${lsdJs};
          var csrftoken = ${csrfJs};
          var variables = ${varsJs};
          var docId    = ${docIdJs};
          var name     = ${nameJs};
          var gqlUrl   = ${gqlUrlJs};
          var bloks    = ${bloksJs};
          var params = new URLSearchParams();
          params.set('fb_dtsg', fbDtsg);
          params.set('lsd', lsd);
          params.set('__a', '1');
          params.set('__comet_req', '29');
          params.set('fb_api_caller_class', 'RelayModern');
          params.set('fb_api_req_friendly_name', name);
          params.set('server_timestamps', 'true');
          params.set('variables', variables);
          params.set('doc_id', docId);
          var resp = await fetch(gqlUrl, {
            method: 'POST',
            headers: {
              'Content-Type':       'application/x-www-form-urlencoded',
              'X-CSRFToken':        csrftoken,
              'X-FB-LSD':           lsd,
              'X-FB-Friendly-Name': name,
              'X-ASBD-ID':          '359341',
              'X-IG-App-ID':        '238260118697367',
              'X-BLOKS-VERSION-ID': bloks,
            },
            body: params.toString(),
            credentials: 'include',
          });
          var text = await resp.text();
          return { status: resp.status, body: text };
        } catch(e) {
          return { status: 0, body: '', error: e.message };
        }
      })()`,
      true
    )
    const r = result as { status: number; body: string; error?: string }
    if (r.error) return { ok: false, error: r.error }
    console.log(`[graphqlViaView] ${opts.friendlyName} status=${r.status} body=${r.body.slice(0, 200)}`)
    if (r.status < 200 || r.status >= 300) return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 100)}` }
    try {
      const json = JSON.parse(r.body) as Record<string, unknown>
      return { ok: true, data: json }
    } catch {
      return { ok: true }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * /activity ページをロードし Relay ストアから通知一覧を読み取る。
 * GraphQL リクエストを送らず SSR でプリロードされたデータを利用する。
 */
export async function fetchNotificationsViaGraphQL(
  accountId: number
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (_manager as any)?.views?.get(accountId) as
    | { view: { webContents: Electron.WebContents }; loaded?: boolean }
    | undefined
  if (!entry?.view?.webContents || entry.view.webContents.isDestroyed() || !entry.loaded) {
    return { ok: false, error: 'view not available' }
  }
  const wc = entry.view.webContents
  const prevUrl = wc.getURL() ?? ''
  if (!prevUrl.includes('threads.com') || prevUrl.includes('/login')) {
    return { ok: false, error: `view URL invalid: ${prevUrl}` }
  }

  // /activity ページへ遷移してRelayストアを水和させる
  const isOnActivity = prevUrl.includes('/activity')
  if (!isOnActivity) {
    await new Promise<void>(resolve => {
      const onLoad = () => resolve()
      wc.once('did-finish-load', onLoad)
      wc.loadURL('https://www.threads.com/activity')
      setTimeout(() => { wc.off('did-finish-load', onLoad); resolve() }, 15000)
    })
    // Relay ストア水和を待つ
    await new Promise(r => setTimeout(r, 3000))
  }

  console.log(`[fetchNotificationsViaGraphQL] account=${accountId} reading Relay store`)

  try {
    const raw = await wc.executeJavaScript(`
      (function() {
        function resolveRec(source, id, depth) {
          if (depth > 3 || !id) return null;
          var rec = source.get(id);
          if (!rec) return null;
          var out = {};
          for (var k in rec) {
            var v = rec[k];
            if (v && typeof v === 'object' && v.__ref) {
              out[k] = resolveRec(source, v.__ref, depth + 1);
            } else if (v && typeof v === 'object' && v.__refs) {
              out[k] = v.__refs.map(function(r) { return resolveRec(source, r, depth + 1); }).filter(Boolean);
            } else {
              out[k] = v;
            }
          }
          return out;
        }
        try {
          var relayEnv = require('BarcelonaRelayEnvironment');
          var env = relayEnv && relayEnv.default ? relayEnv.default : relayEnv;
          var source = env.getStore().getSource();
          var conn = source.get('client:root:xdt_api__v1__text_feed__notifications__connection');
          if (!conn) return JSON.stringify({ error: 'no connection' });
          var edgeRefs = (conn.edges && conn.edges.__refs) ? conn.edges.__refs : [];
          var notifications = [];
          for (var i = 0; i < edgeRefs.length; i++) {
            var edge = source.get(edgeRefs[i]);
            if (!edge) continue;
            var nodeRef = edge.node && edge.node.__ref;
            if (!nodeRef) continue;
            var node = resolveRec(source, nodeRef, 0);
            if (!node) continue;
            var args = node.args || {};
            var extra = args.extra || {};
            var mediaDict = extra.media_dict || {};
            var title = extra.title || '';
            var usernameMatch = title.match(/\\{([^|]+)\\|/);
            notifications.push({
              notifId:   args.tuuid || node.__id,
              iconName:  extra.icon_name || '',
              mediaId:   mediaDict.pk || '',
              username:  usernameMatch ? usernameMatch[1] : '',
              content:   extra.content || '',
              context:   extra.context || '',
              timestamp: mediaDict.taken_at || 0,
            });
          }
          return JSON.stringify({ notifications: notifications });
        } catch(e) {
          return JSON.stringify({ error: e.message });
        }
      })()
    `, false) as string

    // 元ページへ戻る
    if (!isOnActivity && prevUrl) {
      wc.loadURL(prevUrl).catch(() => {})
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.error) return { ok: false, error: parsed.error as string }
    console.log(`[fetchNotificationsViaGraphQL] account=${accountId} notifications=${(parsed.notifications as unknown[])?.length ?? 0}`)
    return { ok: true, data: parsed }
  } catch (e) {
    if (!isOnActivity && prevUrl) {
      wc.loadURL(prevUrl).catch(() => {})
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 投稿にいいねする（GraphQL ミューテーション） */
export async function likeViaView(
  accountId: number,
  mediaId:   string
): Promise<{ success: boolean; error?: string }> {
  const result = await graphqlViaView({
    accountId,
    docId:        LIKE_DOC_ID,
    friendlyName: 'useTHLikeMutationLikeMutation',
    variables: {
      mediaID: mediaId,
      requestData: {
        container_module:    'ig_text_feed_timeline',
        logging_info_token:  null,
        nav_chain:           null,
        query_text:          null,
        search_session_id:   null,
        serp_session_id:     null,
      },
    },
  })
  if (result.ok) return { success: true }
  return { success: false, error: result.error }
}

/** ユーザーをフォローする（GraphQL ミューテーション） */
export async function followViaView(
  accountId: number,
  userId:    string
): Promise<{ success: boolean; error?: string }> {
  const result = await graphqlViaView({
    accountId,
    docId:        FOLLOW_DOC_ID,
    friendlyName: 'useTHFollowMutationFollowMutation',
    variables: {
      target_user_id:                userId,
      media_id_attribution:          null,
      container_module:              'ig_text_feed_profile',
      ranking_info_token:            null,
      barcelona_source_quote_post_id: null,
      barcelona_source_reply_id:     null,
    },
  })
  if (result.ok) return { success: true }
  return { success: false, error: result.error }
}

/**
 * openCompose でテキストを入力した後、投稿ボタンをクリックして投稿を完了させる。
 * API (GraphQL) が使えない場合の代替投稿手段として使用する。
 */
export async function autoPostViaUI(
  accountId: number,
  content:   string
): Promise<{ success: boolean; error?: string }> {
  if (!_manager) return { success: false, error: 'ViewManager not initialized' }

  console.log(`[autoPostViaUI] account=${accountId} filling compose...`)

  // Step 1: openCompose でコンポーズダイアログを開きテキストを入力
  const fillResult = await _manager.openCompose(accountId, content)
  if (!fillResult.success) {
    console.warn(`[autoPostViaUI] openCompose failed: ${fillResult.error}`)
    return fillResult
  }

  // Step 2: webContents を取得して投稿ボタンをクリック
  const entry = (_manager as any)?.views?.get(accountId) as
    | { view: { webContents: Electron.WebContents }; loaded?: boolean }
    | undefined
  const wc = entry?.view?.webContents
  if (!wc || wc.isDestroyed()) {
    return { success: false, error: '投稿ボタンのクリックに失敗: view not available' }
  }

  try {
    const res = await Promise.race<{ ok: boolean; error?: string }>([
      wc.executeJavaScript(`
        (async function() {
          // テキスト挿入後、少し待ってからボタンを探す
          await new Promise(function(r) { setTimeout(r, 600); });

          // 投稿ボタンのセレクタ（日本語/英語両対応）
          var sels = [
            'button[aria-label="投稿する"]',
            'button[aria-label="Post"]',
            'div[role="button"][aria-label="投稿する"]',
            'div[role="button"][aria-label="Post"]',
          ];
          var btn = document.querySelector(sels.join(', '));

          if (!btn) {
            // aria-label がない場合はテキストで探す
            var allBtns = Array.from(document.querySelectorAll('button, div[role="button"]'));
            btn = allBtns.find(function(b) {
              var t = (b.textContent || '').trim();
              return t === '投稿する' || t === '投稿' || t === 'Post';
            }) || null;
          }

          if (!btn) {
            var labels = Array.from(document.querySelectorAll('button, div[role="button"]'))
              .map(function(b) {
                return (b.textContent || '').trim().slice(0, 20) + '|' + (b.getAttribute('aria-label') || '');
              })
              .filter(function(t) { return t.length > 1 && t.length < 80; })
              .slice(0, 20);
            return { ok: false, error: '投稿ボタン未検出: ' + JSON.stringify(labels) };
          }

          console.log('[autoPostViaUI] clicking post button: ' + (btn.getAttribute('aria-label') || btn.textContent));
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

          // 投稿処理完了を待つ
          await new Promise(function(r) { setTimeout(r, 3000); });
          return { ok: true };
        })()
      `, true),
      new Promise<{ ok: false; error: string }>(resolve =>
        setTimeout(() => resolve({ ok: false, error: '投稿ボタンクリックタイムアウト (15秒)' }), 15000)
      ),
    ])

    if (!res?.ok) {
      console.warn(`[autoPostViaUI] submit failed: ${res?.error}`)
      return { success: false, error: res?.error ?? 'submit failed' }
    }
    console.log(`[autoPostViaUI] account=${accountId} posted via UI`)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * プロフィールアイコンを変更する。
 *
 * 手順:
 *   1. imagePath のファイルを base64 に変換
 *   2. WebContentsView の JS コンテキストで Canvas を使い WebP に変換してから
 *      /rupload_igphoto/fb_uploader_{id} へバイナリ POST
 *   3. require('useBarcelonaEditProfileMutation') で doc_id を取得し
 *      /graphql/query へ mutation POST
 */
export async function changeProfilePicViaView(
  accountId: number,
  imagePath: string,
): Promise<{ success: boolean; error?: string }> {
  // ビューが既に存在するか記録（操作後に一時ビューを破棄するため）
  const hadViewBefore = !!(_manager as any)?.views?.get(accountId)
  console.log(`[changeProfilePic] start accountId=${accountId} hadViewBefore=${hadViewBefore} imagePath=${imagePath}`)

  // ビューが開いていない場合はバックグラウンドで一時起動する
  const ready = await ensureViewLoaded(accountId).catch((e) => {
    console.error(`[changeProfilePic] ensureViewLoaded threw: ${e}`)
    return false
  })
  console.log(`[changeProfilePic] ensureViewLoaded ready=${ready}`)
  if (!ready) {
    if (!hadViewBefore) _manager?.closeView(accountId)
    return { success: false, error: 'Threads ページを読み込めませんでした（ログイン済みか確認してください）' }
  }

  const entry = (_manager as any)?.views?.get(accountId) as
    | { view: { webContents: Electron.WebContents }; loaded?: boolean }
    | undefined
  if (!entry) {
    console.warn(`[changeProfilePic] entry not found for accountId=${accountId}`)
    return { success: false, error: 'WebContentsView が見つかりません。' }
  }
  const wc = entry.view?.webContents
  console.log(`[changeProfilePic] wc=${!!wc} destroyed=${wc?.isDestroyed()} loaded=${entry.loaded}`)
  if (!wc || wc.isDestroyed() || !entry.loaded) return { success: false, error: 'WebContentsView が未ロードです。' }
  const viewUrl = wc.getURL() ?? ''
  console.log(`[changeProfilePic] viewUrl=${viewUrl}`)
  if (!viewUrl.includes('threads.com') || viewUrl.includes('/login')) {
    if (!hadViewBefore) _manager?.closeView(accountId)
    return { success: false, error: 'Threads にログインしていません。' }
  }

  const { readFileSync, existsSync } = await import('fs')
  if (!existsSync(imagePath)) return { success: false, error: `ファイルが見つかりません: ${imagePath}` }

  const buf  = readFileSync(imagePath)
  const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png'
             : imagePath.toLowerCase().endsWith('.webp') ? 'image/webp'
             : 'image/jpeg'
  const b64  = buf.toString('base64')

  const { session: electronSession } = await import('electron')
  const sess = electronSession.fromPartition(`persist:account-${accountId}`)
  const allCookies = await sess.cookies.get({}).catch(() => [] as Electron.Cookie[])
  const csrftoken  = allCookies.find(c => c.name === 'csrftoken' && c.domain?.includes('threads.com'))?.value
                  ?? allCookies.find(c => c.name === 'csrftoken')?.value ?? ''

  const b64Json  = JSON.stringify(b64)
  const mimeJson = JSON.stringify(mime)
  const csrfJson = JSON.stringify(csrftoken)

  // ハードコード済み doc_id（ネットワークキャプチャから取得）
  const MUT_DOC_ID = '26068142076211881'
  const PROFILE_QUERY_DOC_ID = '27246326161633735'

  try {
    const result = await Promise.race([
      wc.executeJavaScript(`
        (async function() {
          try {
            var b64       = ${b64Json};
            var mime      = ${mimeJson};
            var csrftoken = ${csrfJson};
            var mutDocId  = ${JSON.stringify(MUT_DOC_ID)};

            // ── トークン取得（LSD/DTSGInitialData は常にロード済みの基本モジュール）──
            var lsd = '', fbDtsg = '';
            try { lsd    = require('LSD')?.token || ''; }             catch(_) {}
            try { fbDtsg = require('DTSGInitialData')?.token || ''; } catch(_) {}
            if (!lsd) return { success: false, error: 'lsd token 取得失敗（Threadsへのログインが必要な可能性があります）' };

            // ── 現在のプロフィール情報取得（name/biography/etc. を上書きしないため）──
            var profileName = '', biography = '', externalUrl = '', isPrivate = false, username = '';
            try {
              var profileBodyStr = 'lsd=' + encodeURIComponent(lsd)
                + '&doc_id=${PROFILE_QUERY_DOC_ID}'
                + '&variables=' + encodeURIComponent('{}')
                + '&fb_api_req_friendly_name=BarcelonaProfileEditDialogQuery'
                + '&server_timestamps=true';
              if (fbDtsg) profileBodyStr += '&fb_dtsg=' + encodeURIComponent(fbDtsg);
              var profileResp = await fetch('/graphql/query', {
                method: 'POST',
                headers: {
                  'Content-Type':       'application/x-www-form-urlencoded',
                  'X-IG-App-ID':        '238260118697367',
                  'X-FB-LSD':           lsd,
                  'X-FB-Friendly-Name': 'BarcelonaProfileEditDialogQuery',
                  'X-Root-Field-Name':  'xdt_text_app_viewer',
                  'X-CSRFToken':        csrftoken,
                  'X-ASBD-ID':          '359341',
                },
                body: profileBodyStr,
                credentials: 'include',
              });
              var profileData = await profileResp.json();
              var viewer = profileData?.data?.xdt_text_app_viewer;
              if (viewer) {
                username    = viewer.username    || '';
                profileName = viewer.full_name   || '';
                biography   = viewer.biography   || '';
                externalUrl = viewer.external_lynx_url || viewer.external_url || '';
                isPrivate   = viewer.is_private  || false;
              }
            } catch(_) {}

            var uploadId = String(Date.now());

            // ── 画像を WebP に変換 (Canvas) ──────────────────────────────────
            var img = new Image();
            await new Promise(function(res, rej) {
              img.onload = res; img.onerror = rej;
              img.src = 'data:' + mime + ';base64,' + b64;
            });
            var canvas = document.createElement('canvas');
            canvas.width  = img.naturalWidth  || img.width  || 400;
            canvas.height = img.naturalHeight || img.height || 400;
            canvas.getContext('2d').drawImage(img, 0, 0);
            var webpBlob = await new Promise(function(res) { canvas.toBlob(res, 'image/webp', 0.9); });
            var webpBuf  = await webpBlob.arrayBuffer();
            var webpBytes = new Uint8Array(webpBuf);

            // ── Step 1: rupload ──────────────────────────────────────────────
            var ruploadParams = JSON.stringify({
              is_sidecar: '0', is_threads: '1', media_type: 1,
              upload_id: uploadId,
              upload_media_height: canvas.height,
              upload_media_width:  canvas.width,
            });
            var upResp = await fetch('/rupload_igphoto/fb_uploader_' + uploadId, {
              method: 'POST',
              headers: {
                'X-Entity-Type':              'image/webp',
                'X-Entity-Length':            String(webpBytes.length),
                'X-Entity-Name':              'fb_uploader_' + uploadId,
                'X-Instagram-Rupload-Params': ruploadParams,
                'Offset':                     '0',
                'Content-Type':               'image/webp',
                'X-CSRFToken':                csrftoken,
                'X-IG-App-ID':                '238260118697367',
                'X-ASBD-ID':                  '359341',
                'X-FB-LSD':                   lsd,
              },
              body: webpBytes,
              credentials: 'include',
            });
            var upText = await upResp.text();
            if (!upResp.ok) return { success: false, error: 'rupload failed ' + upResp.status + ': ' + upText.slice(0, 200), debug: { step: 'rupload', status: upResp.status, body: upText.slice(0, 500) } };
            try {
              var upJson = JSON.parse(upText);
              if (upJson && upJson.upload_id) uploadId = String(upJson.upload_id);
            } catch(_) {}

            // ── Step 2: useBarcelonaEditProfileMutation ──────────────────────
            var uploadIdNum = Number(uploadId);
            var mutVars = JSON.stringify({
              external_url:                           externalUrl,
              biography:                              biography,
              username:                               username,
              name:                                   profileName,
              is_private:                             isPrivate,
              profile_picture_upload_id:              uploadIdNum,
              remove_profile_picture:                 false,
              copy_ig_profile_picture_to_text_post_app: false,
            });
            var mutBodyStr = 'lsd=' + encodeURIComponent(lsd)
              + '&doc_id='                      + encodeURIComponent(mutDocId)
              + '&variables='                   + encodeURIComponent(mutVars)
              + '&fb_api_caller_class=RelayModern'
              + '&fb_api_req_friendly_name=useBarcelonaEditProfileMutation'
              + '&server_timestamps=true';
            if (fbDtsg) mutBodyStr += '&fb_dtsg=' + encodeURIComponent(fbDtsg);

            var mutResp = await fetch('/graphql/query', {
              method: 'POST',
              headers: {
                'Content-Type':          'application/x-www-form-urlencoded',
                'X-IG-App-ID':           '238260118697367',
                'X-FB-LSD':              lsd,
                'X-FB-Friendly-Name':    'useBarcelonaEditProfileMutation',
                'X-Root-Field-Name':     'xdt_text_app_edit_profile_mutation',
                'X-CSRFToken':           csrftoken,
                'X-ASBD-ID':             '359341',
              },
              body: mutBodyStr,
              credentials: 'include',
            });
            var mutText = await mutResp.text();
            var dbgInfo = {
              step: 'mutation',
              uploadId: uploadId,
              uploadIdType: typeof uploadIdNum,
              uploadStatus: upResp.status,
              uploadBody: upText.slice(0, 200),
              mutStatus: mutResp.status,
              mutBody: mutText.slice(0, 1000),
              variables: mutVars,
              username: username,
              profileName: profileName,
              lsdOk: !!lsd,
              fbDtsgOk: !!fbDtsg,
            };
            if (!mutResp.ok) return { success: false, error: 'mutation failed ' + mutResp.status, debug: dbgInfo };
            try {
              var mutJson = JSON.parse(mutText);
              if (mutJson.errors && mutJson.errors.length > 0) {
                return { success: false, error: 'mutation error: ' + JSON.stringify(mutJson.errors[0]), debug: dbgInfo };
              }
            } catch(_) {}
            return { success: true, debug: dbgInfo };
          } catch(e) {
            return { success: false, error: String(e && e.message ? e.message : e), debug: { step: 'exception' } };
          }
        })()
      `, true) as Promise<{ success: boolean; error?: string; debug?: Record<string, unknown> }>,
      new Promise<{ success: boolean; error: string; debug?: Record<string, unknown> }>(resolve =>
        setTimeout(() => resolve({ success: false, error: 'タイムアウト (60秒)' }), 60000)
      ),
    ])

    if (result.debug) {
      console.log(`[changeProfilePic:debug] account=${accountId} debug=${JSON.stringify(result.debug)}`)
    }
    if (result.success) {
      console.log(`[changeProfilePic] account=${accountId} icon changed ✓`)
    } else {
      console.warn(`[changeProfilePic] account=${accountId} failed: ${result.error}`)
    }
    if (!hadViewBefore) {
      console.log(`[changeProfilePic] account=${accountId} closing temporary background view`)
      _manager?.closeView(accountId)
    }
    return result
  } catch (e) {
    if (!hadViewBefore) _manager?.closeView(accountId)
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
