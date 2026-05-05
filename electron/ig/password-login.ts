/**
 * Instagram パスワード + TOTP ログイン (Web API)
 *
 * フロー:
 * 1. /api/v1/web/accounts/login/ajax/ に POST
 * 2. 2FA 要求あれば /accounts/login/ajax/two_factor/ に TOTP 送信
 * 3. Set-Cookie からセッション cookie を抽出して返す
 */

import { net, session as electronSession } from 'electron'

export interface PasswordLoginInput {
  username: string
  password: string
  totpSecret?: string
  proxyUrl?: string
  proxyUsername?: string
  proxyPassword?: string
}

interface SimpleCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate: number
}

export type PasswordLoginResult =
  | { status: 'ok'; cookies: SimpleCookie[]; userId: string }
  | { status: 'bad_password' }
  | { status: 'challenge' }
  | { status: 'rate_limited' }
  | { status: 'two_factor_required'; cookies: SimpleCookie[] }
  | { status: 'unknown'; raw: string }

const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const IG_APP_ID = '936619743392459'

export async function loginWithPassword(input: PasswordLoginInput): Promise<PasswordLoginResult> {
  const partitionKey = `temp:pw-login-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const sess = electronSession.fromPartition(partitionKey)

  // プロキシ設定
  if (input.proxyUrl) {
    let proxyRules = input.proxyUrl.trim()
    if (!/^https?:\/\/|^socks5?:\/\//i.test(proxyRules)) proxyRules = 'http://' + proxyRules
    await sess.setProxy({ proxyRules }).catch(() => {})
  }

  // Step 1: csrf token 取得 (IG のトップページにアクセスして Set-Cookie から取得)
  const csrfToken = await fetchCsrfToken(sess, input)
  if (!csrfToken) {
    return { status: 'unknown', raw: 'failed_to_get_csrf' }
  }

  // Step 2: ログインリクエスト
  const ts = Math.floor(Date.now() / 1000)
  const encPassword = `#PWD_INSTAGRAM_BROWSER:0:${ts}:${input.password}`

  const loginResult = await doLoginRequest(sess, input, csrfToken, encPassword)

  // 2FA 要求
  if (loginResult.twoFactorRequired && input.totpSecret) {
    const totpCode = generateTOTP(input.totpSecret)
    const twoFactorResult = await doTwoFactorRequest(
      sess, input, csrfToken, loginResult.twoFactorInfo, totpCode,
    )
    return twoFactorResult
  }

  if (loginResult.twoFactorRequired && !input.totpSecret) {
    return { status: 'two_factor_required', cookies: loginResult.cookies }
  }

  return loginResult.result
}

function generateTOTP(secret: string): string {
  const { TOTP } = require('otpauth')
  const totp = new TOTP({ secret, digits: 6, period: 30, algorithm: 'SHA1' })
  return totp.generate()
}

async function fetchCsrfToken(
  sess: Electron.Session,
  input: PasswordLoginInput,
): Promise<string | null> {
  return new Promise((resolve) => {
    const req = net.request({ method: 'GET', url: 'https://www.instagram.com/accounts/login/', session: sess })
    if (input.proxyUsername) {
      (req as any).on('login', (authInfo: any, cb: (u: string, p: string) => void) => {
        if (authInfo.isProxy) cb(input.proxyUsername!, input.proxyPassword ?? '')
      })
    }
    req.setHeader('User-Agent', WEB_UA)
    req.setHeader('Accept', 'text/html')

    let body = ''
    req.on('response', (resp) => {
      // Set-Cookie から csrftoken を抽出
      const setCookies = resp.headers['set-cookie'] as string[] | undefined
      let csrf: string | null = null
      if (setCookies) {
        for (const sc of setCookies) {
          const m = sc.match(/csrftoken=([^;]+)/)
          if (m) { csrf = m[1]; break }
        }
      }
      resp.on('data', (c) => { body += c.toString() })
      resp.on('end', () => {
        if (!csrf) {
          // body から csrftoken を探す
          const bm = body.match(/"csrf_token":"([^"]+)"/)
          if (bm) csrf = bm[1]
        }
        resolve(csrf)
      })
    })
    req.on('error', () => resolve(null))
    setTimeout(() => { req.abort(); resolve(null) }, 15_000)
    req.end()
  })
}

interface LoginRequestResult {
  result: PasswordLoginResult
  twoFactorRequired: boolean
  twoFactorInfo?: any
  cookies: SimpleCookie[]
}

async function doLoginRequest(
  sess: Electron.Session,
  input: PasswordLoginInput,
  csrfToken: string,
  encPassword: string,
): Promise<LoginRequestResult> {
  return new Promise((resolve) => {
    const body = new URLSearchParams({
      username: input.username,
      enc_password: encPassword,
      queryParams: '{}',
      optIntoOneTap: 'false',
    }).toString()

    const req = net.request({
      method: 'POST',
      url: 'https://www.instagram.com/api/v1/web/accounts/login/ajax/',
      session: sess,
    })
    if (input.proxyUsername) {
      (req as any).on('login', (authInfo: any, cb: (u: string, p: string) => void) => {
        if (authInfo.isProxy) cb(input.proxyUsername!, input.proxyPassword ?? '')
      })
    }
    req.setHeader('User-Agent', WEB_UA)
    req.setHeader('X-CSRFToken', csrfToken)
    req.setHeader('X-IG-App-ID', IG_APP_ID)
    req.setHeader('X-Requested-With', 'XMLHttpRequest')
    req.setHeader('Content-Type', 'application/x-www-form-urlencoded')
    req.setHeader('Referer', 'https://www.instagram.com/accounts/login/')
    req.setHeader('Origin', 'https://www.instagram.com')

    let respBody = ''
    req.on('response', (resp) => {
      const cookies = extractCookiesFromHeaders(resp.headers['set-cookie'] as string[] | undefined)
      resp.on('data', (c) => { respBody += c.toString() })
      resp.on('end', () => {
        try {
          const json = JSON.parse(respBody)

          if (json.authenticated === true) {
            const userId = json.userId || cookies.find(c => c.name === 'ds_user_id')?.value || ''
            resolve({
              result: { status: 'ok', cookies, userId: String(userId) },
              twoFactorRequired: false,
              cookies,
            })
            return
          }

          if (json.two_factor_required) {
            resolve({
              result: { status: 'two_factor_required', cookies },
              twoFactorRequired: true,
              twoFactorInfo: json.two_factor_info,
              cookies,
            })
            return
          }

          if (json.message === 'checkpoint_required' || json.checkpoint_url) {
            resolve({ result: { status: 'challenge' }, twoFactorRequired: false, cookies })
            return
          }

          if (json.message?.includes('Please wait') || resp.statusCode === 429) {
            resolve({ result: { status: 'rate_limited' }, twoFactorRequired: false, cookies })
            return
          }

          if (json.authenticated === false) {
            resolve({ result: { status: 'bad_password' }, twoFactorRequired: false, cookies })
            return
          }

          resolve({ result: { status: 'unknown', raw: respBody.slice(0, 500) }, twoFactorRequired: false, cookies })
        } catch {
          resolve({ result: { status: 'unknown', raw: respBody.slice(0, 500) }, twoFactorRequired: false, cookies })
        }
      })
    })
    req.on('error', () => resolve({ result: { status: 'unknown', raw: 'network_error' }, twoFactorRequired: false, cookies: [] }))
    setTimeout(() => { req.abort(); resolve({ result: { status: 'unknown', raw: 'timeout' }, twoFactorRequired: false, cookies: [] }) }, 30_000)
    req.write(body)
    req.end()
  })
}

async function doTwoFactorRequest(
  sess: Electron.Session,
  input: PasswordLoginInput,
  csrfToken: string,
  twoFactorInfo: any,
  totpCode: string,
): Promise<PasswordLoginResult> {
  return new Promise((resolve) => {
    const identifier = twoFactorInfo?.two_factor_identifier || ''
    const body = new URLSearchParams({
      username: input.username,
      verificationCode: totpCode,
      identifier,
      queryParams: '{}',
    }).toString()

    const req = net.request({
      method: 'POST',
      url: 'https://www.instagram.com/accounts/login/ajax/two_factor/',
      session: sess,
    })
    if (input.proxyUsername) {
      (req as any).on('login', (authInfo: any, cb: (u: string, p: string) => void) => {
        if (authInfo.isProxy) cb(input.proxyUsername!, input.proxyPassword ?? '')
      })
    }
    req.setHeader('User-Agent', WEB_UA)
    req.setHeader('X-CSRFToken', csrfToken)
    req.setHeader('X-IG-App-ID', IG_APP_ID)
    req.setHeader('X-Requested-With', 'XMLHttpRequest')
    req.setHeader('Content-Type', 'application/x-www-form-urlencoded')
    req.setHeader('Referer', 'https://www.instagram.com/accounts/login/')
    req.setHeader('Origin', 'https://www.instagram.com')

    let respBody = ''
    req.on('response', (resp) => {
      const cookies = extractCookiesFromHeaders(resp.headers['set-cookie'] as string[] | undefined)
      resp.on('data', (c) => { respBody += c.toString() })
      resp.on('end', () => {
        try {
          const json = JSON.parse(respBody)
          if (json.authenticated === true) {
            const userId = json.userId || cookies.find(c => c.name === 'ds_user_id')?.value || ''
            resolve({ status: 'ok', cookies, userId: String(userId) })
            return
          }
          if (json.message?.includes('Please wait') || resp.statusCode === 429) {
            resolve({ status: 'rate_limited' })
            return
          }
          resolve({ status: 'unknown', raw: respBody.slice(0, 500) })
        } catch {
          resolve({ status: 'unknown', raw: respBody.slice(0, 500) })
        }
      })
    })
    req.on('error', () => resolve({ status: 'unknown', raw: 'network_error' }))
    setTimeout(() => { req.abort(); resolve({ status: 'unknown', raw: 'timeout' }) }, 30_000)
    req.write(body)
    req.end()
  })
}

function extractCookiesFromHeaders(setCookies: string[] | undefined): SimpleCookie[] {
  if (!setCookies) return []
  const result: SimpleCookie[] = []
  for (const sc of setCookies) {
    const parts = sc.split(';')[0].split('=')
    const name = parts[0]?.trim()
    const value = parts.slice(1).join('=').trim()
    if (name && value) {
      result.push({
        name,
        value,
        domain: '.instagram.com',
        path: '/',
        secure: true,
        httpOnly: sc.toLowerCase().includes('httponly'),
        expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
      })
    }
  }
  return result
}
