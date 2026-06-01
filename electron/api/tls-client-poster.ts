/**
 * tls-client 経由テキスト投稿
 *
 * Python ワーカーに Cookie + プロファイルを渡して投稿する。
 * 失敗時は呼び出し元が従来 Path 1 にフォールバックする。
 */

import { session } from 'electron'
import { getAccountById } from '../db/repositories/accounts'
import { pythonBridge } from '../lib/python-bridge'
import { generateBrowserUA } from '../lib/ua-generator'

export interface TlsPostResult {
  success: boolean
  status?: number
  error?: string
  mediaId?: string
  body?: string
}

export async function postTextViaTlsClient(
  accountId: number,
  text: string,
  topic?: string,
): Promise<TlsPostResult> {
  const account = getAccountById(accountId)
  if (!account) return { success: false, error: 'account not found' }
  if (!account.tls_profile) return { success: false, error: 'tls_profile is null' }

  if (!pythonBridge.isReady()) {
    return { success: false, error: 'Python worker not running' }
  }

  // Cookie 取得 (threads.com + instagram.com)
  const partition = `persist:account-${accountId}`
  const sess = session.fromPartition(partition)
  const threadsCookies = await sess.cookies.get({ url: 'https://www.threads.com' })
  const igCookies = await sess.cookies.get({ url: 'https://www.instagram.com' })

  // 統合 (threads.com 優先)
  const cookieMap = new Map<string, { name: string; value: string; domain: string; path: string }>()
  for (const c of igCookies) {
    cookieMap.set(c.name, { name: c.name, value: c.value, domain: c.domain ?? '.instagram.com', path: c.path ?? '/' })
  }
  for (const c of threadsCookies) {
    cookieMap.set(c.name, { name: c.name, value: c.value, domain: c.domain ?? '.threads.com', path: c.path ?? '/' })
  }
  const cookies = Array.from(cookieMap.values())

  // CSRF token
  const csrfCookie = threadsCookies.find(c => c.name === 'csrftoken')
    ?? igCookies.find(c => c.name === 'csrftoken')
  if (!csrfCookie) return { success: false, error: 'csrftoken not found' }

  // Proxy
  let proxy: string | undefined
  if (account.proxy_url && account.proxy_username) {
    const proxyPass = account.proxy_password ?? ''
    proxy = `http://${encodeURIComponent(account.proxy_username)}:${encodeURIComponent(proxyPass)}@${account.proxy_url.replace(/^https?:\/\//, '')}`
  }

  console.log(`[TLS Client] postText account=${accountId} profile=${account.tls_profile} cookies=${cookies.length} proxy=${proxy ? 'yes' : 'no'}`)

  try {
    const result = await pythonBridge.send({
      action: 'post_threads_text',
      tls_profile: account.tls_profile,
      cookies,
      csrf_token: csrfCookie.value,
      user_agent: account.user_agent ?? generateBrowserUA(),
      proxy,
      content: text,
      topic: topic ?? undefined,
      app_id: '238260118697367',
    }) as Record<string, unknown>

    const status = result.status as number | undefined
    const body = (result.body as string) ?? ''
    const warning = result.warning as string | undefined
    const parsed = result.parsed as Record<string, unknown> | undefined

    if (warning) {
      console.warn(`[TLS Client] ⚠️ account=${accountId} warning: ${warning}`)
    }

    if (status === 200 && parsed) {
      const s = parsed.status as string | undefined
      if (s === 'ok' || parsed.media_id || parsed.media) {
        const mediaId = parsed.media_id ? String(parsed.media_id) : undefined
        return { success: true, status: 200, mediaId }
      }
      return { success: false, status: 200, error: JSON.stringify(parsed).slice(0, 200), body }
    }

    if (result.error) {
      return { success: false, error: String(result.error), body }
    }

    return { success: false, status, error: `status=${status}: ${body.slice(0, 200)}`, body }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
