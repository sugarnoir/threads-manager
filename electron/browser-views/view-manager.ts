import { WebContentsView, session, BrowserWindow, net, clipboard, nativeImage } from 'electron'
import { loadOrCreateFingerprint, buildOverrideScript, writeAccountPreload } from '../fingerprint'
import { getContextCookiesIfOpen } from '../playwright/browser-manager'
import { getSetting, setSetting } from '../db/repositories/settings'
import { getAccountById } from '../db/repositories/accounts'

const THREADS_URL = 'https://www.threads.com'
const LOGIN_URL   = `${THREADS_URL}/login`

/** サイドバー幅（CSS の w-60 = 15rem = 240px に対応）*/
const SIDEBAR_WIDTH = 240

// ── Cookie helpers ─────────────────────────────────────────────────────────────

interface RawCookie {
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

async function injectCookies(cookies: RawCookie[], sess: Electron.Session): Promise<boolean> {
  const yearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 3600

  const hasSession = cookies.some(
    (c) =>
      c.name === 'sessionid' &&
      c.value?.length > 0 &&
      (c.domain?.includes('threads.com') || c.domain?.includes('instagram.com'))
  )
  if (!hasSession) return false

  await Promise.all(cookies.map(async (c) => {
    if (!c.value || !c.domain) return
    const expiry = c.expirationDate ?? (c.expires !== undefined && c.expires > 0 ? c.expires : yearFromNow)
    try {
      await sess.cookies.set({
        url:            `https://${c.domain.replace(/^\./, '')}`,
        name:           c.name,
        value:          c.value,
        domain:         c.domain,
        path:           c.path ?? '/',
        secure:         c.secure  ?? true,
        httpOnly:       c.httpOnly ?? false,
        expirationDate: expiry,
        sameSite:       toElectronSameSite(c.sameSite),
      })
    } catch { /* skip malformed cookies */ }
  }))

  return true
}

// ── Profile extraction (main process → Instagram API) ─────────────────────────
//
// メインプロセスから net.fetch で Instagram API を直接叩く。
// レンダラー側の fetch と違い CORS 制限がないため確実に取得できる。
// ds_user_id Cookie → /api/v1/users/{id}/info/ → username + full_name

async function fetchProfileFromInstagram(
  cookies: Electron.Cookie[]
): Promise<{ username: string; displayName: string | null }> {
  // ds_user_id はログイン中ユーザーの数値 ID (Instagram がセットする)
  const dsUserId = cookies.find((c) => c.name === 'ds_user_id')?.value
  if (!dsUserId) return { username: 'unknown', displayName: null }

  // Cookie ヘッダー文字列を構築（instagram.com / threads.com 両ドメイン分）
  const cookieHeader = cookies
    .filter((c) => c.value && (c.domain?.includes('instagram.com') || c.domain?.includes('threads.com')))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')

  const csrfToken = cookies.find((c) => c.name === 'csrftoken')?.value ?? ''

  try {
    const resp = await net.fetch(
      `https://i.instagram.com/api/v1/users/${dsUserId}/info/`,
      {
        headers: {
          Cookie:         cookieHeader,
          'X-CSRFToken':  csrfToken,
          'X-IG-App-ID':  '936619743392459',
          'User-Agent':   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        },
      }
    )
    if (resp.ok) {
      const data = await resp.json() as { user?: { username?: string; full_name?: string } }
      const username    = data.user?.username?.trim()  || 'unknown'
      const displayName = data.user?.full_name?.trim() || null
      return { username, displayName }
    }
  } catch { /* ネットワークエラーなど */ }

  return { username: 'unknown', displayName: null }
}

// ── StatusCheckResult ─────────────────────────────────────────────────────────

export type AccountStatus = 'active' | 'needs_login' | 'frozen' | 'error'

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

export class ViewManager {
  private views:           Map<number, ViewEntry> = new Map()
  private activeAccountId: number | null          = null
  private mainWindow:      BrowserWindow
  private onChanged:       ((infos: ViewInfo[]) => void) | null = null

  private notifyTimer: ReturnType<typeof setTimeout> | null = null
  private showQueue:   Promise<void> = Promise.resolve()

  constructor(win: BrowserWindow) {
    this.mainWindow = win
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

    view.webContents.on('did-navigate', (_event, url) => {
      this.notify()
      const entry = this.views.get(accountId)
      if (entry && this.isLoginUrl(url) && !entry.restoringSession) {
        entry.restoringSession = true
        this.ensureSessionCookies(accountId, sess).then((restored) => {
          if (entry) entry.restoringSession = false
          // このビューがまだ存在する場合のみリダイレクト
          if (restored && this.views.has(accountId) && !view.webContents.isDestroyed()) {
            view.webContents.loadURL(THREADS_URL)
          }
        }).catch(() => { if (entry) entry.restoringSession = false })
      }
    })
    view.webContents.on('did-navigate-in-page', () => this.notify())
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

    return view
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

    popup.loadURL(LOGIN_URL)
    popup.focus()

    return new Promise((resolve, reject) => {
      let done = false
      let pollInterval: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        clearTimeout(timer)
        if (pollInterval) clearInterval(pollInterval)
        if (!popup.isDestroyed()) popup.close()
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
        if (pollInterval) clearInterval(pollInterval)
        reject(new Error('ログインがキャンセルされました'))
      })

      const checkCookies = async () => {
        if (done) return

        let allCookies: Electron.Cookie[] = []
        try {
          if (popup.isDestroyed()) return
          allCookies = await popup.webContents.session.cookies.get({})
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
        if (pollInterval) clearInterval(pollInterval)

        // Cookie はすでに取得済み → メインプロセスから Instagram API を直接叩く
        // CORS なし・DOM 待機不要・他人のリンクを誤検知しない
        const { username, displayName } = await fetchProfileFromInstagram(allCookies)

        if (!popup.isDestroyed()) popup.close()
        resolve({ username, displayName })
      }

      pollInterval = setInterval(checkCookies, 1000)
      popup.webContents.on('did-navigate',         () => checkCookies())
      popup.webContents.on('did-navigate-in-page', () => checkCookies())
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

    return new Promise((resolve, reject) => {
      let done = false
      let pollInterval: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        clearTimeout(timer)
        if (pollInterval) clearInterval(pollInterval)
        if (!popup.isDestroyed()) popup.close()
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
        if (pollInterval) clearInterval(pollInterval)
        reject(new Error('ログインがキャンセルされました'))
      })

      const checkCookies = async () => {
        if (done) return

        let allCookies: Electron.Cookie[] = []
        try {
          if (popup.isDestroyed()) return
          allCookies = await popup.webContents.session.cookies.get({})
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
        if (pollInterval) clearInterval(pollInterval)

        // Cookie はすでに取得済み → メインプロセスから Instagram API を直接叩く
        const { username, displayName } = await fetchProfileFromInstagram(allCookies)

        if (!popup.isDestroyed()) popup.close()
        resolve({ username, displayName })
      }

      pollInterval = setInterval(checkCookies, 1000)
      popup.webContents.on('did-navigate',         () => checkCookies())
      popup.webContents.on('did-navigate-in-page', () => checkCookies())
    })
  }

  async migrateLoginSession(tempKey: string, accountId: number): Promise<void> {
    const tempSession = session.fromPartition(`persist:login-${tempKey}`)
    const permSession = session.fromPartition(`persist:account-${accountId}`)
    const cookies = await tempSession.cookies.get({})

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
      // HIDDEN_BOUNDS (0×0) から正しい bounds に変更した際に GPU が再描画しない場合があるため強制更新
      this.nudgeRepaint(accountId)
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
    console.log(`[_bgInitView] loadURL account=${accountId} bounds=`, entry.view.getBounds())
    entry.view.webContents.loadURL(THREADS_URL)
    // macOS vibrancy 環境でロード後に黒くなる問題の対策:
    // did-finish-load 後に setBounds を ±1px 微調整して GPU コンポジターの再描画を強制する
    entry.view.webContents.once('did-finish-load', () => {
      console.log(`[_bgInitView] did-finish-load account=${accountId}`)
      this.nudgeRepaint(accountId)
    })
    entry.view.webContents.once('did-fail-load', (_e, errCode, errDesc, url) => {
      console.log(`[_bgInitView] did-fail-load account=${accountId} errCode=${errCode} errDesc=${errDesc} url=${url}`)
    })
  }

  /**
   * macOS の vibrancy ウィンドウ上で WebContentsView が黒くなる問題の対策。
   * GPU コンポジターに再描画を強制するため bounds を ±1px 微調整する。
   *
   * target を先にキャプチャし、setTimeout 内では target.width に戻すことで
   * updateBounds が割り込んでも正しい値に復元できる。
   * moveOffscreen で画面外にある間は nudge 不要（GPU サーフェスは生きている）。
   */
  private nudgeRepaint(accountId: number): void {
    const e = this.views.get(accountId)
    if (!e || e.view.webContents.isDestroyed()) return
    const target = e.view.getBounds()
    if (target.width <= 0 || target.height <= 0) return
    // 画面外（moveOffscreen）なら nudge 不要
    if (target.x < 0) return
    e.view.setBounds({ ...target, width: target.width + 1 })
    setTimeout(() => {
      const e2 = this.views.get(accountId)
      if (!e2 || e2.view.webContents.isDestroyed()) return
      const cur = e2.view.getBounds()
      // bounce 中に moveOffscreen が呼ばれた場合は復元しない
      if (cur.x < 0) return
      e2.view.setBounds({ ...cur, width: target.width })
    }, 50)
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

  /** リサイズ時に bounds を更新する。 */
  updateBounds(accountId: number, y: number, height: number): void {
    if (this.activeAccountId !== accountId) return
    const entry = this.views.get(accountId)
    if (entry && !entry.view.webContents.isDestroyed()) {
      entry.view.setBounds(this.calcBounds(y, height))
    }
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

  async openCompose(accountId: number, content: string, images: string[] = []): Promise<{ success: boolean; error?: string }> {
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

      const script = `
        (async function() {
          var text = ${contentJson};

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
