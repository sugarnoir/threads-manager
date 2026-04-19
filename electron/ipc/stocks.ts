import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import {
  getStocksByAccount,
  createStock,
  updateStock,
  deleteStock,
  deleteAllStocks,
  deleteAllStocksByGroup,
  updateAllTopics,
  addTopicToEmptyStocks,
} from '../db/repositories/post_stocks'
import { getAllAccounts } from '../db/repositories/accounts'
import { getSetting, setSetting } from '../db/repositories/settings'
import { scheduleThread } from '../playwright/threads-client'
import { ensureViewLoaded } from '../browser-views/view-manager'

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
    topic?:       string | null
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
    topic?:       string | null
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

  ipcMain.handle('stocks:deleteAll', (_e, accountId: number) => {
    try {
      const deleted = deleteAllStocks(accountId)
      return { success: true, deleted }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('stocks:deleteAllByGroup', (_e, groupKey: string) => {
    try {
      const deleted = deleteAllStocksByGroup(groupKey)
      return { success: true, deleted }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('stocks:updateAllTopics', (_e, data: { account_id: number; topic: string | null }) => {
    try {
      const updated = updateAllTopics(data.account_id, data.topic || null)
      return { success: true, updated }
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
    console.log(`[CSV import] received ${rows.length} rows`)
    console.log(`[CSV import] account_ids=${[...new Set(rows.map(r => r.account_id))].join(',')}`)
    console.log('[CSV import] first 3 payload:', JSON.stringify(rows.slice(0, 3), null, 2))

    let imported = 0
    const errors: string[] = []

    for (const row of rows) {
      if (!row.content?.trim()) {
        console.log(`[CSV import] skip empty content for account_id=${row.account_id}`)
        continue
      }
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
        const msg = `アカウントID ${row.account_id}: ${err instanceof Error ? err.message : String(err)}`
        console.error('[CSV import] error:', msg)
        errors.push(msg)
      }
    }

    console.log(`[CSV import] done: imported=${imported} errors=${errors.length}`)
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
    topic?:       string | null
  }) => {
    try {
      const mediaPaths = [data.image_url, data.image_url_2]
        .filter((p): p is string => typeof p === 'string' && p.length > 0)

      // WebContentsView をウォームアップしてセッションが有効か確認
      console.log(`[stocks:schedule-post] ensureViewLoaded account=${data.account_id}`)
      await ensureViewLoaded(data.account_id).catch((e) => {
        console.warn(`[stocks:schedule-post] ensureViewLoaded failed: ${e}`)
      })

      // 最大3回リトライ
      const MAX_ATTEMPTS = 3
      let lastError = 'unknown error'
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        console.log(`[stocks:schedule-post] attempt ${attempt}/${MAX_ATTEMPTS} account=${data.account_id} topic=${JSON.stringify(data.topic)}`)
        try {
          const result = await scheduleThread(
            data.account_id,
            data.content,
            new Date(data.scheduled_at),
            mediaPaths,
            data.topic ?? undefined,
          )
          if (result.success) return result
          lastError = result.error ?? 'unknown error'
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
        }
        console.warn(`[stocks:schedule-post] attempt ${attempt} failed: ${lastError}`)
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
      }
      return { success: false, error: lastError }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('debug:log', (_e, msg: string) => {
    console.log('[DEBUG]', msg)
  })


  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const data = Array.from(fs.readFileSync(filePath))
    return { name: path.basename(filePath), data }
  })

  /**
   * トピック一括追加（XLSX 列 = 垢、行 = トピック）。
   * 各垢のトピック未設定ストックにのみ追加する。
   */
  ipcMain.handle('stocks:bulk-add-topics', (_e, data: {
    group_name: string | null
    columns:    string[][]   // columns[colIdx] = ['topic1', 'topic2', ...]
  }) => {
    const groupAccounts = getAllAccounts()
      .filter(a => (data.group_name === null || data.group_name === '')
        ? true
        : a.group_name === data.group_name)

    const results: Array<{ accountId: number; username: string; added: number }> = []

    for (let col = 0; col < data.columns.length; col++) {
      const acct = groupAccounts[col]
      if (!acct) break  // 垢数より列が多い場合は無視
      const topics = data.columns[col].filter(t => t.trim())
      let added = 0
      for (const topic of topics) {
        added += addTopicToEmptyStocks(acct.id, topic.trim())
      }
      results.push({ accountId: acct.id, username: acct.username, added })
    }

    console.log(`[bulk-add-topics] group=${data.group_name} cols=${data.columns.length} results=${JSON.stringify(results)}`)
    return { success: true, results }
  })
}
