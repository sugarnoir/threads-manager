import { ipcMain } from 'electron'
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../db/repositories/templates'

export function registerTemplateHandlers(): void {
  ipcMain.handle('templates:list', (_e, accountId: number | null | undefined) => {
    try {
      // undefined はフロントから送られる場合もあるため null に正規化
      const id = accountId === undefined ? null : accountId
      return { success: true, data: getTemplates(id) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('templates:create', (_e, data: {
    title:      string
    content:    string
    account_id?: number | null
  }) => {
    try {
      return { success: true, data: createTemplate(data) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('templates:update', (_e, data: { id: number; title: string; content: string }) => {
    try {
      const { id, ...rest } = data
      return { success: true, data: updateTemplate(id, rest) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('templates:delete', (_e, id: number) => {
    try {
      deleteTemplate(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
