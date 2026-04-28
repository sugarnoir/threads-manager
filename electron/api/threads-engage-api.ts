/**
 * Threads / Instagram 非公式 API — いいね・フォロー操作
 *
 * 優先: WebContentsView の JS fetch (GraphQL)
 * フォールバック: i.instagram.com の private API (net.request)
 */

import { net, session } from 'electron'
import { prePostDelay, typingDelay } from '../lib/delay'
import { analyzeAndLog } from '../lib/response-analyzer'
import { likeViaView, followViaView, ensureViewLoaded, fetchNotificationsViaGraphQL } from '../browser-views/view-manager'
import { getApiTokens } from './threads-web-api'
import { getHeadersPatternB, getHeadersPatternC, getUnifiedHeaders } from '../lib/ig-headers'
import { getAccountById } from '../db/repositories/accounts'
import { generateBrowserUA } from '../lib/ua-generator'

const IG_URL     = 'https://i.instagram.com'
const IG_APP_ID  = '936619743392459'
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

// ── Session helpers ───────────────────────────────────────────────────────────

async function getSessionHeaders(accountId: number): Promise<Record<string, string> | null> {
  const sess = session.fromPartition(`persist:account-${accountId}`)
  const allCookies = await sess.cookies.get({}).catch(() => [])
  const cookies = allCookies.filter(c =>
    c.domain?.includes('instagram.com') || c.domain?.includes('threads.com')
  )

  const sessionid = cookies.find(c => c.name === 'sessionid')?.value
  if (!sessionid) return null

  const csrfToken   = cookies.find(c => c.name === 'csrftoken')?.value ?? ''
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  const acct = getAccountById(accountId)
  const unified = !!acct?.use_unified_headers

  return {
    'Cookie':       cookieHeader,
    'X-CSRFToken':  csrfToken,
    'X-IG-App-ID':  IG_APP_ID,
    'User-Agent':   unified ? generateBrowserUA() : USER_AGENT,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer':      'https://www.threads.com/',
    'Origin':       'https://www.threads.com',
    ...(unified ? getUnifiedHeaders(accountId) : getHeadersPatternB(accountId)),
  }
}

function igRequest(method: 'GET' | 'POST', url: string, headers: Record<string, string>, body?: string): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const req = net.request({ method, url })
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)
    let raw = ''
    req.on('response', (resp) => {
      resp.on('data', c => { raw += c.toString() })
      resp.on('end', () => {
        try {
          resolve({ ok: resp.statusCode >= 200 && resp.statusCode < 300, status: resp.statusCode, data: JSON.parse(raw) })
        } catch {
          resolve({ ok: resp.statusCode >= 200 && resp.statusCode < 300, status: resp.statusCode })
        }
      })
    })
    req.on('error', e => resolve({ ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }))
    if (body) req.write(body)
    req.end()
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/** ユーザー名 → ユーザーID を取得 */
export async function apiGetUserId(accountId: number, username: string): Promise<string | null> {
  const sess = session.fromPartition(`persist:account-${accountId}`)
  const allCookies = await sess.cookies.get({}).catch(() => [])
  const sessionid = allCookies.find(c => c.name === 'sessionid')?.value
  if (!sessionid) {
    console.warn(`[apiGetUserId] no sessionid for account=${accountId}`)
    return null
  }

  // net.fetch はセッションのクッキーを自動送信し gzip も自動展開する
  const fetchWithSession = (url: string, init?: RequestInit) =>
    sess.fetch(url, init).then(async (r) => {
      const text = await r.text()
      console.log(`[apiGetUserId] ${init?.method ?? 'GET'} ${url} → ${r.status} body=${text.slice(0, 400)}`)
      return { status: r.status, ok: r.ok, text }
    }).catch((e: unknown) => {
      console.warn(`[apiGetUserId] fetch error ${url}:`, e)
      return null
    })

  // ── 経路1: Threads threads.com profile info (session.fetch でクッキー自動付与) ─
  const r1 = await fetchWithSession(
    `https://www.threads.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    { headers: { 'X-IG-App-ID': '238260118697367', 'Accept': 'application/json' } }
  )
  if (r1?.ok) {
    try {
      const d = JSON.parse(r1.text) as { data?: { user?: { id?: string; pk?: string } } }
      const id = d?.data?.user?.id ?? d?.data?.user?.pk ?? null
      if (id) { console.log(`[apiGetUserId] #1 resolved id=${id}`); return id }
    } catch { /* parse error */ }
  }

  // ── 経路2: Instagram i.instagram.com web_profile_info ───────────────────
  const r2 = await fetchWithSession(
    `${IG_URL}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    { headers: { 'X-IG-App-ID': IG_APP_ID, 'Accept': 'application/json', 'User-Agent': USER_AGENT } }
  )
  if (r2?.ok) {
    try {
      const d = JSON.parse(r2.text) as { data?: { user?: { id?: string; pk?: string } } }
      const id = d?.data?.user?.id ?? d?.data?.user?.pk ?? null
      if (id) { console.log(`[apiGetUserId] #2 resolved id=${id}`); return id }
    } catch { /* parse error */ }
  }

  // ── 経路3: Instagram usernameinfo ────────────────────────────────────────
  const r3 = await fetchWithSession(
    `${IG_URL}/api/v1/users/${encodeURIComponent(username)}/usernameinfo/`,
    { headers: { 'X-IG-App-ID': IG_APP_ID, 'Accept': 'application/json', 'User-Agent': USER_AGENT } }
  )
  if (r3?.ok) {
    try {
      const d = JSON.parse(r3.text) as { user?: { pk?: string; id?: string } }
      const id = d?.user?.pk ?? d?.user?.id ?? null
      if (id) { console.log(`[apiGetUserId] #3 resolved id=${id}`); return id }
    } catch { /* parse error */ }
  }

  console.warn(`[apiGetUserId] all routes failed for @${username}`)
  return null
}

/** ユーザーIDの最近の投稿を取得 */
export async function apiGetUserPosts(
  accountId: number,
  userId:    string,
  count = 20
): Promise<Array<{ id: string; text: string }>> {
  const headers = await getSessionHeaders(accountId)
  if (!headers) return []

  const resp = await igRequest(
    'GET',
    `${IG_URL}/api/v1/feed/user/${userId}/?count=${count}`,
    { ...headers, 'Content-Type': 'application/json' }
  )
  if (!resp.ok) return []

  type Item = { pk?: string; caption?: { text?: string } }
  const data = resp.data as { items?: Item[] }
  return (data?.items ?? [])
    .map(item => ({ id: item.pk ?? '', text: item.caption?.text ?? '' }))
    .filter(p => p.id)
}

/** 投稿にいいね（View GraphQL 優先、フォールバック: mobile API） */
export async function apiLikePost(
  accountId: number,
  mediaId:   string
): Promise<{ success: boolean; error?: string }> {
  // 経路1: WebContentsView GraphQL
  const viewResult = await likeViaView(accountId, mediaId).catch(() => null)
  if (viewResult?.success) {
    console.log(`[Engage] like account=${accountId} mediaId=${mediaId} via view ✓`)
    return { success: true }
  }
  console.warn(`[Engage] like view failed (${viewResult?.error ?? 'null'}) → fallback mobile API`)

  // 経路2: i.instagram.com mobile API
  const headers = await getSessionHeaders(accountId)
  if (!headers) return { success: false, error: 'ログインセッションが見つかりません' }
  const resp = await igRequest('POST', `${IG_URL}/api/v1/media/${mediaId}/like/`, headers, `media_id=${mediaId}&module_name=profile`)
  if (resp.ok)             return { success: true }
  if (resp.status === 400) return { success: false, error: 'いいね済みまたは一時制限中' }
  if (resp.status === 401) return { success: false, error: '認証エラー: 再ログインが必要です' }
  return { success: false, error: `HTTP ${resp.status}` }
}

/** ユーザーをフォロー（View GraphQL 優先、フォールバック: mobile API） */
export async function apiFollowUser(
  accountId: number,
  userId:    string
): Promise<{ success: boolean; already?: boolean; error?: string }> {
  // 経路1: WebContentsView GraphQL
  const viewResult = await followViaView(accountId, userId).catch(() => null)
  if (viewResult?.success) {
    console.log(`[Engage] follow account=${accountId} userId=${userId} via view ✓`)
    return { success: true }
  }
  console.warn(`[Engage] follow view failed (${viewResult?.error ?? 'null'}) → fallback mobile API`)

  // 経路2: i.instagram.com mobile API
  const headers = await getSessionHeaders(accountId)
  if (!headers) return { success: false, error: 'ログインセッションが見つかりません' }
  const resp = await igRequest('POST', `${IG_URL}/api/v1/friendships/create/${userId}/`, headers, `user_id=${userId}`)
  if (resp.ok)             return { success: true }
  if (resp.status === 400) return { success: false, error: 'フォロー制限中またはアカウントが見つかりません' }
  if (resp.status === 401) return { success: false, error: '認証エラー: 再ログインが必要です' }
  return { success: false, error: `HTTP ${resp.status}` }
}

/**
 * 対象ユーザーのフォロワーリストを取得。
 * session.fetch を使い threads.com → i.instagram.com の順で試行。
 *
 * @param maxCount  取得上限（デフォルト 2000 件）
 * @param onProgress ページ取得ごとに呼ばれるコールバック（累計件数）
 */
export async function apiFetchFollowers(
  accountId:   number,
  userId:      string,
  maxCount     = 2000,
  onProgress?: (fetched: number) => void,
): Promise<{ users: Array<{ pk: string; username: string }>; error?: string }> {
  const sess = session.fromPartition(`persist:account-${accountId}`)
  const allCookies = await sess.cookies.get({}).catch(() => [])
  const sessionid = allCookies.find(c => c.name === 'sessionid')?.value
  if (!sessionid) return { users: [], error: 'ログインセッションが見つかりません' }

  const collected: Array<{ pk: string; username: string }> = []
  let maxId: string | null = null
  const PAGE_SIZE = 100

  // threads.com と i.instagram.com を順に試す（最初のページで判定）
  const BASES = [
    { base: 'https://www.threads.com', appId: '238260118697367' },
    { base: IG_URL,                    appId: IG_APP_ID },
  ]
  let activeBase = BASES[0]

  for (let page = 0; collected.length < maxCount; page++) {
    const url = `${activeBase.base}/api/v1/friendships/${userId}/followers/?count=${PAGE_SIZE}${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`

    const resp = await sess.fetch(url, {
      headers: {
        'X-IG-App-ID': activeBase.appId,
        'Accept':      'application/json',
        'User-Agent':  USER_AGENT,
      },
    }).catch(() => null)

    if (!resp) {
      const msg = 'ネットワークエラー'
      console.warn(`[apiFetchFollowers] page=${page} ${msg}`)
      return collected.length > 0 ? { users: collected } : { users: [], error: msg }
    }

    // 最初のページで 400 なら別の base を試す
    if (!resp.ok && page === 0 && activeBase === BASES[0]) {
      console.warn(`[apiFetchFollowers] ${activeBase.base} → ${resp.status}, fallback to ${BASES[1].base}`)
      activeBase = BASES[1]
      continue
    }

    if (!resp.ok) {
      const msg = resp.status === 401
        ? '認証エラー: 再ログインが必要です'
        : resp.status === 429
          ? 'レート制限中。しばらく待ってから再試行してください'
          : `HTTP ${resp.status}`
      console.warn(`[apiFetchFollowers] page=${page} error: ${msg}`)
      return collected.length > 0 ? { users: collected } : { users: [], error: msg }
    }

    const text = await resp.text()
    let data: { users?: Array<{ pk?: string; username?: string }>; next_max_id?: string | null } = {}
    try { data = JSON.parse(text) } catch { /* ignore */ }
    const users = data?.users ?? []

    for (const u of users) {
      if (u.pk && u.username) collected.push({ pk: u.pk, username: u.username })
    }
    onProgress?.(collected.length)
    console.log(`[apiFetchFollowers] page=${page} got=${users.length} total=${collected.length}`)

    maxId = data?.next_max_id ?? null
    if (!maxId || users.length === 0) break

    // レート制限対策: ページ間 800ms 待機
    await new Promise(r => setTimeout(r, 800))
  }

  return { users: collected }
}

// ── Auto Reply API ────────────────────────────────────────────────────────────

const THREADS_URL_BASE = 'https://www.threads.com'
const THREADS_APP_ID   = '238260118697367'
const BROWSER_UA_REPLY = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

interface ThreadsPost {
  id:        string
  shortcode: string
  caption:   string
}

interface ReplyPost {
  id:       string
  username: string
  text:     string
}

/** GraphQL helper — lsd/fbDtsg を getApiTokens で正しく取得してから送信 */
async function threadsGraphQL(
  accountId: number,
  docId: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const tokens = await getApiTokens(accountId)
  if (!tokens) throw new Error(`[threadsGraphQL] no API tokens for account=${accountId}`)

  const sess = session.fromPartition(`persist:account-${accountId}`)

  const body = new URLSearchParams({
    av:                tokens.userId,
    __d:               'www',
    __user:            tokens.userId,
    __a:               '1',
    lsd:               tokens.lsd,
    fb_dtsg:           tokens.fbDtsg,
    doc_id:            docId,
    variables:         JSON.stringify(variables),
    server_timestamps: 'true',
  }).toString()

  const resp = await sess.fetch(`${THREADS_URL_BASE}/graphql/query`, {
    method: 'POST',
    headers: {
      'Content-Type':    'application/x-www-form-urlencoded',
      'X-IG-App-ID':     THREADS_APP_ID,
      'X-CSRFToken':     tokens.csrfToken,
      'X-FB-LSD':        tokens.lsd,
      'X-ASBD-ID':       '359341',
      'User-Agent':      getAccountById(accountId)?.use_unified_headers ? generateBrowserUA() : BROWSER_UA_REPLY,
      'Origin':          THREADS_URL_BASE,
      'Referer':         THREADS_URL_BASE + '/',
      'Accept-Encoding': 'identity',
      ...(getAccountById(accountId)?.use_unified_headers ? getUnifiedHeaders(accountId) : getHeadersPatternC(accountId)),
    },
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`GraphQL ${resp.status}: ${text.slice(0, 200)}`)
  }
  return resp.json()
}

export interface NotificationReply {
  notifId:      string  // 通知の一意ID（重複処理防止）
  mediaId:      string  // リプライのメディアID → apiReplyToPost の引数
  parentPostId: string  // 返信先の投稿ID
  username:     string  // リプライしたユーザー名
  content:      string  // リプライ本文
  timestamp:    number
}

/**
 * /activity ページの Relay ストアからリプライ通知を取得する。
 */
export async function apiFetchNotifications(accountId: number): Promise<NotificationReply[]> {
  const ready = await ensureViewLoaded(accountId)
  if (!ready) {
    console.warn(`[apiFetchNotifications] account=${accountId} view not ready`)
    return []
  }

  const result = await fetchNotificationsViaGraphQL(accountId)
  console.log(`[apiFetchNotifications] account=${accountId} ok=${result.ok}`)

  if (!result.ok || !result.data) return []

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = result.data as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notifications: any[] = json?.notifications ?? []

    const results: NotificationReply[] = []
    for (const n of notifications) {
      if (n?.iconName !== 'reply') continue
      const notifId   = n.notifId ?? ''
      const mediaId   = n.mediaId ?? ''
      const username  = n.username ?? ''
      const content   = n.content ?? ''
      const timestamp = n.timestamp ?? 0
      if (!mediaId) continue
      results.push({ notifId, mediaId, parentPostId: '', username, content, timestamp })
    }

    console.log(`[apiFetchNotifications] account=${accountId} found ${results.length} reply notifications`)
    return results
  } catch (e) {
    console.error('[apiFetchNotifications] parse error:', e)
    return []
  }
}

/** 指定投稿にリプライを投稿 */
export async function apiReplyToPost(
  accountId: number,
  replyToMediaId: string,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  // ── 投稿前ディレイ（bot検知回避）─────────────────────────────────────────────
  const preMs = await prePostDelay(accountId)
  const typeMs = await typingDelay(accountId, content)
  console.log(`[Delay] account=${accountId} prePost=${preMs}ms typing=${typeMs}ms (${content.length}chars)`)

  const sess = session.fromPartition(`persist:account-${accountId}`)
  const allCookies = await sess.cookies.get({}).catch(() => [])
  const csrftoken = allCookies.find(c => c.name === 'csrftoken' && c.domain?.includes('threads.com'))?.value
                 ?? allCookies.find(c => c.name === 'csrftoken')?.value ?? ''
  const sessionid = allCookies.find(c => c.name === 'sessionid' && c.domain?.includes('threads.com'))?.value
                 ?? allCookies.find(c => c.name === 'sessionid')?.value
  if (!sessionid) return { success: false, error: 'no session' }

  const uploadId = Date.now().toString()
  const selfId   = crypto.randomUUID()
  const appInfo  = JSON.stringify({
    community_flair_id: null,
    entry_point: 'main_tab_bar',
    excluded_inline_media_ids: '[]',
    fediverse_composer_enabled: true,
    is_reply_approval_enabled: false,
    is_spoiler_media: false,
    link_attachment_url: null,
    reply_control: 0,
    reply_id: replyToMediaId,
    self_thread_context_id: selfId,
    snippet_attachment: null,
    special_effects_enabled_str: null,
    tag_header: null,
    text_with_entities: { entities: [], text: content },
  })
  const body = new URLSearchParams({
    audience: 'default',
    barcelona_source_reply_id: replyToMediaId,
    caption:  content,
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
  }).toString()

  try {
    const resp = await sess.fetch(`${THREADS_URL_BASE}/api/v1/media/configure_text_only_post/`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/x-www-form-urlencoded',
        'X-CSRFToken':     csrftoken,
        'X-IG-App-ID':     THREADS_APP_ID,
        'X-ASBD-ID':       '129477',
        'User-Agent':      getAccountById(accountId)?.use_unified_headers ? generateBrowserUA() : BROWSER_UA_REPLY,
        'Origin':          THREADS_URL_BASE,
        'Referer':         THREADS_URL_BASE + '/',
        'Accept-Encoding': 'identity',
        ...(getAccountById(accountId)?.use_unified_headers ? getUnifiedHeaders(accountId) : getHeadersPatternC(accountId)),
      },
      body,
    })
    const text = await resp.text()
    console.log(`[apiReplyToPost] account=${accountId} replyTo=${replyToMediaId} status=${resp.status} body=${text.slice(0, 200)}`)
    if (!resp.ok) {
      analyzeAndLog(accountId, text)
      return { success: false, error: `status ${resp.status}: ${text.slice(0, 200)}` }
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
