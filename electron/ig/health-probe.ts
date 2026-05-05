/**
 * WebView を開く前に API で軽く生死判定する。
 *
 * - alive: セッション有効
 * - login_required: セッション切れ
 * - challenge: チャレンジ要求
 * - feedback_required: スパム判定
 * - rate_limited: レート制限
 * - unknown: 判定不能
 */

import { net, session as electronSession } from 'electron'
import { selectUA } from './ua-selector'

export type ProbeStatus = 'alive' | 'login_required' | 'challenge' | 'feedback_required' | 'rate_limited' | 'unknown'

export type ProbeResult =
  | { status: 'alive'; userId: string }
  | { status: 'login_required' }
  | { status: 'challenge' }
  | { status: 'feedback_required' }
  | { status: 'rate_limited' }
  | { status: 'unknown'; raw: string }

interface CookieLike {
  name: string
  value: string
}

interface ProbeOpts {
  cookies: CookieLike[]
  proxyUrl?: string
  proxyUsername?: string
  proxyPassword?: string
}

export async function probeAccountHealth(opts: ProbeOpts): Promise<ProbeResult> {
  const { ua } = selectUA(opts.cookies)
  const csrf = opts.cookies.find(c => c.name === 'csrftoken')?.value || ''
  const cookieHeader = opts.cookies
    .filter(c => c.value && c.value !== '&quot')
    .map(c => `${c.name}=${c.value}`)
    .join('; ')

  const isMobile = ua.startsWith('Instagram ')
  const url = isMobile
    ? 'https://i.instagram.com/api/v1/accounts/current_user/'
    : 'https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram'
  const appId = isMobile ? '567067343352427' : '936619743392459'

  // 一時セッション (プロキシ設定用)
  const partitionKey = `temp:probe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const sess = electronSession.fromPartition(partitionKey)

  if (opts.proxyUrl) {
    let proxyRules = opts.proxyUrl.trim()
    if (!/^https?:\/\/|^socks5?:\/\//i.test(proxyRules)) proxyRules = 'http://' + proxyRules
    await sess.setProxy({ proxyRules }).catch(() => {})
  }

  return new Promise<ProbeResult>((resolve) => {
    const request = net.request({ method: 'GET', url, session: sess })

    // プロキシ認証
    if (opts.proxyUsername) {
      (request as any).on('login', (authInfo: any, callback: (u: string, p: string) => void) => {
        if (authInfo.isProxy) callback(opts.proxyUsername!, opts.proxyPassword ?? '')
      })
    }

    request.setHeader('User-Agent', ua)
    request.setHeader('X-IG-App-ID', appId)
    request.setHeader('X-CSRFToken', csrf)
    request.setHeader('Cookie', cookieHeader)
    request.setHeader('Accept', '*/*')
    request.setHeader('Accept-Language', 'en-US,en;q=0.9')

    const timer = setTimeout(() => {
      request.abort()
      resolve({ status: 'unknown', raw: 'timeout' })
    }, 15_000)

    let body = ''
    request.on('response', response => {
      response.on('data', chunk => { body += chunk.toString() })
      response.on('end', () => {
        clearTimeout(timer)
        try {
          const json = JSON.parse(body)
          if (json.status === 'ok' && (json.user || json.data)) {
            const userId = String(json.user?.pk || json.data?.user?.id || '')
            resolve({ status: 'alive', userId })
            return
          }
          if (json.message === 'login_required') {
            resolve({ status: 'login_required' })
            return
          }
          if (json.message === 'challenge_required' || json.message === 'checkpoint_required') {
            resolve({ status: 'challenge' })
            return
          }
          if (json.message === 'feedback_required') {
            resolve({ status: 'feedback_required' })
            return
          }
          if (typeof json.message === 'string' && json.message.includes('Please wait')) {
            resolve({ status: 'rate_limited' })
            return
          }
          resolve({ status: 'unknown', raw: body.slice(0, 500) })
        } catch {
          resolve({ status: 'unknown', raw: body.slice(0, 500) })
        }
      })
    })
    request.on('error', () => {
      clearTimeout(timer)
      resolve({ status: 'unknown', raw: 'network_error' })
    })
    request.end()
  })
}
