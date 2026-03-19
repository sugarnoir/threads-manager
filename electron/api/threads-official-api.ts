/**
 * Threads 公式 Graph API クライアント
 *
 * テキスト投稿:
 *   1. POST /v1.0/me/threads (media_type=TEXT)  → creation_id
 *   2. POST /v1.0/me/threads_publish            → thread_id
 *
 * 画像投稿（単一）:
 *   1. ローカルファイル → Imgur にアップロード → 公開 URL 取得
 *   2. POST /v1.0/me/threads (media_type=IMAGE, image_url=...) → creation_id
 *   3. GET  /{creation_id}?fields=status  → FINISHED までポーリング
 *   4. POST /v1.0/me/threads_publish      → thread_id
 *
 * カルーセル（複数画像）:
 *   1. 各画像を Imgur にアップロード
 *   2. 各画像で POST /v1.0/me/threads (media_type=IMAGE, is_carousel_item=true) → item_id
 *   3. 各 item_id を FINISHED までポーリング
 *   4. POST /v1.0/me/threads (media_type=CAROUSEL, children=[item_ids]) → creation_id
 *   5. FINISHED までポーリング
 *   6. POST /v1.0/me/threads_publish
 */

import { net } from 'electron'
import fs from 'fs'
import { getSetting, setSetting } from '../db/repositories/settings'

const GRAPH_URL        = 'https://graph.threads.net/v1.0'
const IMGUR_UPLOAD_URL = 'https://api.imgur.com/3/image'
const POLL_INTERVAL_MS = 2_000
const POLL_MAX         = 15   // 最大 30 秒

// ── Token helpers ─────────────────────────────────────────────────────────────

export function getAccessToken(accountId: number): string | null {
  return getSetting(`threads_access_token_${accountId}`) || null
}

export function setAccessToken(accountId: number, token: string): void {
  setSetting(`threads_access_token_${accountId}`, token.trim())
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

type GraphResult = { ok: boolean; data?: Record<string, unknown>; error?: string }

async function graphPost(path: string, params: Record<string, string>): Promise<GraphResult> {
  return new Promise((resolve) => {
    const body = new URLSearchParams(params).toString()
    const req  = net.request({ method: 'POST', url: `${GRAPH_URL}${path}` })
    req.setHeader('Content-Type', 'application/x-www-form-urlencoded')
    req.setHeader('Content-Length', Buffer.byteLength(body).toString())
    let raw = ''
    req.on('response', (resp) => {
      resp.on('data',  (c) => { raw += c.toString() })
      resp.on('end',   () => {
        try {
          const json = JSON.parse(raw) as Record<string, unknown>
          if (json.error) {
            const e = json.error as Record<string, unknown>
            resolve({ ok: false, error: String(e.message ?? json.error) })
          } else {
            resolve({ ok: true, data: json })
          }
        } catch { resolve({ ok: false, error: `Parse error: ${raw.slice(0, 200)}` }) }
      })
    })
    req.on('error', (e) => resolve({ ok: false, error: e.message }))
    req.write(body)
    req.end()
  })
}

async function graphGet(path: string, params: Record<string, string>): Promise<GraphResult> {
  const qs = new URLSearchParams(params).toString()
  return new Promise((resolve) => {
    const req = net.request({ method: 'GET', url: `${GRAPH_URL}${path}?${qs}` })
    let raw = ''
    req.on('response', (resp) => {
      resp.on('data',  (c) => { raw += c.toString() })
      resp.on('end',   () => {
        try {
          const json = JSON.parse(raw) as Record<string, unknown>
          if (json.error) {
            const e = json.error as Record<string, unknown>
            resolve({ ok: false, error: String(e.message ?? json.error) })
          } else {
            resolve({ ok: true, data: json })
          }
        } catch { resolve({ ok: false, error: `Parse error: ${raw.slice(0, 200)}` }) }
      })
    })
    req.on('error', (e) => resolve({ ok: false, error: e.message }))
    req.end()
  })
}

// ── Imgur upload ──────────────────────────────────────────────────────────────

async function uploadToImgur(
  imagePath: string,
  clientId:  string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const base64 = fs.readFileSync(imagePath).toString('base64')
  const body   = JSON.stringify({ image: base64, type: 'base64' })

  return new Promise((resolve) => {
    const req = net.request({ method: 'POST', url: IMGUR_UPLOAD_URL })
    req.setHeader('Authorization',  `Client-ID ${clientId}`)
    req.setHeader('Content-Type',   'application/json')
    req.setHeader('Content-Length', Buffer.byteLength(body).toString())
    let raw = ''
    req.on('response', (resp) => {
      resp.on('data',  (c) => { raw += c.toString() })
      resp.on('end',   () => {
        try {
          const json = JSON.parse(raw) as Record<string, unknown>
          if (!json.success) {
            const d = json.data as Record<string, unknown> | undefined
            resolve({ ok: false, error: String(d?.error ?? 'Imgur upload failed') })
          } else {
            const d = json.data as Record<string, unknown>
            resolve({ ok: true, url: String(d.link) })
          }
        } catch { resolve({ ok: false, error: `Parse error: ${raw.slice(0, 200)}` }) }
      })
    })
    req.on('error', (e) => resolve({ ok: false, error: e.message }))
    req.write(body)
    req.end()
  })
}

// ── Status polling ────────────────────────────────────────────────────────────

async function pollUntilFinished(
  containerId: string,
  token:       string
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const resp = await graphGet(`/${containerId}`, {
      fields:       'status,error_message',
      access_token: token,
    })
    if (!resp.ok) return { ok: false, error: resp.error }
    const status = String(resp.data?.status ?? '')
    if (status === 'FINISHED') return { ok: true }
    if (status === 'ERROR')    return { ok: false, error: String(resp.data?.error_message ?? 'Container error') }
    if (status === 'EXPIRED')  return { ok: false, error: 'Container expired' }
    // IN_PROGRESS → continue
  }
  return { ok: false, error: 'Polling timeout (30s)' }
}

// ── Resolve local paths to public URLs ───────────────────────────────────────

async function resolveImageUrls(
  imagePaths: string[],
  imgurClientId: string
): Promise<{ ok: boolean; urls?: string[]; error?: string }> {
  const urls: string[] = []
  for (const p of imagePaths) {
    if (p.startsWith('http://') || p.startsWith('https://')) {
      urls.push(p)
    } else {
      const r = await uploadToImgur(p, imgurClientId)
      if (!r.ok) return { ok: false, error: `画像アップロード失敗: ${r.error}` }
      urls.push(r.url!)
    }
  }
  return { ok: true, urls }
}

// ── Text post ─────────────────────────────────────────────────────────────────

export async function officialPostText(
  accountId: number,
  text:      string
): Promise<{ success: boolean; error?: string }> {
  const token = getAccessToken(accountId)
  if (!token) return { success: false, error: 'アクセストークン未設定' }

  const create = await graphPost('/me/threads', { media_type: 'TEXT', text, access_token: token })
  if (!create.ok) return { success: false, error: `コンテナ作成失敗: ${create.error}` }

  const creationId = String(create.data?.id ?? '')
  if (!creationId) return { success: false, error: 'creation_id が取得できませんでした' }

  const publish = await graphPost('/me/threads_publish', { creation_id: creationId, access_token: token })
  if (!publish.ok) return { success: false, error: `公開失敗: ${publish.error}` }

  return { success: true }
}

// ── Image / carousel post ─────────────────────────────────────────────────────

export async function officialPostWithImages(
  accountId:  number,
  text:       string,
  imagePaths: string[]
): Promise<{ success: boolean; error?: string }> {
  const token = getAccessToken(accountId)
  if (!token) return { success: false, error: 'アクセストークン未設定' }

  const imgurClientId = getSetting('imgur_client_id')
  if (!imgurClientId) return { success: false, error: 'Imgur Client ID 未設定' }

  const resolved = await resolveImageUrls(imagePaths, imgurClientId)
  if (!resolved.ok) return { success: false, error: resolved.error }
  const imageUrls = resolved.urls!

  if (imageUrls.length === 1) {
    // ── 単一画像 ──────────────────────────────────────────────────────────────
    const create = await graphPost('/me/threads', {
      media_type:   'IMAGE',
      image_url:    imageUrls[0],
      text,
      access_token: token,
    })
    if (!create.ok) return { success: false, error: `コンテナ作成失敗: ${create.error}` }

    const creationId = String(create.data?.id ?? '')
    const poll = await pollUntilFinished(creationId, token)
    if (!poll.ok) return { success: false, error: `ステータス待機失敗: ${poll.error}` }

    const publish = await graphPost('/me/threads_publish', { creation_id: creationId, access_token: token })
    if (!publish.ok) return { success: false, error: `公開失敗: ${publish.error}` }

    return { success: true }
  }

  // ── カルーセル（複数画像）────────────────────────────────────────────────────
  const itemIds: string[] = []
  for (const url of imageUrls) {
    const item = await graphPost('/me/threads', {
      media_type:       'IMAGE',
      image_url:        url,
      is_carousel_item: 'true',
      access_token:     token,
    })
    if (!item.ok) return { success: false, error: `カルーセルアイテム作成失敗: ${item.error}` }

    const itemId = String(item.data?.id ?? '')
    const poll   = await pollUntilFinished(itemId, token)
    if (!poll.ok) return { success: false, error: `アイテム待機失敗: ${poll.error}` }
    itemIds.push(itemId)
  }

  const create = await graphPost('/me/threads', {
    media_type:   'CAROUSEL',
    children:     itemIds.join(','),
    text,
    access_token: token,
  })
  if (!create.ok) return { success: false, error: `カルーセルコンテナ作成失敗: ${create.error}` }

  const creationId = String(create.data?.id ?? '')
  const poll = await pollUntilFinished(creationId, token)
  if (!poll.ok) return { success: false, error: `カルーセル待機失敗: ${poll.error}` }

  const publish = await graphPost('/me/threads_publish', { creation_id: creationId, access_token: token })
  if (!publish.ok) return { success: false, error: `公開失敗: ${publish.error}` }

  return { success: true }
}
