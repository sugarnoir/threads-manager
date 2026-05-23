/**
 * AdsPower Local API Client
 * API Docs: https://localapi-doc-en.adspower.com/
 */

import { getSetting } from '../../db/repositories/settings'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AdsPowerProxyConfig {
  proxy_soft: string      // 'luminati' | 'other' | etc.
  proxy_type: string      // 'http' | 'socks5'
  proxy_host: string
  proxy_port: string
  proxy_user: string
  proxy_password: string
}

export interface AdsPowerFingerprint {
  automatic_timezone: '1' | '0'
  language: string[]
  ua: string
  random_ua?: { ua_browser: string[]; ua_version: string[] }
}

export interface AdsPowerCreateProfilePayload {
  name: string
  group_id: string
  domain_name?: string
  username?: string
  password?: string
  fakey?: string
  cookie?: string
  user_proxy_config?: AdsPowerProxyConfig
  fingerprint_config?: Partial<AdsPowerFingerprint>
  repeat_config?: string[]  // ['0'] = allow repeat
}

export interface AdsPowerProfile {
  user_id: string
  name: string
  serial_number: string
  group_id: string
  group_name: string
  domain_name: string
  username: string
  remark: string
  created_time: string
  sys_app_cate_id: string
  last_open_time: string
}

export interface AdsPowerGroup {
  group_id: string
  group_name: string
  remark: string
}

export interface BrowserSession {
  ws: { selenium: string; puppeteer: string }
  debug_port: string
  webdriver: string
}

export interface AdsPowerApiResponse<T = unknown> {
  code: number
  msg: string
  data?: T
}

// ── Client ───────────────────────────────────────────────────────────────────

function getApiUrl(): string {
  return getSetting('adspower_api_url') || 'http://localhost:50325'
}

async function request<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
): Promise<AdsPowerApiResponse<T>> {
  const baseUrl = getApiUrl()
  const url = `${baseUrl}${path}`

  const options: RequestInit = { method }
  if (body && method === 'POST') {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(body)
  }

  const resp = await fetch(url, options)
  if (!resp.ok) {
    throw new Error(`AdsPower API error: ${resp.status} ${resp.statusText}`)
  }
  return resp.json() as Promise<AdsPowerApiResponse<T>>
}

// ── Status ───────────────────────────────────────────────────────────────────

export async function checkStatus(): Promise<{ status: string; version?: string }> {
  const res = await request<{ status: string; version: string }>('/api/v1/status')
  if (res.code !== 0) throw new Error(res.msg)
  return { status: res.data?.status ?? 'unknown', version: res.data?.version }
}

// ── Profile CRUD ─────────────────────────────────────────────────────────────

export async function createProfile(
  payload: AdsPowerCreateProfilePayload,
): Promise<string> {
  const res = await request<{ id: string }>('/api/v1/user/create', 'POST', payload as unknown as Record<string, unknown>)
  if (res.code !== 0) throw new Error(`createProfile failed: ${res.msg}`)
  return res.data!.id
}

export async function updateProfile(
  userId: string,
  payload: Partial<AdsPowerCreateProfilePayload>,
): Promise<void> {
  const body = { ...payload, user_id: userId }
  const res = await request('/api/v1/user/update', 'POST', body as unknown as Record<string, unknown>)
  if (res.code !== 0) throw new Error(`updateProfile failed: ${res.msg}`)
}

export async function deleteProfile(userIds: string[]): Promise<void> {
  const res = await request('/api/v1/user/delete', 'POST', { user_ids: userIds })
  if (res.code !== 0) throw new Error(`deleteProfile failed: ${res.msg}`)
}

export async function getProfile(userId: string): Promise<AdsPowerProfile | null> {
  const res = await request<{ list: AdsPowerProfile[] }>(`/api/v1/user/list?user_id=${userId}`)
  if (res.code !== 0) throw new Error(`getProfile failed: ${res.msg}`)
  return res.data?.list?.[0] ?? null
}

export async function listProfiles(
  groupId?: string,
  page = 1,
  pageSize = 100,
): Promise<{ list: AdsPowerProfile[]; page: number; page_size: number }> {
  let path = `/api/v1/user/list?page=${page}&page_size=${pageSize}`
  if (groupId) path += `&group_id=${groupId}`
  const res = await request<{ list: AdsPowerProfile[]; page: number; page_size: number }>(path)
  if (res.code !== 0) throw new Error(`listProfiles failed: ${res.msg}`)
  return res.data!
}

// ── Browser Operations ───────────────────────────────────────────────────────

export async function startBrowser(
  userId: string,
  options?: {
    headless?: boolean
    open_tabs?: number
    ip_tab?: number
    new_first_tab?: number
    launch_args?: string[]
    clear_cache_after_closing?: number
  },
): Promise<BrowserSession> {
  const params = new URLSearchParams({ user_id: userId })
  if (options?.headless) params.set('headless', '1')
  if (options?.open_tabs !== undefined) params.set('open_tabs', String(options.open_tabs))
  if (options?.ip_tab !== undefined) params.set('ip_tab', String(options.ip_tab))
  if (options?.new_first_tab !== undefined) params.set('new_first_tab', String(options.new_first_tab))
  if (options?.launch_args?.length) params.set('launch_args', JSON.stringify(options.launch_args))
  if (options?.clear_cache_after_closing !== undefined) {
    params.set('clear_cache_after_closing', String(options.clear_cache_after_closing))
  }

  const res = await request<BrowserSession>(`/api/v1/browser/start?${params.toString()}`)
  if (res.code !== 0) throw new Error(`startBrowser failed: ${res.msg}`)
  return res.data!
}

export async function stopBrowser(userId: string): Promise<void> {
  const res = await request(`/api/v1/browser/stop?user_id=${userId}`)
  if (res.code !== 0) throw new Error(`stopBrowser failed: ${res.msg}`)
}

export async function getActiveBrowsers(): Promise<
  Array<{ user_id: string; ws: { selenium: string; puppeteer: string } }>
> {
  const res = await request<{ list: Array<{ user_id: string; ws: { selenium: string; puppeteer: string } }> }>(
    '/api/v1/browser/active',
  )
  if (res.code !== 0) throw new Error(`getActiveBrowsers failed: ${res.msg}`)
  return res.data?.list ?? []
}

// ── Group Management ─────────────────────────────────────────────────────────

export async function createGroup(name: string): Promise<string> {
  const res = await request<{ group_id: string }>('/api/v1/group/create', 'POST', { group_name: name })
  if (res.code !== 0) throw new Error(`createGroup failed: ${res.msg}`)
  return res.data!.group_id
}

export async function listGroups(
  page = 1,
  pageSize = 100,
): Promise<AdsPowerGroup[]> {
  const res = await request<{ list: AdsPowerGroup[] }>(
    `/api/v1/group/list?page=${page}&page_size=${pageSize}`,
  )
  if (res.code !== 0) throw new Error(`listGroups failed: ${res.msg}`)
  return res.data?.list ?? []
}
