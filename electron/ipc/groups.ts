import { ipcMain } from 'electron'
import { getAllGroups, createGroup, renameGroup, deleteGroup, reorderGroups } from '../db/repositories/groups'

export function registerGroupHandlers(): void {
  ipcMain.handle('groups:list', () => getAllGroups())

  ipcMain.handle('groups:create', (_e, name: string) => {
    const group = createGroup(name)
    return { success: true, group }
  })

  ipcMain.handle('groups:rename', (_e, data: { oldName: string; newName: string }) => {
    renameGroup(data.oldName, data.newName)
    return { success: true }
  })

  ipcMain.handle('groups:delete', (_e, name: string) => {
    deleteGroup(name)
    return { success: true }
  })

  ipcMain.handle('groups:reorder', (_e, updates: { id: number; sort_order: number }[]) => {
    reorderGroups(updates)
    return { success: true }
  })
}
