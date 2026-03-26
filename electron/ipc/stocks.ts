import { ipcMain } from 'electron'
import {
  getStocksByAccount,
  createStock,
  updateStock,
  deleteStock,
} from '../db/repositories/post_stocks'
import { getSetting, setSetting } from '../db/repositories/settings'
import { scheduleThread } from '../playwright/threads-client'

function getImageGroups(): { group1: string[]; group2: string[] } {
  const g1 = getSetting('image_group_1')
  const g2 = getSetting('image_group_2')
  return {
    group1: g1 ? (JSON.parse(g1) as string[]) : [],
    group2: g2 ? (JSON.parse(g2) as string[]) : [],
  }
}

function pickRandom(arr: string[]): string | null {
  if (!arr.length) return null
  return arr[Math.floor(Math.random() * arr.length)]
}

export function registerStockHandlers(): void {
  ipcMain.handle('stocks:list', (_e, accountId: number) => {
    try {
      return { success: true, data: getStocksByAccount(accountId) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('stocks:create', (_e, data: {
    account_id:   number
    title?:       string | null
    content:      string
    image_url?:   string | null
    image_url_2?: string | null
  }) => {
    try {
      return { success: true, data: createStock(data) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('stocks:update', (_e, data: {
    id:           number
    title?:       string | null
    content:      string
    image_url?:   string | null
    image_url_2?: string | null
  }) => {
    try {
      const { id, ...rest } = data
      return { success: true, data: updateStock(id, rest) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('stocks:delete', (_e, id: number) => {
    try {
      deleteStock(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // rows はフロントエンドが「アカウント番号順」に解決済み（account_id 付き）
  ipcMain.handle('stocks:import-csv', (_e, rows: Array<{
    account_id:   number
    content:      string
    image_url?:   string | null
    image_url_2?: string | null
  }>) => {
    let imported = 0
    const errors: string[] = []

    for (const row of rows) {
      if (!row.content?.trim()) continue
      try {
        createStock({
          account_id:  row.account_id,
          title:       null,
          content:     row.content.trim(),
          image_url:   row.image_url  || null,
          image_url_2: row.image_url_2 || null,
        })
        imported++
      } catch (err) {
        errors.push(`アカウントID ${row.account_id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return { success: true, imported, errors }
  })

  // ── Image groups (get / save) ────────────────────────────────────────────────
  ipcMain.handle('imageGroups:get', () => {
    try {
      return { success: true, data: getImageGroups() }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('imageGroups:save', (_e, data: { group1: string[]; group2: string[] }) => {
    try {
      setSetting('image_group_1', JSON.stringify(data.group1))
      setSetting('image_group_2', JSON.stringify(data.group2))
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Randomize images for all stocks of an account ────────────────────────────
  ipcMain.handle('stocks:randomize-images', (_e, accountId: number) => {
    try {
      const { group1, group2 } = getImageGroups()
      const stocks = getStocksByAccount(accountId)
      let updated = 0
      const errors: string[] = []
      for (const stock of stocks) {
        try {
          updateStock(stock.id, {
            title:       stock.title,
            content:     stock.content,
            image_url:   pickRandom(group1),
            image_url_2: pickRandom(group2),
          })
          updated++
        } catch (err) {
          errors.push(`ID ${stock.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      return { success: true, updated, errors }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Browser schedule post ────────────────────────────────────────────────────
  ipcMain.handle('stocks:schedule-post', async (_e, data: {
    account_id:   number
    content:      string
    scheduled_at: string   // ISO 8601
    image_url?:   string | null
    image_url_2?: string | null
  }) => {
    try {
      const mediaPaths = [data.image_url, data.image_url_2]
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
      const result = await scheduleThread(
        data.account_id,
        data.content,
        new Date(data.scheduled_at),
        mediaPaths,
      )
      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
