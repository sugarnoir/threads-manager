/**
 * Threads 非公式 Web API クライアント
 *
 * Electron セッション (persist:account-N) に保存されたクッキーを
 * useSessionCookies: true で自動送信し Threads GraphQL API を叩く。
 *
 * fbDtsg 取得優先順位:
 *   1. ロード済み WebContentsView から JS で直接取得（最も確実）
 *   2. session + useSessionCookies でホームページHTMLをスクレイプ
 */

import { net, session, Session } from 'electron'
import { getSetting, setSetting }       from '../db/repositories/settings'
import { getAccountById }               from '../db/repositories/accounts'
import { extractPageApiTokens, fetchViaView, autoPostViaUI, restPostTextViaView, restPostMediaViaView, configureSidecarViaView, ensureViewLoaded } from '../browser-views/view-manager'
import { IPHONE_UA_LIST }               from '../utils/iphone-ua'
import fs from 'fs'

const THREADS_URL  = 'https://www.threads.com'
const IG_APP_ID    = '238260118697367'
const TOKEN_TTL_MS = 25 * 60 * 1000
const BROWSER_UA   = 'Instagram 279.0.0.21.117 (iPhone14,3; iOS 16_0; ja_JP; ja-JP; scale=3.00; 1284x2778; 463060794)'

const CREATE_TEXT_DOC_IDS = [
  '7783822248314888',
  '24513024604657049',
  '6234100523339054',
  '9423847487736922',
]

// ── Result types ─────────────────────────────────────────────────────────────

export interface ApiPostResult {
  success: boolean
  error?:  string
}

// ── Token cache ───────────────────────────────────────────────────────────────

interface ApiTokens {
  userId:    string
  csrfToken: string
  lsd:       string
  fbDtsg:    string
  savedAt:   number
}

// ── Session helpers ───────────────────────────────────────────────────────────

function getAccountSession(accountId: number): Session {
  return session.fromPartition(`persist:account-${accountId}`)
}

async function getSessionInfo(accountId: number): Promise<{
  sess:       Session
  hasSession: boolean
  csrfToken:  string
  userId:     string
} | null> {
  const sess = getAccountSession(accountId)
  const all  = await sess.cookies.get({}).catch(() => [])

  const threads = all.filter(c => c.domain?.includes('threads.com'))
  const ig      = all.filter(c => c.domain?.includes('instagram.com'))

  console.log(`[WebAPI] account=${accountId} threads_cookies=${threads.length} ig_cookies=${ig.length}`)
  console.log(`[WebAPI] threads.com names: ${threads.map(c => c.name).join(', ')}`)
  console.log(`[WebAPI] instagram.com names: ${ig.map(c => c.name).join(', ')}`)

  const hasSession = threads.some(c => c.name === 'sessionid' && c.value)
                  || ig.some(c => c.name === 'sessionid' && c.value)
  if (!hasSession) {
    console.warn(`[WebAPI] account=${accountId}: no sessionid cookie`)
    return null
  }

  // threads.com のクッキーを優先
  const csrfToken = threads.find(c => c.name === 'csrftoken')?.value
                 ?? ig.find(c => c.name === 'csrftoken')?.value ?? ''
  const userId    = threads.find(c => c.name === 'ds_user_id')?.value
                 ?? ig.find(c => c.name === 'ds_user_id')?.value ?? ''

  console.log(`[WebAPI] csrfToken=${csrfToken.slice(0, 8)}… userId=${userId}`)
  return { sess, hasSession, csrfToken, userId }
}

// ── Token refresh ─────────────────────────────────────────────────────────────

export async function getApiTokens(accountId: number): Promise<ApiTokens | null> {
  const raw = getSetting(`threads_api_tokens_${accountId}`)
  if (raw) {
    try {
      const t: ApiTokens = JSON.parse(raw)
      if (Date.now() - t.savedAt < TOKEN_TTL_MS && t.userId && t.csrfToken) return t
    } catch { /* stale */ }
  }
  return refreshApiTokens(accountId)
}

async function refreshApiTokens(accountId: number): Promise<ApiTokens | null> {
  const info = await getSessionInfo(accountId)
  if (!info) return null

  // ── fbDtsg / lsd 取得 ────────────────────────────────────────────────────
  let lsd = '', fbDtsg = ''

  // 1. WebContentsView が開いていれば JS コンテキストから直接取得
  const viewTokens = await extractPageApiTokens(accountId).catch(() => null)
  if (viewTokens?.fbDtsg) {
    lsd    = viewTokens.lsd
    fbDtsg = viewTokens.fbDtsg
    console.log(`[WebAPI] tokens via WebContentsView: lsd=${lsd || '(EMPTY)'} fbDtsg=${fbDtsg || '(EMPTY)'}`)
  } else {
    // 2. session + useSessionCookies でホームページHTMLから取得
    const scraped = await scrapePageTokens(info.sess)
    lsd    = scraped.lsd
    fbDtsg = scraped.fbDtsg
    console.log(`[WebAPI] scrape: status=${scraped.status} htmlLen=${scraped.htmlLen}`)
    console.log(`[WebAPI] scrape: lsd=${lsd || '(EMPTY)'} fbDtsg=${fbDtsg || '(EMPTY)'}`)
    console.log(`[WebAPI] scrape htmlSnippet: ${scraped.htmlSnippet.slice(0, 500)}`)
  }

  const tokens: ApiTokens = {
    userId: info.userId, csrfToken: info.csrfToken, lsd, fbDtsg, savedAt: Date.now(),
  }
  setSetting(`threads_api_tokens_${accountId}`, JSON.stringify(tokens))
  return tokens
}

function scrapePageTokens(sess: Session): Promise<{
  lsd: string; fbDtsg: string; htmlLen: number; status: number; htmlSnippet: string
}> {
  return new Promise((resolve) => {
    // session + useSessionCookies: true で threads.com のセッションクッキーを自動送信
    const req = net.request({
      method:           'GET',
      url:              THREADS_URL + '/',
      session:          sess,
      useSessionCookies: true,
    })
    req.setHeader('User-Agent',                 BROWSER_UA)
    req.setHeader('Accept',                     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
    req.setHeader('Accept-Language',            'ja,en-US;q=0.9,en;q=0.8')
    req.setHeader('Accept-Encoding',            'identity')
    req.setHeader('Upgrade-Insecure-Requests',  '1')

    let html = '', status = 0
    req.on('response', (resp) => {
      status = resp.statusCode
      console.log(`[WebAPI] scrapePageTokens status=${status}`)
      resp.on('data',  chunk => { html += chunk.toString() })
      resp.on('end', () => {
        const lsdMatch =
          html.match(/"LSD",\[\],\{"token":"([^"]+)"/)         ||
          html.match(/\["LSD",\[\],\{"token":"([^"]+)"/)       ||
          html.match(/"lsd":"([^"]+)"/)

        const dtsgMatch =
          html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)  ||
          html.match(/"DTSGInitData",\[\],\{"token":"([^"]+)"/)     ||
          html.match(/"fb_dtsg":"([^"]+)"/)                          ||
          html.match(/"token":"(AQ[^"]+)"/)

        resolve({
          lsd:         lsdMatch?.[1]  ?? '',
          fbDtsg:      dtsgMatch?.[1] ?? '',
          htmlLen:     html.length,
          status,
          htmlSnippet: html.slice(0, 3000),
        })
      })
    })
    req.on('error', (e) => {
      console.error(`[WebAPI] scrapePageTokens error: ${e.message}`)
      resolve({ lsd: '', fbDtsg: '', htmlLen: 0, status: 0, htmlSnippet: '' })
    })
    req.end()
  })
}

function clearTokenCache(accountId: number): void {
  setSetting(`threads_api_tokens_${accountId}`, '')
}

// ── REST via net.request + useSessionCookies ──────────────────────────────────

/**
 * useSessionCookies: true で net.request を使い REST エンドポイントへ POST する。
 * fetchViaView と異なりビューが開いていなくても動作する。
 */
function doRestPost(opts: {
  sess:    Session
  url:     string
  headers: Record<string, string>
  body:    string | Buffer
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = net.request({
      method:            'POST',
      url:               opts.url,
      session:           opts.sess,
      useSessionCookies: true,
    })
    for (const [k, v] of Object.entries(opts.headers)) req.setHeader(k, v)
    let body = ''
    req.on('response', (resp) => {
      resp.on('data', chunk => { body += chunk.toString() })
      resp.on('end',  () => resolve({ status: resp.statusCode, body }))
    })
    req.on('error', reject)
    req.write(opts.body)
    req.end()
  })
}

async function restPostTextViaNet(
  accountId: number,
  text:      string,
  topic?:    string
): Promise<ApiPostResult | null> {
  const info = await getSessionInfo(accountId)
  if (!info) return null

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
    self_thread_context_id: selfId,
    snippet_attachment: null,
    special_effects_enabled_str: null,
    tag_header: topic ? { display_text: topic } : null,
    text_with_entities: { entities: [], text },
  })
  const body = new URLSearchParams({
    audience: 'default',
    barcelona_source_reply_id: '',
    caption:  text,
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

  console.log(`[WebAPI] restPostTextViaNet account=${accountId} topic=${JSON.stringify(topic ?? null)} tag_header=${JSON.stringify(topic ? { display_text: topic } : null)}`)
  try {
    const resp = await doRestPost({
      sess:    info.sess,
      url:     `${THREADS_URL}/api/v1/media/configure_text_only_post/`,
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'x-csrftoken':   info.csrfToken,
        'x-ig-app-id':   IG_APP_ID,
        'x-asbd-id':     '129477',
        'Origin':        THREADS_URL,
        'Referer':       THREADS_URL + '/',
        'User-Agent':    BROWSER_UA,
        'Accept':        '*/*',
        'Accept-Encoding': 'identity',
      },
      body,
    })
    console.log(`[WebAPI] restPostTextViaNet status=${resp.status} body=${resp.body.slice(0, 500)}`)
    if (resp.status !== 200) {
      return { success: false, error: `REST net status=${resp.status}: ${resp.body.slice(0, 200)}` }
    }
    const json = JSON.parse(resp.body) as Record<string, unknown>
    if ((json.status as string) === 'ok' || json.media_id || json.media) {
      return { success: true }
    }
    return { success: false, error: JSON.stringify(json).slice(0, 200) }
  } catch (e) {
    console.error(`[WebAPI] restPostTextViaNet error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

async function restPostMediaViaNet(
  accountId:  number,
  text:       string,
  imagePaths: string[],
  topic?:     string
): Promise<ApiPostResult | null> {
  const info = await getSessionInfo(accountId)
  if (!info) return null

  // ── 各画像をアップロード ─────────────────────────────────────────────────
  const isSidecar      = imagePaths.filter(p => fs.existsSync(p)).length > 1
  const clientSidecarId = isSidecar ? Date.now().toString() : ''
  const uploadIds: string[] = []
  for (const imgPath of imagePaths) {
    if (!fs.existsSync(imgPath)) continue
    await new Promise(r => setTimeout(r, 200))          // 連続アップロードの間隔
    const uploadId = Date.now().toString()
    uploadIds.push(uploadId)
    const fileData = fs.readFileSync(imgPath)
    const mime     = imgPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
    const ruploadParams: Record<string, unknown> = { media_type: 1, upload_id: uploadId }
    if (isSidecar) { ruploadParams.is_sidecar = '1'; ruploadParams.client_sidecar_id = clientSidecarId }

    console.log(`[WebAPI] restPostMediaViaNet upload account=${accountId} uploadId=${uploadId} sidecar=${isSidecar}`)
    const upResp = await doPost({
      url:       `${THREADS_URL}/rupload_igphoto/fb_uploader_${uploadId}`,
      headers: {
        'x-entity-type':              mime,
        'x-entity-length':            String(fileData.length),
        'x-entity-name':              `fb_uploader_${uploadId}`,
        'x-instagram-rupload-params': JSON.stringify(ruploadParams),
        'offset':                     '0',
        'Content-Type':               'application/octet-stream',
        'x-csrftoken':                info.csrfToken,
        'x-ig-app-id':                IG_APP_ID,
        'x-asbd-id':                  '129477',
        'Origin':                     THREADS_URL,
        'Referer':                    THREADS_URL + '/',
        'User-Agent':                 BROWSER_UA,
        'Accept-Encoding':            'identity',
      },
      body:      fileData,
      accountId,
    }).catch((e) => { console.warn(`[WebAPI] restPostMediaViaNet upload exception: ${e?.message}`); return null })

    if (!upResp || upResp.status !== 200) {
      console.warn(`[WebAPI] restPostMediaViaNet upload failed status=${upResp?.status} body=${upResp?.body?.slice(0, 200)}`)
      return null
    }
    // サーバーが返す upload_id があればそちらを使う
    try {
      const upJson = JSON.parse(upResp.body) as Record<string, unknown>
      if (upJson.upload_id) uploadIds[uploadIds.length - 1] = String(upJson.upload_id)
    } catch { /* ignore */ }
    console.log(`[WebAPI] restPostMediaViaNet upload ok uploadId=${uploadIds[uploadIds.length - 1]}`)
  }

  if (uploadIds.length === 0) return null

  // ── configure ─────────────────────────────────────────────────────────────
  const selfId  = crypto.randomUUID()
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
    tag_header: topic ? { display_text: topic } : null,
    text_with_entities: { entities: [], text },
  })

  let cfgUrl: string
  let cfgContentType: string
  let cfgBody: string

  if (uploadIds.length === 1) {
    // ── 1枚: configure_text_post_app_feed (URL-encoded) ─────────────────────
    cfgUrl         = `${THREADS_URL}/api/v1/media/configure_text_post_app_feed/`
    cfgContentType = 'application/x-www-form-urlencoded'
    cfgBody        = new URLSearchParams({
      audience: 'default',
      barcelona_source_reply_id: '',
      caption:  text,
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
    }).toString()
  } else {
    // ── 複数枚: configure_text_post_app_sidecar (JSON) ───────────────────────
    cfgUrl         = `${THREADS_URL}/api/v1/media/configure_text_post_app_sidecar/`
    cfgContentType = 'application/json'
    cfgBody        = JSON.stringify({
      audience: 'default',
      barcelona_source_reply_id: '',
      caption:  text,
      children_metadata: uploadIds.map(uid => ({
        upload_id: uid,
        scene_type: null,
        scene_capture_type: '',
      })),
      client_sidecar_id: clientSidecarId,
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
    })
  }

  const cfgHeaders: Record<string, string> = {
    'Content-Type':    isSidecar ? 'text/plain;charset=UTF-8' : cfgContentType,
    'x-csrftoken':     info.csrfToken,
    'x-ig-app-id':     IG_APP_ID,
    'x-asbd-id':       isSidecar ? '359341' : '129477',
    'Origin':          THREADS_URL,
    'Referer':         THREADS_URL + '/',
    'User-Agent':      BROWSER_UA,
    'Accept':          '*/*',
    'Accept-Encoding': 'identity',
  }
  if (isSidecar) {
    cfgHeaders['x-instagram-ajax']   = '0'
    cfgHeaders['x-bloks-version-id'] = '86eaac606b7c5e9b45f4357f86082d05eace8411e43d3f754d885bf54a759a71'
  }
  console.log(`[CFG_DEBUG] ===== configure request =====`)
  console.log(`[CFG_DEBUG] URL: ${cfgUrl}`)
  console.log(`[CFG_DEBUG] upload_ids: ${JSON.stringify(uploadIds)}`)
  console.log(`[CFG_DEBUG] body: ${cfgBody}`)
  console.log(`[CFG_DEBUG] =============================`)
  try {
    // サイドカー（複数枚）はWebContentsViewのJS fetchで認証Cookieを自動送信する
    if (isSidecar) {
      const viewResp = await configureSidecarViaView({
        accountId,
        text,
        uploadIds,
        clientSidecarId,
        topic,
      })
      if (!viewResp) {
        console.warn(`[WebAPI] configureSidecarViaView returned null → fallback to doRestPost`)
        // Viewがない場合: useSessionCookiesで再試行
        const restResp = await doRestPost({
          sess:    info.sess,
          url:     cfgUrl,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'x-csrftoken': info.csrfToken, 'x-ig-app-id': IG_APP_ID, 'x-asbd-id': '359341', 'x-instagram-ajax': '0', 'x-bloks-version-id': '86eaac606b7c5e9b45f4357f86082d05eace8411e43d3f754d885bf54a759a71', 'Origin': THREADS_URL, 'Referer': THREADS_URL + '/' },
          body:    cfgBody,
        })
        console.log(`[WebAPI] doRestPost sidecar status=${restResp.status} body=${restResp.body}`)
        if (restResp.status !== 200) {
          return { success: false, error: `sidecar doRestPost status=${restResp.status}: ${restResp.body.slice(0, 200)}` }
        }
        const rj = JSON.parse(restResp.body) as Record<string, unknown>
        if ((rj.status as string) === 'ok' || rj.media_id || rj.media) return { success: true }
        return { success: false, error: JSON.stringify(rj).slice(0, 200) }
      } else {
        console.log(`[WebAPI] configureSidecarViaView status=${viewResp.status} body=${viewResp.body.slice(0, 300)}`)
        if (viewResp.status !== 200) {
          return { success: false, error: `sidecar view status=${viewResp.status}: ${viewResp.body.slice(0, 200)}` }
        }
        const json = JSON.parse(viewResp.body) as Record<string, unknown>
        if ((json.status as string) === 'ok' || json.media_id || json.media) {
          return { success: true }
        }
        return { success: false, error: JSON.stringify(json).slice(0, 200) }
      }
    }

    const resp = await doPost({
      url:       cfgUrl,
      headers:   cfgHeaders,
      body:      cfgBody,
      accountId,
    })
    console.log(`[WebAPI] restPostMediaViaNet configure status=${resp.status} body=${resp.body}`)
    if (resp.status !== 200) {
      return { success: false, error: `REST media net status=${resp.status}: ${resp.body.slice(0, 200)}` }
    }
    const json = JSON.parse(resp.body) as Record<string, unknown>
    if ((json.status as string) === 'ok' || json.media_id || json.media) {
      return { success: true }
    }
    return { success: false, error: JSON.stringify(json).slice(0, 200) }
  } catch (e) {
    console.error(`[WebAPI] restPostMediaViaNet error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

function parseJson(raw: string): unknown {
  const stripped = raw.startsWith('for (;;);') ? raw.slice('for (;;);'.length) : raw
  return JSON.parse(stripped)
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function doPost(opts: {
  url:       string
  headers:   Record<string, string>
  body:      string | Buffer
  accountId: number
}): Promise<{ status: number; body: string }> {
  // threads.com クッキーのみ取得（instagram.com との重複 sessionid を避ける）
  // 手動 Cookie ヘッダーで設定することで SameSite 制限をバイパスする
  const sess = getAccountSession(opts.accountId)
  const allCookies  = await sess.cookies.get({}).catch(() => [])
  // threads.com クッキーを優先し、同名クッキーが instagram.com にもある場合は除外する
  // （sessionid が2つになると、サーバーが instagram.com の無効な方を使うため）
  const threadsCookies = allCookies.filter(c => c.domain?.includes('threads.com'))
  const threadsNames   = new Set(threadsCookies.map(c => c.name))
  const igOnlyCookies  = allCookies.filter(
    c => c.domain?.includes('instagram.com') && !threadsNames.has(c.name)
  )
  const combined     = [...threadsCookies, ...igOnlyCookies]
  const cookieHeader = combined.map(c => `${c.name}=${c.value}`).join('; ')

  console.log(`[WebAPI] doPost threads=${threadsCookies.length} ig_only=${igOnlyCookies.length} total=${combined.length} cookieLen=${cookieHeader.length}`)
  console.log(`[WebAPI] doPost cookie names: ${combined.map(c => c.name).join(', ')}`)

  return new Promise((resolve, reject) => {
    // session/useSessionCookies は使わず Cookie ヘッダーを手動設定
    const req = net.request({ method: 'POST', url: opts.url })
    req.setHeader('Cookie', cookieHeader)
    for (const [k, v] of Object.entries(opts.headers)) req.setHeader(k, v)
    let body = ''
    req.on('response', (resp) => {
      resp.on('data',  chunk => { body += chunk.toString() })
      resp.on('end',   () => resolve({ status: resp.statusCode, body }))
    })
    req.on('error', reject)
    req.write(opts.body)
    req.end()
  })
}

// ── GET helper ────────────────────────────────────────────────────────────────

async function doGet(opts: {
  url:       string
  headers:   Record<string, string>
  accountId: number
}): Promise<{ status: number; body: string }> {
  const sess = getAccountSession(opts.accountId)
  const allCookies     = await sess.cookies.get({}).catch(() => [])
  const threadsCookies = allCookies.filter(c => c.domain?.includes('threads.com'))
  const threadsNames   = new Set(threadsCookies.map(c => c.name))
  const igOnlyCookies  = allCookies.filter(
    c => c.domain?.includes('instagram.com') && !threadsNames.has(c.name)
  )
  const combined     = [...threadsCookies, ...igOnlyCookies]
  const cookieHeader = combined.map(c => `${c.name}=${c.value}`).join('; ')

  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url: opts.url })
    req.setHeader('Cookie', cookieHeader)
    for (const [k, v] of Object.entries(opts.headers)) req.setHeader(k, v)
    let body = ''
    req.on('response', (resp) => {
      resp.on('data',  chunk => { body += chunk.toString() })
      resp.on('end',   () => resolve({ status: resp.statusCode, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

// ── Follower count ─────────────────────────────────────────────────────────────

export async function fetchFollowerCount(accountId: number): Promise<number | null> {
  try {
    const info = await getSessionInfo(accountId)
    if (!info || !info.userId) {
      console.warn(`[fetchFollowerCount] account=${accountId}: no session info`)
      return null
    }

    const resp = await doGet({
      url: `${THREADS_URL}/api/v1/users/${info.userId}/info/`,
      headers: {
        'X-IG-App-ID':     IG_APP_ID,
        'X-CSRFToken':     info.csrfToken,
        'Accept':          'application/json',
        'Accept-Encoding': 'identity',
        'User-Agent':      BROWSER_UA,
        'Referer':         THREADS_URL + '/',
      },
      accountId,
    })

    if (resp.status !== 200) {
      console.warn(`[fetchFollowerCount] account=${accountId}: status=${resp.status}`)
      return null
    }

    const json = JSON.parse(resp.body) as Record<string, unknown>
    const user = json.user as Record<string, unknown> | undefined
    if (typeof user?.follower_count === 'number') {
      console.log(`[fetchFollowerCount] account=${accountId} follower_count=${user.follower_count}`)
      return user.follower_count
    }

    console.warn(`[fetchFollowerCount] account=${accountId}: follower_count not in response`)
    return null
  } catch (e) {
    console.error(`[fetchFollowerCount] account=${accountId} error:`, e)
    return null
  }
}

// ── GraphQL response parser ───────────────────────────────────────────────────

function parseGraphqlResponse(
  resp: { status: number; body: string }
): { ok: boolean; data?: unknown; errorMsg?: string; authError?: boolean } {
  if (resp.status === 401 || resp.status === 302) return { ok: false, authError: true }
  if (!resp.body.trim()) return { ok: false, errorMsg: 'empty response body' }

  let json: Record<string, unknown>
  try {
    json = parseJson(resp.body) as Record<string, unknown>
  } catch (e) {
    console.error(`[WebAPI] JSON parse error: ${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, errorMsg: `JSON parse: ${e instanceof Error ? e.message : String(e)}` }
  }

  console.log(`[WebAPI] parsed json keys: ${Object.keys(json).join(', ')}`)

  if (typeof json.error === 'number') {
    const summary = String(json.errorSummary ?? json.errorDescription ?? json.error)
    console.warn(`[WebAPI] meta error ${json.error}: ${summary}`)
    if (json.error === 1357001) return { ok: false, authError: true }
    return { ok: false, errorMsg: `${json.error}: ${summary}` }
  }

  const errs = json.errors
  if (Array.isArray(errs) && errs.length > 0) {
    const msg = (errs as Array<{ message?: string }>)[0]?.message ?? JSON.stringify(errs[0])
    console.warn(`[WebAPI] graphql errors[0]: ${msg}`)
    if (/doc_id|not found|invalid/i.test(msg)) return { ok: false, errorMsg: 'invalid_doc_id' }
    return { ok: false, errorMsg: msg }
  }
  if (errs && !Array.isArray(errs)) {
    const msg = JSON.stringify(errs)
    console.warn(`[WebAPI] graphql errors (obj): ${msg}`)
    if (/doc_id|not found|invalid/i.test(msg)) return { ok: false, errorMsg: 'invalid_doc_id' }
    return { ok: false, errorMsg: msg }
  }

  if (json.data) {
    console.log(`[WebAPI] ✓ success data keys: ${Object.keys(json.data as object).join(', ')}`)
    return { ok: true, data: json.data }
  }

  console.warn(`[WebAPI] no data field. full json: ${JSON.stringify(json).slice(0, 500)}`)
  return { ok: false, errorMsg: 'empty response' }
}

// ── GraphQL post helper ───────────────────────────────────────────────────────

async function graphqlPost(
  accountId: number,
  tokens:    ApiTokens,
  docId:     string,
  variables: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; errorMsg?: string; authError?: boolean }> {
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

  const headers: Record<string, string> = {
    'Content-Type':    'application/x-www-form-urlencoded',
    'X-CSRFToken':     tokens.csrfToken,
    'X-FB-LSD':        tokens.lsd,
    'X-IG-App-ID':     IG_APP_ID,
    'X-Asbd-Id':       '129477',
    'Accept':          '*/*',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  }

  console.log(`[WebAPI] graphqlPost account=${accountId} doc_id=${docId}`)
  console.log(`[WebAPI] userId=${tokens.userId} lsd=${tokens.lsd.slice(0, 10) || '(empty)'}… fbDtsg=${tokens.fbDtsg.slice(0, 10) || '(empty)'}…`)
  console.log(`[WebAPI] csrfToken=${tokens.csrfToken.slice(0, 8) || '(empty)'}…`)

  // ── 経路1: WebContentsView の fetch() 経由（同一オリジン・SameSite Cookie 制限なし）
  const viewResp = await fetchViaView(accountId, '/api/graphql', headers, body)
  if (viewResp) {
    console.log(`[WebAPI] via=WebContentsView status=${viewResp.status} body_len=${viewResp.body.length}`)
    console.log(`[WebAPI] response body: ${viewResp.body.slice(0, 2000)}`)
    return parseGraphqlResponse(viewResp)
  }

  // ── 経路2: net.request + useSessionCookies（ビュー未開放時フォールバック）
  console.log(`[WebAPI] via=net.request (view not available)`)
  const netHeaders = {
    ...headers,
    'Origin':                        THREADS_URL,
    'Referer':                       THREADS_URL + '/',
    'User-Agent':                    BROWSER_UA,
    'Accept-Encoding':               'identity',
    'X-IG-Connection-Type':          'WIFI',
    'X-IG-Bandwidth-Speed-KBPS':     '5000',
    'X-IG-Bandwidth-TotalBytes-B':   '500000',
  }
  console.log(`[WebAPI] request body (300): ${body.slice(0, 300)}`)

  try {
    const resp = await doPost({ url: `${THREADS_URL}/api/graphql`, headers: netHeaders, body, accountId })
    console.log(`[WebAPI] net.request response status=${resp.status} body_len=${resp.body.length}`)
    console.log(`[WebAPI] response body: ${resp.body.slice(0, 2000)}`)
    return parseGraphqlResponse(resp)
  } catch (e) {
    console.error(`[WebAPI] graphqlPost exception: ${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, errorMsg: e instanceof Error ? e.message : String(e) }
  }
}

// ── Mobile API helpers (i.instagram.com) ─────────────────────────────────────

const IG_MOBILE_URL    = 'https://i.instagram.com'
const IG_MOBILE_APP_ID = '238260118697367'  // Threads app ID (text_app)
const IG_MOBILE_UA     = 'Barcelona 289.0.0.77.109 Android (33/13; 440dpi; 1080x2194; samsung; SM-G991B; o1s; exynos2100; ja_JP; 463060794)'

/** アカウントに割り当てられた iPhone UA を返す。未設定の場合はリストから決定論的に選択 */
function getAccountIphoneUA(accountId: number): string {
  const account = getAccountById(accountId)
  if (account?.user_agent) return account.user_agent
  // フォールバック: account_id をシードにリストから選択（一貫性を保つ）
  return IPHONE_UA_LIST[accountId % IPHONE_UA_LIST.length]
}

/** instagram.com セッションクッキーを取得する。sessionid がなければ null を返す */
async function getIgCookieHeaders(accountId: number): Promise<{ cookieHeader: string; csrfToken: string } | null> {
  const sess = session.fromPartition(`persist:account-${accountId}`)
  const all  = await sess.cookies.get({}).catch(() => [])
  const ig   = all.filter(c => c.domain?.includes('instagram.com'))
  if (!ig.find(c => c.name === 'sessionid')?.value) return null
  return {
    cookieHeader: ig.map(c => `${c.name}=${c.value}`).join('; '),
    csrfToken:    ig.find(c => c.name === 'csrftoken')?.value ?? '',
  }
}

/** net.request ラッパー（バイナリ / 文字列どちらも対応） */
function mobileNetRequest(
  method:  'POST',
  url:     string,
  headers: Record<string, string>,
  body:    Buffer | string,
): Promise<{ ok: boolean; status: number; raw: string }> {
  return new Promise((resolve) => {
    const req = net.request({ method, url })
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)
    let raw = ''
    req.on('response', (resp) => {
      resp.on('data', c => { raw += c.toString() })
      resp.on('end', () => resolve({ ok: resp.statusCode >= 200 && resp.statusCode < 300, status: resp.statusCode, raw }))
    })
    req.on('error', e => resolve({ ok: false, status: 0, raw: e instanceof Error ? e.message : String(e) }))
    if (Buffer.isBuffer(body)) req.write(body)
    else if (body) req.write(body)
    req.end()
  })
}

async function mobilePostText(
  accountId: number,
  text: string,
  topic?: string,
): Promise<{ success: boolean; status?: number; error?: string }> {
  const ig = await getIgCookieHeaders(accountId)
  if (!ig) {
    console.warn(`[mobilePostText] account=${accountId}: no instagram.com sessionid`)
    return { success: false, error: 'instagram.com sessionid not found' }
  }
  const { cookieHeader, csrfToken } = ig

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
    reply_id: null,
    self_thread_context_id: selfId,
    snippet_attachment: null,
    special_effects_enabled_str: null,
    tag_header: topic ? { display_text: topic } : null,
    text_with_entities: { entities: [], text },
  })

  const body = new URLSearchParams({
    audience: 'default',
    caption: text,
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

  const result = await mobileNetRequest(
    'POST',
    `${IG_MOBILE_URL}/api/v1/media/configure_text_only_post/`,
    {
      'Cookie':       cookieHeader,
      'X-CSRFToken':  csrfToken,
      'X-IG-App-ID':  IG_MOBILE_APP_ID,
      'User-Agent':   getAccountIphoneUA(accountId),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin':       'https://www.instagram.com',
      'Referer':      'https://www.instagram.com/',
    },
    body,
  )
  console.log(`[mobilePostText] account=${accountId} status=${result.status} body=${result.raw.slice(0, 400)}`)
  return result.ok
    ? { success: true, status: result.status }
    : { success: false, status: result.status, error: result.raw.slice(0, 300) }
}

// ── Mobile Post with Media (i.instagram.com) ─────────────────────────────────

async function mobilePostWithMedia(
  accountId:  number,
  text:       string,
  imagePaths: string[],
  topic?:     string,
): Promise<{ success: boolean; status?: number; error?: string }> {
  const ig = await getIgCookieHeaders(accountId)
  if (!ig) {
    console.warn(`[mobilePostWithMedia] account=${accountId}: no instagram.com sessionid`)
    return { success: false, error: 'instagram.com sessionid not found' }
  }
  const { cookieHeader, csrfToken: igCsrfToken } = ig

  const baseHeaders: Record<string, string> = {
    'Cookie':       cookieHeader,
    'X-CSRFToken':  igCsrfToken,
    'X-IG-App-ID':  IG_MOBILE_APP_ID,
    'User-Agent':   getAccountIphoneUA(accountId),
    'Origin':       'https://www.instagram.com',
    'Referer':      'https://www.instagram.com/',
  }

  // threads.com の csrfToken を取得（アップロードに使用）
  const sessInfo = await getSessionInfo(accountId)
  const threadsCsrf = sessInfo?.csrfToken ?? igCsrfToken

  // ── 各画像をアップロード（threads.com セッションを使用）────────────────────
  const isSidecar       = imagePaths.length > 1
  const clientSidecarId = isSidecar ? Date.now().toString() : ''
  const uploadIds: string[] = []

  for (const imgPath of imagePaths) {
    if (!fs.existsSync(imgPath)) continue
    await new Promise(r => setTimeout(r, 200))
    const uploadId  = Date.now().toString()
    const fileData  = fs.readFileSync(imgPath)
    const mime      = imgPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
    const ruploadParams: Record<string, unknown> = { media_type: 1, upload_id: uploadId }
    if (isSidecar) { ruploadParams.is_sidecar = '1'; ruploadParams.client_sidecar_id = clientSidecarId }

    // アップロードは threads.com セッションの doPost を使用（i.instagram.com は認証エラーになるため）
    const upResp = await doPost({
      url: `${THREADS_URL}/rupload_igphoto/fb_uploader_${uploadId}`,
      headers: {
        'x-entity-type':              mime,
        'x-entity-length':            String(fileData.length),
        'x-entity-name':              `fb_uploader_${uploadId}`,
        'x-instagram-rupload-params': JSON.stringify(ruploadParams),
        'offset':                     '0',
        'Content-Type':               'application/octet-stream',
        'x-csrftoken':                threadsCsrf,
        'x-ig-app-id':                IG_MOBILE_APP_ID,
        'Origin':                     THREADS_URL,
        'Referer':                    THREADS_URL + '/',
        'User-Agent':                 getAccountIphoneUA(accountId),
        'Accept-Encoding':            'identity',
      },
      body:      fileData,
      accountId,
    }).catch(() => null)

    console.log(`[mobilePostWithMedia] upload uploadId=${uploadId} status=${upResp?.status} body=${upResp?.body?.slice(0, 200)}`)
    if (!upResp || upResp.status !== 200) return { success: false, status: upResp?.status, error: `upload failed: ${upResp?.body?.slice(0, 200)}` }

    try {
      const upJson = JSON.parse(upResp.body) as Record<string, unknown>
      uploadIds.push(upJson.upload_id ? String(upJson.upload_id) : uploadId)
    } catch { uploadIds.push(uploadId) }
  }

  if (uploadIds.length === 0) return { success: false, error: 'no images uploaded' }

  // ── configure ──────────────────────────────────────────────────────────────
  const selfId  = crypto.randomUUID()
  const appInfo = JSON.stringify({
    community_flair_id: null,
    entry_point: 'main_tab_bar',
    excluded_inline_media_ids: '[]',
    fediverse_composer_enabled: true,
    is_reply_approval_enabled: false,
    is_spoiler_media: false,
    link_attachment_url: null,
    reply_control: 0,
    reply_id: null,
    self_thread_context_id: selfId,
    snippet_attachment: null,
    special_effects_enabled_str: null,
    tag_header: topic ? { display_text: topic } : null,
    text_with_entities: { entities: [], text },
  })

  let cfgUrl: string
  let cfgBody: string
  let cfgContentType: string

  // configure は threads.com セッション経由（i.instagram.com は login_required になるため）
  if (uploadIds.length === 1) {
    cfgUrl         = `${THREADS_URL}/api/v1/media/configure_text_post_app_feed/`
    cfgContentType = 'application/x-www-form-urlencoded'
    cfgBody        = new URLSearchParams({
      audience: 'default',
      barcelona_source_reply_id: '',
      caption:  text,
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
    }).toString()
  } else {
    cfgUrl         = `${THREADS_URL}/api/v1/media/configure_text_post_app_sidecar/`
    cfgContentType = 'application/json'
    cfgBody        = JSON.stringify({
      audience: 'default',
      barcelona_source_reply_id: '',
      caption:  text,
      children_metadata: uploadIds.map(uid => ({ upload_id: uid, scene_type: null, scene_capture_type: '' })),
      client_sidecar_id: clientSidecarId,
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
    })
  }

  const cfgHeaders: Record<string, string> = {
    'Content-Type':    isSidecar ? 'text/plain;charset=UTF-8' : cfgContentType,
    'x-csrftoken':     threadsCsrf,
    'x-ig-app-id':     IG_MOBILE_APP_ID,
    'x-asbd-id':       isSidecar ? '359341' : '129477',
    'Origin':          THREADS_URL,
    'Referer':         THREADS_URL + '/',
    'User-Agent':      getAccountIphoneUA(accountId),
    'Accept-Encoding': 'identity',
  }
  if (isSidecar) {
    cfgHeaders['x-instagram-ajax']   = '0'
    cfgHeaders['x-bloks-version-id'] = '86eaac606b7c5e9b45f4357f86082d05eace8411e43d3f754d885bf54a759a71'
  }

  const cfgResp = await doPost({
    url:       cfgUrl,
    headers:   cfgHeaders,
    body:      cfgBody,
    accountId,
  }).catch(() => null)

  console.log(`[mobilePostWithMedia] configure status=${cfgResp?.status} body=${cfgResp?.body?.slice(0, 300)}`)
  if (!cfgResp || cfgResp.status !== 200) return { success: false, status: cfgResp?.status, error: cfgResp?.body?.slice(0, 300) }

  try {
    const json = JSON.parse(cfgResp.body) as Record<string, unknown>
    if ((json.status as string) === 'ok' || json.media_id || json.media) return { success: true }
    return { success: false, status: cfgResp.status, error: JSON.stringify(json).slice(0, 200) }
  } catch { return { success: true } }
}

// ── Text post ─────────────────────────────────────────────────────────────────

export async function apiPostText(
  accountId: number,
  text:      string,
  topic?:    string
): Promise<ApiPostResult> {
  // ── 経路0: i.instagram.com Mobile API（instagram.com sessionid がある場合）
  console.log(`[WebAPI] apiPostText account=${accountId} topic=${JSON.stringify(topic)} trying mobile API`)
  const mobileResult = await mobilePostText(accountId, text, topic)
  if (mobileResult.success) {
    console.log(`[WebAPI] ✓ mobile API post success`)
    return { success: true }
  }
  console.warn(`[WebAPI] mobile API failed (status=${mobileResult.status ?? 'N/A'} error=${mobileResult.error ?? ''}) → fallback REST via view`)

  // ── 経路1: REST API via WebContentsView（同一オリジン fetch、最も確実）
  console.log(`[WebAPI] apiPostText account=${accountId} topic=${JSON.stringify(topic)} trying REST via view`)
  await ensureViewLoaded(accountId).catch(() => {})
  const restResp = await restPostTextViaView(accountId, text, topic)
  if (restResp) {
    console.log(`[WebAPI] REST status=${restResp.status} body=${restResp.body.slice(0, 500)}`)
    if (restResp.status === 200) {
      try {
        const json = JSON.parse(restResp.body) as Record<string, unknown>
        const status = (json.status as string | undefined) ?? ''
        if (status === 'ok' || json.media_id || json.media) {
          console.log(`[WebAPI] ✓ REST post success`)
          return { success: true }
        }
        const errMsg = JSON.stringify(json).slice(0, 200)
        console.warn(`[WebAPI] REST 200 but unexpected body: ${errMsg}`)
        return { success: false, error: errMsg }
      } catch (e) {
        console.error(`[WebAPI] REST JSON parse error: ${e instanceof Error ? e.message : String(e)}`)
        return { success: false, error: 'REST response parse error' }
      }
    }
    if (restResp.status === 401 || restResp.status === 403) {
      return { success: false, error: '認証エラー: 再ログインが必要です' }
    }
    return { success: false, error: `REST status=${restResp.status}: ${restResp.body.slice(0, 200)}` }
  }

  // ── 経路2: REST API via net.request + useSessionCookies（ビュー未開放時）
  console.log(`[WebAPI] REST view unavailable, trying REST via net.request`)
  const netResult = await restPostTextViaNet(accountId, text, topic)
  if (netResult) return netResult

  // ── 経路3: GraphQL（最終フォールバック）
  console.log(`[WebAPI] REST net failed, falling back to GraphQL`)
  clearTokenCache(accountId)
  let tokens = await refreshApiTokens(accountId)
  if (!tokens) return { success: false, error: 'ログインセッションが見つかりません' }

  let lastError = ''
  for (const docId of CREATE_TEXT_DOC_IDS) {
    console.log(`[WebAPI] trying doc_id=${docId}`)
    const res = await graphqlPost(accountId, tokens, docId, {
      text,
      audience:     'default',
      replyControl: 'accounts_you_follow',
    })

    if (res.authError) {
      console.warn('[WebAPI] auth error – re-fetching tokens')
      clearTokenCache(accountId)
      tokens = await refreshApiTokens(accountId)
      if (!tokens) return { success: false, error: '認証エラー: 再ログインが必要です' }
      lastError = 'authError'
      continue
    }
    if (res.errorMsg === 'invalid_doc_id' || res.errorMsg === 'empty response' || res.errorMsg === 'empty response body') {
      console.log(`[WebAPI] doc_id=${docId} → ${res.errorMsg}, trying next`)
      lastError = res.errorMsg
      continue
    }
    if (res.ok) return { success: true }
    return { success: false, error: res.errorMsg }
  }

  return { success: false, error: lastError || 'テキスト投稿 API が応答しませんでした (全 doc_id 試行済み)' }
}

// ── Image upload ──────────────────────────────────────────────────────────────

async function uploadImage(
  tokens:    ApiTokens,
  imagePath: string,
  accountId: number
): Promise<string | null> {
  const fileData = fs.readFileSync(imagePath)
  const uploadId = Date.now().toString()
  const mime     = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'

  try {
    const resp = await doPost({
      url: `${THREADS_URL}/rupload_igphoto/${uploadId}`,
      headers: {
        'Content-Type':               mime,
        'X-Entity-Type':              mime,
        'X-Entity-Length':            fileData.length.toString(),
        'X-Entity-Name':              uploadId,
        'X-Instagram-Rupload-Params': JSON.stringify({ media_type: 1, upload_id: uploadId }),
        'Offset':                     '0',
        'X-IG-App-ID':                IG_APP_ID,
        'X-CSRFToken':                tokens.csrfToken,
        'Origin':                     THREADS_URL,
        'User-Agent':                 BROWSER_UA,
        'Accept-Encoding':            'identity',
      },
      body:      fileData,
      accountId,
    })

    console.log(`[WebAPI] uploadImage status=${resp.status} body=${resp.body.slice(0, 200)}`)
    if (resp.status !== 200) return null
    const json = parseJson(resp.body) as Record<string, unknown>
    return (json.upload_id as string | undefined) ?? uploadId
  } catch (e) {
    console.error(`[WebAPI] uploadImage error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ── Media post ────────────────────────────────────────────────────────────────

export async function apiPostWithMedia(
  accountId:  number,
  text:       string,
  imagePaths: string[],
  topic?:     string
): Promise<ApiPostResult> {
  const validPaths = imagePaths.filter(p => fs.existsSync(p))
  if (validPaths.length === 0) return apiPostText(accountId, text, topic)

  // ── 経路0: i.instagram.com Mobile API（instagram.com sessionid がある場合）
  console.log(`[WebAPI] apiPostWithMedia account=${accountId} images=${validPaths.length} topic=${JSON.stringify(topic)} trying mobile API`)
  const mobileResult = await mobilePostWithMedia(accountId, text, validPaths, topic)
  if (mobileResult.success) {
    console.log(`[WebAPI] ✓ mobile API media post success`)
    return { success: true }
  }
  console.warn(`[WebAPI] mobile media API failed (status=${mobileResult.status ?? 'N/A'} error=${mobileResult.error ?? ''}) → fallback REST via view`)

  // ── 経路1: REST API via WebContentsView（同一オリジン fetch）
  console.log(`[WebAPI] apiPostWithMedia account=${accountId} images=${validPaths.length} trying REST via view`)
  await ensureViewLoaded(accountId).catch(() => {})
  const restResp = await restPostMediaViaView(accountId, text, validPaths, topic)
  if (restResp) {
    console.log(`[WebAPI] REST media status=${restResp.status} body=${restResp.body.slice(0, 500)}`)
    if (restResp.status === 200) {
      try {
        const json = JSON.parse(restResp.body) as Record<string, unknown>
        const status = (json.status as string | undefined) ?? ''
        if (status === 'ok' || json.media_id || json.media) {
          console.log(`[WebAPI] ✓ REST media post success`)
          return { success: true }
        }
        const errMsg = JSON.stringify(json).slice(0, 200)
        console.warn(`[WebAPI] REST media 200 but unexpected body: ${errMsg}`)
        return { success: false, error: errMsg }
      } catch (e) {
        console.error(`[WebAPI] REST media JSON parse error: ${e instanceof Error ? e.message : String(e)}`)
        return { success: false, error: 'REST media response parse error' }
      }
    }
    if (restResp.status === 401 || restResp.status === 403) {
      return { success: false, error: '認証エラー: 再ログインが必要です' }
    }
    // 400 等の場合は経路2（net.request）へフォールスルー
    console.warn(`[WebAPI] REST media view status=${restResp.status} → falling through to net`)
  }

  // ── 経路2: REST API via net.request + useSessionCookies（ビュー未開放時）
  console.log(`[WebAPI] REST media view unavailable, trying REST media via net.request`)
  const netResult = await restPostMediaViaNet(accountId, text, validPaths, topic)
  if (netResult) return netResult

  // ── 経路3: GraphQL（最終フォールバック）
  console.log(`[WebAPI] REST media net failed, falling back to GraphQL upload`)
  clearTokenCache(accountId)
  let tokens = await refreshApiTokens(accountId)
  if (!tokens) return { success: false, error: 'ログインセッションが見つかりません' }

  const uploadIds: string[] = []
  for (const imgPath of validPaths) {
    const uploadId = await uploadImage(tokens, imgPath, accountId)
    if (!uploadId) return { success: false, error: `画像アップロードに失敗しました: ${imgPath}` }
    uploadIds.push(uploadId)
  }

  let lastError = ''
  for (const docId of CREATE_TEXT_DOC_IDS) {
    const res = await graphqlPost(accountId, tokens, docId, {
      text,
      audience:     'default',
      replyControl: 'accounts_you_follow',
      attachment: { photo: { upload_id: uploadIds[0], source_type: '4' } },
    })

    if (res.authError) {
      clearTokenCache(accountId)
      tokens = await refreshApiTokens(accountId)
      if (!tokens) return { success: false, error: '認証エラー: 再ログインが必要です' }
      continue
    }
    if (res.errorMsg === 'invalid_doc_id' || res.errorMsg === 'empty response' || res.errorMsg === 'empty response body') {
      lastError = res.errorMsg
      continue
    }
    if (res.ok) return { success: true }
    return { success: false, error: res.errorMsg }
  }

  return { success: false, error: lastError || '画像付き投稿 API が応答しませんでした' }
}
