import https from 'https'
import { BrowserWindow } from 'electron'
import { getSetting, setSetting } from '../db/repositories/settings'

// Discord Developer Portal に登録する Redirect URI
// BrowserWindow の will-redirect でインターセプトするため HTTP サーバー不要
export const REDIRECT_URI = 'http://127.0.0.1:47392/callback'
const SCOPES              = 'identify guilds'
const TOKEN_URL           = 'https://discord.com/api/oauth2/token'
const GUILDS_URL          = 'https://discord.com/api/users/@me/guilds'
const ME_URL              = 'https://discord.com/api/users/@me'

// ── HTTP helpers ───────────────────────────────────────────────────────────────

const HTTPS_TIMEOUT_MS = 15_000

function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: HTTPS_TIMEOUT_MS,
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    })
    req.on('timeout', () => { req.destroy(); reject(new Error(`POST ${url} timed out`)) })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function httpsGet(url: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      timeout: HTTPS_TIMEOUT_MS,
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    })
    req.on('timeout', () => { req.destroy(); reject(new Error(`GET ${url} timed out`)) })
    req.on('error', reject)
    req.end()
  })
}

// ── Token exchange & refresh ───────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

async function exchangeCode(code: string, clientId: string, clientSecret: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  REDIRECT_URI,
  }).toString()

  const raw = await httpsPost(TOKEN_URL, body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  const data = JSON.parse(raw)
  if (!data.access_token) throw new Error(`Token exchange failed: ${raw}`)
  return data as TokenResponse
}

async function refreshToken(refreshTokenStr: string, clientId: string, clientSecret: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    'refresh_token',
    refresh_token: refreshTokenStr,
  }).toString()

  const raw = await httpsPost(TOKEN_URL, body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  const data = JSON.parse(raw)
  if (!data.access_token) throw new Error(`Token refresh failed: ${raw}`)
  return data as TokenResponse
}

// ── Guild membership check ─────────────────────────────────────────────────────

async function checkGuildMembership(accessToken: string, requiredServerId: string): Promise<boolean> {
  const raw    = await httpsGet(GUILDS_URL, accessToken)
  const guilds = JSON.parse(raw) as Array<{ id: string }>
  if (!Array.isArray(guilds)) return false
  return guilds.some((g) => g.id === requiredServerId)
}

async function fetchUsername(accessToken: string): Promise<string> {
  const raw  = await httpsGet(ME_URL, accessToken)
  const user = JSON.parse(raw) as { username: string; discriminator?: string }
  const disc = user.discriminator && user.discriminator !== '0' ? `#${user.discriminator}` : ''
  return `${user.username}${disc}`
}

// ── Stored token verification ──────────────────────────────────────────────────

export interface AuthCheckResult {
  ok: boolean
  username?: string
  error?: string
}

export async function verifyStoredAuth(): Promise<AuthCheckResult> {
  const clientId       = getSetting('discord_oauth_client_id')
  const clientSecret   = getSetting('discord_oauth_client_secret')
  const requiredServer = getSetting('discord_required_server_id')
  const accessToken    = getSetting('discord_auth_access_token')
  const expiresAt      = getSetting('discord_auth_expires_at')
  const storedUsername = getSetting('discord_auth_username')

  if (!accessToken) return { ok: false, error: 'not_authenticated' }

  // トークンが10分以内に期限切れなら更新
  const expiry = parseInt(expiresAt ?? '0')
  if (Date.now() > expiry - 10 * 60 * 1000) {
    const rt = getSetting('discord_auth_refresh_token')
    if (!rt || !clientId || !clientSecret) return { ok: false, error: 'token_expired' }
    try {
      const tokens = await refreshToken(rt, clientId, clientSecret)
      saveTokens(tokens)
    } catch {
      return { ok: false, error: 'token_expired' }
    }
  }

  const currentToken = getSetting('discord_auth_access_token')!

  if (requiredServer) {
    try {
      const isMember = await checkGuildMembership(currentToken, requiredServer)
      if (!isMember) return { ok: false, error: 'not_member' }
    } catch (err) {
      return { ok: false, error: `guild_check_failed: ${String(err)}` }
    }
  }

  return { ok: true, username: storedUsername ?? undefined }
}

// ── OAuth flow ─────────────────────────────────────────────────────────────────

function saveTokens(tokens: TokenResponse): void {
  setSetting('discord_auth_access_token',  tokens.access_token)
  setSetting('discord_auth_refresh_token', tokens.refresh_token)
  setSetting('discord_auth_expires_at',    String(Date.now() + tokens.expires_in * 1000))
}

/**
 * Discord OAuth フロー。
 * BrowserWindow でポップアップを開き、コールバック URL をインターセプトして認証完了。
 * - will-navigate で redirect 前にキャンセル（第一層）
 * - webRequest.onBeforeRequest でネットワーク層でキャンセル（第二層）
 */
export async function startOAuthFlow(): Promise<AuthCheckResult> {
  const clientId       = getSetting('discord_oauth_client_id')
  const clientSecret   = getSetting('discord_oauth_client_secret')
  const requiredServer = getSetting('discord_required_server_id')

  if (!clientId || !clientSecret) {
    return { ok: false, error: 'Client ID / Secret が設定されていません。設定画面で入力してください。' }
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
  })
  const authUrl = `https://discord.com/oauth2/authorize?${params}`

  console.log('[DiscordOAuth] opening popup:', authUrl)

  const popup = new BrowserWindow({
    width:  520,
    height: 720,
    title:  'Discord でログイン',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      // Discord が WebView/Electron を弾かないよう標準 Chrome UA を使用
      additionalArguments: [],
    },
  })

  // Discord のページが Electron WebView を拒否しないよう UA を上書き
  popup.webContents.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  )

  return new Promise((resolve) => {
    let resolved = false

    const finish = (result: AuthCheckResult) => {
      if (resolved) return
      resolved = true
      console.log('[DiscordOAuth] finish:', result.ok ? `OK user=${result.username ?? '(none)'}` : result.error)
      if (!popup.isDestroyed()) popup.close()
      resolve(result)
    }

    const handleCallbackUrl = async (url: string) => {
      if (resolved) return
      console.log('[DiscordOAuth] callback intercepted:', url)
      try {
        const u     = new URL(url)
        const code  = u.searchParams.get('code')
        const error = u.searchParams.get('error')

        if (error || !code) {
          finish({ ok: false, error: error ?? 'no_code' })
          return
        }

        console.log('[DiscordOAuth] exchangeCode...')
        const tokens = await exchangeCode(code, clientId!, clientSecret!)
        saveTokens(tokens)
        console.log('[DiscordOAuth] exchangeCode OK')

        console.log('[DiscordOAuth] fetchUsername...')
        const username = await fetchUsername(tokens.access_token)
        setSetting('discord_auth_username', username)
        console.log('[DiscordOAuth] fetchUsername OK:', username)

        if (requiredServer) {
          console.log('[DiscordOAuth] checkGuildMembership:', requiredServer)
          const isMember = await checkGuildMembership(tokens.access_token, requiredServer)
          console.log('[DiscordOAuth] isMember:', isMember)
          if (!isMember) {
            setSetting('discord_auth_access_token',  '')
            setSetting('discord_auth_refresh_token', '')
            finish({ ok: false, error: '指定されたDiscordサーバーのメンバーではありません。' })
            return
          }
        }

        finish({ ok: true, username })
      } catch (err) {
        console.error('[DiscordOAuth] callback error:', err)
        finish({ ok: false, error: String(err) })
      }
    }

    // ── 第一層: will-navigate でコールバック URL をキャンセル ────────────────
    // フォーム送信・JS リダイレクト・サーバーリダイレクト 全てに対応
    popup.webContents.on('will-navigate', (event, url) => {
      console.log('[DiscordOAuth] will-navigate:', url)
      if (url.startsWith(REDIRECT_URI)) {
        event.preventDefault()
        handleCallbackUrl(url)
      }
    })

    // will-redirect は HTTP 302 リダイレクト専用（will-navigate の補完）
    popup.webContents.on('will-redirect', (event, url) => {
      console.log('[DiscordOAuth] will-redirect:', url)
      if (url.startsWith(REDIRECT_URI)) {
        event.preventDefault()
        handleCallbackUrl(url)
      }
    })

    // ── 第二層: webRequest でネットワーク層からキャンセル（念押し）──────────
    popup.webContents.session.webRequest.onBeforeRequest(
      { urls: [`${REDIRECT_URI}*`] },
      (details, callback) => {
        console.log('[DiscordOAuth] webRequest intercepted:', details.url)
        callback({ cancel: true })
        handleCallbackUrl(details.url)
      }
    )

    // ── did-navigate: 万一上記をすり抜けた場合のフォールバック ───────────────
    popup.webContents.on('did-navigate', (_e, url) => {
      console.log('[DiscordOAuth] did-navigate:', url)
      if (url.startsWith(REDIRECT_URI)) {
        handleCallbackUrl(url)
      }
    })

    popup.webContents.on('did-fail-load', (_e, errorCode, errorDesc, url) => {
      console.log('[DiscordOAuth] did-fail-load:', errorCode, errorDesc, url)
    })

    popup.on('closed', () => {
      console.log('[DiscordOAuth] popup closed by user')
      finish({ ok: false, error: 'ログインがキャンセルされました' })
    })

    setTimeout(() => {
      console.log('[DiscordOAuth] timeout')
      finish({ ok: false, error: '認証がタイムアウトしました（5分）' })
    }, 5 * 60 * 1000)

    popup.loadURL(authUrl)
  })
}

export function clearAuth(): void {
  setSetting('discord_auth_access_token',  '')
  setSetting('discord_auth_refresh_token', '')
  setSetting('discord_auth_expires_at',    '')
  setSetting('discord_auth_username',      '')
}
