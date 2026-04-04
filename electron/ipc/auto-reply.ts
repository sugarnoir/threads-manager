import { ipcMain } from 'electron'
import {
  getAutoReplyConfig, saveAutoReplyConfig,
  getAutoReplyTemplates, saveAutoReplyTemplate, deleteAutoReplyTemplate,
  getReplyRecordsByGroup,
} from '../db/repositories/auto-reply'

export function registerAutoReplyHandlers(): void {
  ipcMain.handle('autoReply:get', (_e, groupName: string) =>
    getAutoReplyConfig(groupName)
  )

  ipcMain.handle('autoReply:save', (_e, data: {
    group_name:     string
    enabled:        boolean
    check_interval: number
    reply_texts:    string[]
  }) => saveAutoReplyConfig(data))

  ipcMain.handle('autoReply:history', (_e, groupName: string) =>
    getReplyRecordsByGroup(groupName, 100)
  )

  ipcMain.handle('autoReply:templates:list', () =>
    getAutoReplyTemplates()
  )

  ipcMain.handle('autoReply:templates:save', (_e, name: string, replyTexts: string[]) =>
    saveAutoReplyTemplate(name, replyTexts)
  )

  ipcMain.handle('autoReply:templates:delete', (_e, id: number) => {
    deleteAutoReplyTemplate(id)
    return { success: true }
  })
}
