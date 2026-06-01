/**
 * Python ブリッジ IPC ハンドラ
 */

import { ipcMain } from 'electron'
import { pythonBridge } from '../lib/python-bridge'

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
