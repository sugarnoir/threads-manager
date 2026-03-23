import { ipcMain } from 'electron'
import {
  getAllProxyPresets,
  createProxyPreset,
  updateProxyPreset,
  deleteProxyPreset,
  type ProxyPresetInput,
} from '../db/repositories/proxy-presets'

export function registerProxyPresetHandlers(): void {
  ipcMain.handle('proxy-presets:list', () => getAllProxyPresets())

  ipcMain.handle('proxy-presets:create', (_event, data: ProxyPresetInput) => {
    return createProxyPreset(data)
  })

  ipcMain.handle(
    'proxy-presets:update',
    (_event, { id, ...data }: ProxyPresetInput & { id: number }) => {
      updateProxyPreset(id, data)
      return { success: true }
    }
  )

  ipcMain.handle('proxy-presets:delete', (_event, id: number) => {
    deleteProxyPreset(id)
    return { success: true }
  })
}
