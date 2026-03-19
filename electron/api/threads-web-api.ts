/**
 * Threads 非公式 Web API クライアント
 *
 * セッション Cookie (sessionid / csrftoken / ds_user_id) を使って
 * Threads の内部 GraphQL API に直接リクエストする。
 *
 * ・テキスト投稿: POST /api/graphql (BaristaCreateContainerMutation)
 * ・画像アップロード: POST /rupload_igphoto/<upload_id> (binary)
 * ・画像付き投稿: 上記アップロード後に GraphQL で投稿
 *
 * トークン (LSD / fb_dtsg) は隠し BrowserWindow でページを開いて抽出し、
 * DB (app_settings) に最大 TOKEN_TTL_MS キャッシュする。
 */

import { BrowserWindow, net, session, Session } from 'electron'
import { getSetting, setSetting }                from '../db/repositories/settings'
import fs                                        from 'fs'

const THREADS_URL = 'https://www.threads.net'
const IG_APP_ID   = '238260118697367'
const TOKEN_TTL_MS = 25 * 60 * 1000   // 25 分

// ── Known create-thread doc_ids (試順に試行、全て失敗なら Playwright fallback) ─

const CREATE_TEXT_DOC_IDS = [
  '7783822248314888',
  '24513024604657049',
  '6234100523339054',
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

async function getApiTokens(accountId: number): Promise<ApiTokens | null> {
  // キャッシュ確認
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
  const sess = session.fromPartition(`persist:account-${accountId}`)
  const cookies = await sess.cookies.get({ url: THREADS_URL }).catch(() => [])

  if (!cookies.some(c => c.name === 'sessionid' && c.value)) return null   // 未ログイン

  const csrfToken = cookies.find(c => c.name === 'csrftoken')?.value  ?? ''
  const userId    = cookies.find(c => c.name === 'ds_user_id')?.value ?? ''

  // 隠しウィンドウでページを開いて LSD / fb_dtsg を抽出
  const { lsd, fbDtsg } = await extractPageTokens(sess)

  const tokens: ApiTokens = { userId, csrfToken, lsd, fbDtsg, savedAt: Date.now() }
  setSetting(`threads_api_tokens_${accountId}`, JSON.stringify(tokens))
  return tokens
}

function extractPageTokens(sess: Session): Promise<{ lsd: string; fbDtsg: string }> {
  return new Promise((resolve) => {
    // ホームページを GET して HTML から LSD / fb_dtsg を抜き出す
    const req = net.request({ method: 'GET', url: THREADS_URL + '/', session: sess, useSessionCookies: true })
    let html = ''
    req.on('response', (resp) => {
      resp.on('data',  chunk => { html += chunk.toString() })
      resp.on('end', () => {
        // require 配列 ["LSD",[],{"token":"xxx"},…] 形式
        const lsdMatch   = html.match(/"LSD",\[\],\{"token":"([^"]+)"/)
                        || html.match(/\["LSD",\[\],\{"token":"([^"]+)"/)
        const dtsgMatch  = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)
                        || html.match(/"DTSGInitData",\[\],\{"token":"([^"]+)"/)
                        || html.match(/"fb_dtsg":"([^"]+)"/)
        resolve({
          lsd:    lsdMatch  ? lsdMatch[1]  : '',
          fbDtsg: dtsgMatch ? dtsgMatch[1] : '',
        })
      })
    })
    req.on('error', () => resolve({ lsd: '', fbDtsg: '' }))
    req.end()
  })
}

function clearTokenCache(accountId: number): void {
  setSetting(`threads_api_tokens_${accountId}`, '')
}

// ── net.request helper ────────────────────────────────────────────────────────

async function netPost(opts: {
  url:     string
  sess:    Session
  headers: Record<string, string>
  body:    string | Buffer
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'POST', url: opts.url, session: opts.sess, useSessionCookies: true })
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

// ── GraphQL post helper ───────────────────────────────────────────────────────

async function graphqlPost(
  accountId: number,
  tokens:    ApiTokens,
  docId:     string,
  variables: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; errorMsg?: string; authError?: boolean }> {
  const sess = session.fromPartition(`persist:account-${accountId}`)
  const body = new URLSearchParams({
    av:               tokens.userId,
    __d:              'www',
    __user:           tokens.userId,
    __a:              '1',
    lsd:              tokens.lsd,
    fb_dtsg:          tokens.fbDtsg,
    doc_id:           docId,
    variables:        JSON.stringify(variables),
    server_timestamps: 'true',
  }).toString()

  try {
    const resp = await netPost({
      url:  `${THREADS_URL}/api/graphql`,
      sess,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken':  tokens.csrfToken,
        'X-FB-LSD':     tokens.lsd,
        'X-IG-App-ID':  IG_APP_ID,
        'Origin':       THREADS_URL,
        'Referer':      THREADS_URL + '/',
        'Accept':       '*/*',
      },
      body,
    })

    if (resp.status === 401) return { ok: false, authError: true }

    const json = JSON.parse(resp.body)
    if (json.errors?.length) {
      const msg = json.errors[0]?.message as string || ''
      // doc_id が古い場合は次を試す
      if (/doc_id|not found|invalid/i.test(msg)) return { ok: false, errorMsg: 'invalid_doc_id' }
      return { ok: false, errorMsg: msg }
    }
    if (json.data) return { ok: true, data: json.data }
    return { ok: false, errorMsg: 'empty response' }
  } catch (e) {
    return { ok: false, errorMsg: e instanceof Error ? e.message : String(e) }
  }
}

// ── Text post ─────────────────────────────────────────────────────────────────

export async function apiPostText(
  accountId: number,
  text:      string
): Promise<ApiPostResult> {
  let tokens = await getApiTokens(accountId)
  if (!tokens) return { success: false, error: 'ログインセッションが見つかりません' }

  for (const docId of CREATE_TEXT_DOC_IDS) {
    const res = await graphqlPost(accountId, tokens, docId, {
      text,
      audience:     'default',
      replyControl: 'accounts_you_follow',
    })

    if (res.authError) {
      clearTokenCache(accountId)
      // 一度だけ再取得して retry
      tokens = await refreshApiTokens(accountId)
      if (!tokens) return { success: false, error: '認証エラー: 再ログインが必要です' }
      continue
    }
    if (res.errorMsg === 'invalid_doc_id') continue  // 次の doc_id を試す
    if (res.ok) return { success: true }
    return { success: false, error: res.errorMsg }
  }

  return { success: false, error: 'テキスト投稿 API が応答しませんでした (全 doc_id 試行済み)' }
}

// ── Image upload ──────────────────────────────────────────────────────────────

async function uploadImage(
  accountId: number,
  imagePath: string,
  tokens:    ApiTokens
): Promise<string | null> {
  const fileData = fs.readFileSync(imagePath)
  const uploadId = Date.now().toString()
  const mime     = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  const sess     = session.fromPartition(`persist:account-${accountId}`)

  try {
    const resp = await netPost({
      url:  `${THREADS_URL}/rupload_igphoto/${uploadId}`,
      sess,
      headers: {
        'Content-Type':               mime,
        'X-Entity-Type':              mime,
        'X-Entity-Length':            fileData.length.toString(),
        'X-Entity-Name':              uploadId,
        'X-Instagram-Rupload-Params': JSON.stringify({
          media_type: 1,
          upload_id:  uploadId,
        }),
        'Offset':        '0',
        'X-IG-App-ID':   IG_APP_ID,
        'X-CSRFToken':   tokens.csrfToken,
        'Origin':        THREADS_URL,
      },
      body: fileData,
    })

    if (resp.status !== 200) return null
    const json = JSON.parse(resp.body)
    return (json.upload_id as string | undefined) ?? uploadId
  } catch {
    return null
  }
}

// ── Media post ────────────────────────────────────────────────────────────────

export async function apiPostWithMedia(
  accountId:  number,
  text:        string,
  imagePaths:  string[]
): Promise<ApiPostResult> {
  let tokens = await getApiTokens(accountId)
  if (!tokens) return { success: false, error: 'ログインセッションが見つかりません' }

  // 画像を順番にアップロード
  const uploadIds: string[] = []
  for (const imgPath of imagePaths) {
    if (!fs.existsSync(imgPath)) continue
    const uploadId = await uploadImage(accountId, imgPath, tokens)
    if (!uploadId) return { success: false, error: `画像アップロードに失敗しました: ${imgPath}` }
    uploadIds.push(uploadId)
  }

  if (uploadIds.length === 0) {
    // 画像が全て失敗 or なし → テキスト投稿にフォールバック
    return apiPostText(accountId, text)
  }

  // 画像付き投稿 (1枚目のみ使用。Threads は現状1枚)
  for (const docId of CREATE_TEXT_DOC_IDS) {
    const res = await graphqlPost(accountId, tokens, docId, {
      text,
      audience:     'default',
      replyControl: 'accounts_you_follow',
      attachment: {
        photo: { upload_id: uploadIds[0], source_type: '4' },
      },
    })

    if (res.authError) {
      clearTokenCache(accountId)
      tokens = await refreshApiTokens(accountId)
      if (!tokens) return { success: false, error: '認証エラー: 再ログインが必要です' }
      continue
    }
    if (res.errorMsg === 'invalid_doc_id') continue
    if (res.ok) return { success: true }
    return { success: false, error: res.errorMsg }
  }

  return { success: false, error: '画像付き投稿 API が応答しませんでした' }
}
