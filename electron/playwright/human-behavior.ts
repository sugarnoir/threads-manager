import { Page } from 'playwright'

export type SpeedPreset = 'slow' | 'normal' | 'fast'

export interface SpeedConfig {
  minDelay:    number  // ms — 操作間の最小待機
  maxDelay:    number  // ms — 操作間の最大待機
  typeMinMs:   number  // ms — タイピング1文字あたりの最小遅延
  typeMaxMs:   number  // ms — タイピング1文字あたりの最大遅延
  scrollChance: number // 0〜1 — スクロールを行う確率
}

export const SPEED_PRESETS: Record<SpeedPreset, SpeedConfig> = {
  slow:   { minDelay: 1500, maxDelay: 3000, typeMinMs: 80,  typeMaxMs: 220, scrollChance: 0.7 },
  normal: { minDelay: 700,  maxDelay: 2000, typeMinMs: 35,  typeMaxMs: 110, scrollChance: 0.5 },
  fast:   { minDelay: 300,  maxDelay: 800,  typeMinMs: 12,  typeMaxMs: 40,  scrollChance: 0.3 },
}

/** 整数乱数 [min, max] */
export function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** ランダム遅延 */
export async function randomDelay(page: Page, config: SpeedConfig): Promise<void> {
  await page.waitForTimeout(rand(config.minDelay, config.maxDelay))
}

/** 短めのランダム遅延（クリック直後など） */
export async function shortDelay(page: Page, config: SpeedConfig): Promise<void> {
  await page.waitForTimeout(rand(Math.floor(config.minDelay * 0.4), Math.floor(config.maxDelay * 0.6)))
}

/**
 * 人間らしいタイピング — 1文字ずつランダムな間隔で入力する。
 * Playwright の fill() は即座に全文字を埋めるため、文字単位の keyboard.type を使う。
 */
export async function humanType(page: Page, text: string, config: SpeedConfig): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char)
    await page.waitForTimeout(rand(config.typeMinMs, config.typeMaxMs))
    // 稀に少し長めの「考え中」ポーズを入れる
    if (Math.random() < 0.05) {
      await page.waitForTimeout(rand(300, 900))
    }
  }
}

/**
 * ランダムなスクロール操作。
 * 確率的にスキップし、方向・量ともにランダムにする。
 */
export async function randomScroll(page: Page, config: SpeedConfig): Promise<void> {
  if (Math.random() > config.scrollChance) return

  const deltaY = rand(80, 350) * (Math.random() > 0.3 ? 1 : -1)  // 70% 下スクロール
  await page.mouse.wheel(0, deltaY)
  await page.waitForTimeout(rand(400, 1000))

  // 稀にもう1回スクロール
  if (Math.random() < 0.3) {
    await page.mouse.wheel(0, rand(50, 200) * (Math.random() > 0.5 ? 1 : -1))
    await page.waitForTimeout(rand(300, 700))
  }
}
