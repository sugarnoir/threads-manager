/**
 * Python ブリッジ IPC ハンドラ
 */

import { ipcMain, session } from 'electron'
import { pythonBridge } from '../lib/python-bridge'
import { getAccountById } from '../db/repositories/accounts'
import { generateBrowserUA } from '../lib/ua-generator'

export function registerPythonBridgeHandlers(): void {
  ipcMain.handle('python:ping', async () => {
    try {
      return await pythonBridge.send({ action: 'ping' })
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('python:tls-profiles', async () => {
    try {
      return await pythonBridge.send({ action: 'tls_profiles' })
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('python:tls-check', async (_event, profile?: string) => {
    try {
      return await pythonBridge.send({ action: 'tls_check', profile: profile ?? 'safari_ios_16_0' })
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('python:tls-compare', async () => {
    try {
      return await pythonBridge.send({ action: 'tls_compare' })
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  // PoC: tls-client 経由 Threads テキスト投稿
  ipcMain.handle('python:test-post', async (_event, accountId: number) => {
    try {
      const account = getAccountById(accountId)
      if (!account) return { error: 'account not found' }

      // Cookie 取得 (threads.com + instagram.com)
      const partition = `persist:account-${accountId}`
      const sess = session.fromPartition(partition)
      const threadsCookies = await sess.cookies.get({ url: 'https://www.threads.com' })
      const igCookies = await sess.cookies.get({ url: 'https://www.instagram.com' })

      // 統合 (threads.com 優先、重複は threads 側を採用)
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
      if (!csrfCookie) return { error: 'csrftoken not found in cookies' }

      // Proxy
      let proxy: string | undefined
      if (account.proxy_url && account.proxy_username) {
        const proxyPass = (account as any).proxy_password ?? ''
        proxy = `http://${encodeURIComponent(account.proxy_username)}:${encodeURIComponent(proxyPass)}@${account.proxy_url.replace(/^https?:\/\//, '')}`
      }

      const timestamp = new Date().toISOString().slice(11, 19)
      const content = `test tls-client ${timestamp}`

      console.log(`[python:test-post] account=${accountId} cookies=${cookies.length} csrf=${csrfCookie.value.slice(0, 8)}... proxy=${proxy ? 'yes' : 'no'}`)

      return await pythonBridge.send({
        action: 'post_threads_text',
        tls_profile: 'safari_ios_16_0',
        cookies,
        csrf_token: csrfCookie.value,
        user_agent: account.user_agent ?? generateBrowserUA(),
        proxy,
        content,
        app_id: '238260118697367',
      })
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('python:status', async () => {
    return { ready: pythonBridge.isReady() }
  })

  // Electron (Chromium) 自身の TLS fingerprint を取得
  ipcMain.handle('tls:electron-check', async () => {
    const { net } = await import('electron')
    return new Promise((resolve) => {
      const req = net.request('https://tls.peet.ws/api/all')
      let body = ''
      req.on('response', (resp) => {
        resp.on('data', (chunk: Buffer) => { body += chunk.toString() })
        resp.on('end', () => {
          try {
            const data = JSON.parse(body)
            const tls = data.tls ?? {}
            resolve({
              profile: 'electron_chromium',
              ja3_hash: tls.ja3_hash ?? '',
              ja4: tls.ja4 ?? '',
              akamai_hash: (data.http2 ?? {}).akamai_fingerprint_hash ?? '',
              http_version: data.http_version ?? '',
            })
          } catch { resolve({ error: 'parse failed', body: body.slice(0, 200) }) }
        })
      })
      req.on('error', (e) => resolve({ error: String(e) }))
      req.end()
    })
  })
}
