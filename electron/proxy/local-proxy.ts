/**
 * local-proxy.ts
 *
 * アカウントごとに localhost 上に HTTP プロキシサーバーを立て、
 * 実際の上流プロキシ（Decodo 等）へ認証付きで転送する。
 *
 * Electron の session.setProxy には資格情報なしの localhost:PORT を渡し、
 * 上流への Proxy-Authorization は本モジュールが自動付与する。
 * これにより view-manager.ts や login イベントを一切変更しなくて済む。
 */

import http  from 'http'
import net   from 'net'
import { Buffer } from 'buffer'

export interface UpstreamProxy {
  host:     string
  port:     number
  username: string
  password: string
}

export interface LocalProxyServer {
  localPort: number
  close:     () => void
}

/** proxyRules 文字列（"http://host:port" 等）からホスト・ポートを取り出す */
export function parseUpstream(proxyRules: string): { host: string; port: number } | null {
  const m = proxyRules.match(/^(?:https?|socks5):\/\/([^:/]+):(\d+)/)
  if (!m) return null
  return { host: m[1], port: parseInt(m[2], 10) }
}

/**
 * localhost:localPort で HTTP/HTTPS(CONNECT) プロキシを起動する。
 * CONNECT トンネルは上流プロキシに Proxy-Authorization を付けて転送する。
 */
export function startLocalProxy(upstream: UpstreamProxy, localPort: number): Promise<LocalProxyServer> {
  const authHeader = 'Basic ' + Buffer.from(`${upstream.username}:${upstream.password}`).toString('base64')

  const server = http.createServer((req, res) => {
    // 平文 HTTP リクエストの転送（通常 Threads では使われないが念のため）
    const options: http.RequestOptions = {
      host:    upstream.host,
      port:    upstream.port,
      path:    req.url,
      method:  req.method,
      headers: { ...req.headers, 'Proxy-Authorization': authHeader },
    }
    const proxy = http.request(options, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers)
      upRes.pipe(res)
    })
    proxy.on('error', () => { try { res.destroy() } catch { /* ok */ } })
    req.pipe(proxy)
  })

  // HTTPS CONNECT トンネル
  server.on('connect', (req, clientSocket, head) => {
    const upSocket = net.connect(upstream.port, upstream.host, () => {
      // 上流プロキシに CONNECT + 認証を送る
      upSocket.write(
        `CONNECT ${req.url} HTTP/1.1\r\n` +
        `Host: ${req.url}\r\n` +
        `Proxy-Authorization: ${authHeader}\r\n` +
        `Proxy-Connection: Keep-Alive\r\n` +
        `\r\n`
      )
    })

    // 上流の応答を読んで 200 なら Electron にも 200 を返してパイプ
    let buf = ''
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('binary')
      const headerEnd = buf.indexOf('\r\n\r\n')
      if (headerEnd === -1) return          // まだヘッダー未着
      upSocket.removeListener('data', onData)

      if (/^HTTP\/1\.[01] 2/.test(buf)) {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        // CONNECT 応答の後ろにデータが続いている場合は流す
        const rest = Buffer.from(buf.slice(headerEnd + 4), 'binary')
        if (rest.length) clientSocket.write(rest)
        if (head.length) upSocket.write(head)
        upSocket.pipe(clientSocket)
        clientSocket.pipe(upSocket)
      } else {
        clientSocket.destroy()
        upSocket.destroy()
      }
    }

    upSocket.on('data', onData)
    upSocket.on('error', () => { try { clientSocket.destroy() } catch { /* ok */ } })
    clientSocket.on('error', () => { try { upSocket.destroy() } catch { /* ok */ } })
  })

  return new Promise((resolve, reject) => {
    server.listen(localPort, '127.0.0.1', () => {
      resolve({ localPort, close: () => server.close() })
    })
    server.on('error', reject)
  })
}
