import { WebContentsView, session, BrowserWindow } from 'electron'
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
    return {
      x:      SIDEBAR_WIDTH,
      y,
      width:  Math.max(cb.width - SIDEBAR_WIDTH, 0),
      height: Math.max(height, 0),
    }
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

    // DBのプロキシ設定をセッションに反映（fire-and-forget）
    void (async () => {
      try {
        const account = getAccountById(accountId)
        if (account?.proxy_url) {
          await sess.setProxy({ proxyRules: account.proxy_url })
        } else {
          await sess.setProxy({ proxyRules: 'direct://' })
        }
      } catch { /* セッションが破棄済みなどは無視 */ }
    })()

    // DBからフィンガープリントを取得（なければ生成してDBに保存）
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

  async startLogin(tempKey: string): Promise<{ username: string }> {
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

        let hasSession = false
        try {
          if (popup.isDestroyed()) return
          const cookies = await popup.webContents.session.cookies.get({})
          if (done) return
          hasSession = cookies.some(
            (c) =>
              c.name === 'sessionid' &&
              c.value.length > 0 &&
              (c.domain?.includes('threads.com') || c.domain?.includes('instagram.com'))
          )
        } catch { return }

        if (!hasSession) return

        done = true
        clearTimeout(timer)
        if (pollInterval) clearInterval(pollInterval)

        await new Promise<void>((r) => setTimeout(r, 800))

        let username = 'unknown'
        try {
          if (!popup.isDestroyed()) {
            const currentUrl = popup.webContents.getURL()
            const urlMatch = currentUrl.match(/threads\.(?:com|net)\/@([^/?#]+)/)
            if (urlMatch) {
              username = urlMatch[1]
            } else {
              username = await popup.webContents.executeJavaScript(`
                (function() {
                  const a = document.querySelector('a[href*="/@"]');
                  if (a) {
                    const m = a.getAttribute('href').match(/@([^/?#]+)/);
                    if (m) return m[1];
                  }
                  const m = document.title.match(/@([^\\s|]+)/);
                  if (m) return m[1];
                  return 'unknown';
                })()
              `)
            }
          }
        } catch { /* popup が 800ms 待機中に破棄された場合は username='unknown' で続行 */ }

        if (!popup.isDestroyed()) popup.close()
        resolve({ username })
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
        prev.view.setBounds(HIDDEN_BOUNDS)
      }
    }

    const existing = this.views.get(accountId)

    if (existing && !existing.view.webContents.isDestroyed()) {
      // 既存ビューを再利用 — setBounds で表示するだけ、loadURL は呼ばない
      this.activeAccountId = accountId
      existing.view.setBounds(this.calcBounds(y, height))
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
    view.setBounds(this.calcBounds(y, height))
    this.notify()

    // バックグラウンドでセッション Cookie を確認して Threads を読み込む（初回のみ）
    this.showQueue = this.showQueue
      .then(() => this._bgInitView(accountId))
      .catch(() => {})
  }

  private async _bgInitView(accountId: number): Promise<void> {
    const entry = this.views.get(accountId)
    // loaded フラグで二重実行を防ぐ
    if (!entry || entry.loaded || entry.view.webContents.isDestroyed()) return
    entry.loaded = true
    const sess = session.fromPartition(`persist:account-${accountId}`)
    await this.ensureSessionCookies(accountId, sess).catch(() => {})
    if (!this.views.has(accountId) || entry.view.webContents.isDestroyed()) return
    entry.view.webContents.loadURL(THREADS_URL)
  }

  /**
   * ビューを「非表示」にする。contentView からは取り外さない。
   * isVisible=false のとき（ツールパネル表示中など）に呼ばれる。
   */
  hideView(accountId: number): void {
    const entry = this.views.get(accountId)
    if (entry && !entry.view.webContents.isDestroyed()) {
      entry.view.setBounds(HIDDEN_BOUNDS)
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
