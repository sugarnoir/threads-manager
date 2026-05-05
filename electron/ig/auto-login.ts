/**
 * 自動ログイン修復ロジック
 *
 * Cookie UA総当たり → パスワード+TOTP ログインの順で試行。
 * WebView は開かない。API レベルのみで判定。
 */

import { Session } from 'electron'
import { sanitizeCookies, isCookieSetUsable } from './cookie-sanitizer'
import { selectUA, UA_STRINGS } from './ua-selector'
import { probeAccountHealth } from './health-probe'
import { loginWithPassword } from './password-login'

interface CookieLike {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
}

export interface AutoLoginInput {
  accountId: number
  username: string
  password: string | null
  totpSecret?: string | null
  cookies: CookieLike[]
  proxyUrl?: string | null
  proxyUsername?: string | null
  proxyPassword?: string | null
  permSess: Session
}

export interface AutoLoginOutcome {
  loggedIn: boolean
  internalReason: string
  giveUp: boolean
}

export async function autoLogin(input: AutoLoginInput): Promise<AutoLoginOutcome> {
  const { sanitized } = sanitizeCookies(input.cookies as any)

  // ── ステップ 1-3: Cookie + UA 総当たり ────────────────────────────────────
  if (isCookieSetUsable(sanitized)) {
    const inferredUA = selectUA(sanitized).ua
    const uaCandidates = [inferredUA]
    if (inferredUA !== UA_STRINGS.ios_safari) uaCandidates.push(UA_STRINGS.ios_safari)
    if (inferredUA !== UA_STRINGS.desktop_chrome) uaCandidates.push(UA_STRINGS.desktop_chrome)

    for (const ua of uaCandidates) {
      const probe = await probeAccountHealth({
        cookies: sanitized,
        proxyUrl: input.proxyUrl ?? undefined,
        proxyUsername: input.proxyUsername ?? undefined,
        proxyPassword: input.proxyPassword ?? undefined,
        uaOverride: ua,
      })

      if (probe.status === 'alive') {
        await injectCookiesToSession(sanitized, input.permSess)
        const uaLabel = ua === UA_STRINGS.ios_safari ? 'ios' : ua === UA_STRINGS.desktop_chrome ? 'chrome' : 'inferred'
        return { loggedIn: true, internalReason: `cookie_${uaLabel}`, giveUp: false }
      }
      if (probe.status === 'challenge' || probe.status === 'feedback_required') {
        // challenge/feedback でも cookie は有効→注入して active にする
        await injectCookiesToSession(sanitized, input.permSess)
        return { loggedIn: true, internalReason: probe.status, giveUp: false }
      }
      if (probe.status === 'rate_limited') {
        return { loggedIn: false, internalReason: 'rate_limited', giveUp: false }
      }
      // login_required / unknown → 次の UA を試す
    }
  }

  // ── ステップ 4: Password + TOTP フルログイン ───────────────────────────────
  if (input.password) {
    try {
      const result = await loginWithPassword({
        username: input.username,
        password: input.password,
        totpSecret: input.totpSecret ?? undefined,
        proxyUrl: input.proxyUrl ?? undefined,
        proxyUsername: input.proxyUsername ?? undefined,
        proxyPassword: input.proxyPassword ?? undefined,
      })

      if (result.status === 'ok') {
        await injectCookiesToSession(result.cookies as any, input.permSess)
        return { loggedIn: true, internalReason: 'password_login', giveUp: false }
      }
      if (result.status === 'bad_password') {
        return { loggedIn: false, internalReason: 'bad_password', giveUp: true }
      }
      if (result.status === 'challenge') {
        return { loggedIn: false, internalReason: 'password_challenge', giveUp: false }
      }
      if (result.status === 'rate_limited') {
        return { loggedIn: false, internalReason: 'password_rate_limited', giveUp: false }
      }
      if (result.status === 'two_factor_required') {
        return { loggedIn: false, internalReason: 'two_factor_no_secret', giveUp: !input.totpSecret }
      }
      return { loggedIn: false, internalReason: 'password_unknown', giveUp: false }
    } catch (err) {
      console.error(`[autoLogin] password login error: ${err instanceof Error ? err.message : err}`)
      return { loggedIn: false, internalReason: 'password_error', giveUp: false }
    }
  }

  // Password なし & cookie 失敗 → 諦め
  return { loggedIn: false, internalReason: 'no_credentials', giveUp: true }
}

async function injectCookiesToSession(cookies: CookieLike[], sess: Session): Promise<void> {
  for (const c of cookies) {
    await sess.cookies.set({
      url: 'https://www.instagram.com',
      name: c.name,
      value: c.value,
      domain: c.domain ?? '.instagram.com',
      path: c.path ?? '/',
      secure: true,
      httpOnly: c.httpOnly ?? false,
      sameSite: 'no_restriction' as const,
      expirationDate: c.expirationDate ?? Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
    }).catch(() => {})
  }
}
