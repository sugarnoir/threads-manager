/**
 * HTTP/HTTPS 画像 URL を一時ファイルにダウンロードし、ローカルパスを返す。
 * file:// URL とローカルパスはそのまま返す。
 * 使い終わったら cleanup() を呼んで一時ファイルを削除する。
 */

import { net } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

export interface ResolvedImages {
  paths:   string[]
  cleanup: () => void
}

function downloadToTemp(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const ext     = url.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpg'
    const tmpPath = path.join(os.tmpdir(), `ig_img_${crypto.randomBytes(8).toString('hex')}.${ext}`)
    const req     = net.request({ method: 'GET', url })
    const chunks: Buffer[] = []

    req.on('response', (resp) => {
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        console.warn(`[downloadToTemp] HTTP ${resp.statusCode} for ${url}`)
        resolve(null)
        return
      }
      resp.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      resp.on('end', () => {
        try {
          fs.writeFileSync(tmpPath, Buffer.concat(chunks))
          resolve(tmpPath)
        } catch (e) {
          console.warn(`[downloadToTemp] write error: ${e instanceof Error ? e.message : String(e)}`)
          resolve(null)
        }
      })
    })
    req.on('error', (e) => {
      console.warn(`[downloadToTemp] request error ${url}: ${e instanceof Error ? e.message : String(e)}`)
      resolve(null)
    })
    req.end()
  })
}

/**
 * image_url / image_url_2 の配列を受け取り、ローカルファイルパスの配列に解決する。
 * HTTP(S) URL は一時ファイルへダウンロードされる。
 */
export async function resolveImagePaths(
  urls: (string | null | undefined)[],
): Promise<ResolvedImages> {
  const tmpFiles: string[] = []
  const paths: string[] = []

  for (const raw of urls) {
    if (!raw) continue

    // file:// → パスに変換（日本語等を含む場合は decodeURIComponent が必要）
    let p = raw
    if (p.startsWith('file://')) {
      try { p = decodeURIComponent(new URL(p).pathname) } catch { /* ignore */ }
    }

    if (p.startsWith('http://') || p.startsWith('https://')) {
      // HTTP(S) → 一時ファイルにダウンロード
      const tmp = await downloadToTemp(p)
      if (tmp) { tmpFiles.push(tmp); paths.push(tmp) }
      else console.warn(`[resolveImagePaths] failed to download: ${p}`)
    } else if (fs.existsSync(p)) {
      paths.push(p)
    }
  }

  return {
    paths,
    cleanup: () => {
      for (const f of tmpFiles) {
        try { fs.unlinkSync(f) } catch { /* ignore */ }
      }
    },
  }
}
