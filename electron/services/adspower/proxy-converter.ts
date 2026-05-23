/**
 * TM プロキシ → AdsPower proxy_config 変換
 *
 * TM の accounts テーブル: proxy_url (e.g. "http://host:port"), proxy_username, proxy_password
 * AdsPower: proxy_soft, proxy_type, proxy_host, proxy_port, proxy_user, proxy_password
 */

import { type AdsPowerProxyConfig } from './client'

export function convertTMProxyToAdsPower(
  proxyUrl: string | null,
  proxyUsername: string | null,
  proxyPassword: string | null,
): AdsPowerProxyConfig {
  if (!proxyUrl) {
    return {
      proxy_soft: 'no_proxy',
      proxy_type: '',
      proxy_host: '',
      proxy_port: '',
      proxy_user: '',
      proxy_password: '',
    }
  }

  let url = proxyUrl.trim()
  // プレフィックスがなければ http:// を補完
  if (!/^https?:\/\/|^socks5?:\/\//i.test(url)) {
    url = 'http://' + url
  }

  let proxyType = 'http'
  if (/^socks5/i.test(url)) proxyType = 'socks5'
  else if (/^https/i.test(url)) proxyType = 'https'

  // URL パースで host:port を取得
  try {
    const parsed = new URL(url)
    return {
      proxy_soft: 'other',
      proxy_type: proxyType,
      proxy_host: parsed.hostname,
      proxy_port: parsed.port || (proxyType === 'https' ? '443' : '80'),
      proxy_user: proxyUsername || parsed.username || '',
      proxy_password: proxyPassword || parsed.password || '',
    }
  } catch {
    // URL パースに失敗した場合、直接パース
    const noScheme = url.replace(/^[a-z]+:\/\//i, '')
    const [hostPort] = noScheme.split('/')
    const [host, port] = hostPort.split(':')
    return {
      proxy_soft: 'other',
      proxy_type: proxyType,
      proxy_host: host || '',
      proxy_port: port || '80',
      proxy_user: proxyUsername || '',
      proxy_password: proxyPassword || '',
    }
  }
}
