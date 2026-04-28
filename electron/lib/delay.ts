/**
 * 投稿前ディレイ — bot検知回避のための人間的な待機時間
 */

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 投稿前の基本ディレイ（2〜10秒） */
export async function prePostDelay(accountId: number): Promise<number> {
  const ms = Math.floor(Math.random() * 8000 + 2000)
  await sleep(ms)
  return ms
}

/** 文字数連動ディレイ — タイピング時間シミュレーション（上限30秒） */
export async function typingDelay(accountId: number, text: string): Promise<number> {
  const ms = Math.floor(Math.min(text.length * (50 + Math.random() * 100), 30000))
  if (ms > 0) await sleep(ms)
  return ms
}

/** メディアアップロード後 → configure 前のディレイ（1〜3秒） */
export async function mediaConfigureDelay(accountId: number): Promise<number> {
  const ms = Math.floor(Math.random() * 2000 + 1000)
  console.log(`[Delay] account=${accountId} mediaConfigure=${ms}ms`)
  await sleep(ms)
  return ms
}
