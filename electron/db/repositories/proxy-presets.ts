import { getDb } from '../index'

export interface ProxyPreset {
  id: number
  name: string
  type: 'http' | 'https' | 'socks5'
  host: string
  port: number
  username: string | null
  password: string | null
  created_at: string
}

export type ProxyPresetInput = Omit<ProxyPreset, 'id' | 'created_at'>

export function getAllProxyPresets(): ProxyPreset[] {
  return getDb()
    .prepare('SELECT * FROM proxy_presets ORDER BY name COLLATE NOCASE')
    .all() as ProxyPreset[]
}

export function createProxyPreset(data: ProxyPresetInput): ProxyPreset {
  const db = getDb()
  const result = db
    .prepare(
      'INSERT INTO proxy_presets (name, type, host, port, username, password) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(data.name, data.type, data.host, data.port, data.username ?? null, data.password ?? null)
  return db
    .prepare('SELECT * FROM proxy_presets WHERE id = ?')
    .get(result.lastInsertRowid) as ProxyPreset
}

export function updateProxyPreset(id: number, data: ProxyPresetInput): void {
  getDb()
    .prepare(
      'UPDATE proxy_presets SET name=?, type=?, host=?, port=?, username=?, password=? WHERE id=?'
    )
    .run(data.name, data.type, data.host, data.port, data.username ?? null, data.password ?? null, id)
}

export function deleteProxyPreset(id: number): void {
  getDb().prepare('DELETE FROM proxy_presets WHERE id=?').run(id)
}
