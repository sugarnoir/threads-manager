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

  ipcMain.handle('python:status', async () => {
    return { ready: pythonBridge.isReady() }
  })
}
