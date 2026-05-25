/**
 * Behavior Profile — account personality を seed から決定論的に生成
 *
 * behavior_seed がある新規垢のみ適用。
 * 既存垢（behavior_seed = null）は従来のランダム動作。
 */

import crypto from 'crypto'
import { getDb } from '../db'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ActivityRhythm {
  /** 活動パターン: 'morning' | 'daytime' | 'evening' | 'night' | 'latenight' */
  pattern: string
  /** 各時間帯 (0-23) の activity multiplier (0.0 ~ 1.0) */
  hourlyWeights: number[]
  /** 週末 bias: 1.0 = 平日と同じ、1.3 = 週末に1.3倍活動 */
  weekendBias: number
  /** 昼休み (12-13時) に activity boost するか */
  lunchBreakBoost: boolean
}

export interface BrowsingPersonality {
  /** scroll: 'fast' | 'moderate' | 'slow' | 'burst' */
  scrollType: string
  /** 平均スクロール速度 (px/s) */
  scrollSpeed: number
  /** スクロール間の micro pause (ms) */
  scrollPauseMs: number
  /** 投稿での平均滞在時間 (ms) */
  dwellTimeMs: number
  /** 一部投稿で長時間停止する確率 (0-1) */
  longDwellChance: number
  /** Reel 視聴: 'short' | 'moderate' | 'long' */
  reelAttention: string
  /** Reel 平均視聴秒数 */
  reelWatchSec: number
}

export interface BehaviorProfile {
  activity: ActivityRhythm
  browsing: BrowsingPersonality
  generatedAt: string
}

// ── Seeded RNG ───────────────────────────────────────────────────────────────

function createRng(seed: string, domain: string): () => number {
  const hash = crypto.createHmac('sha256', seed).update(domain).digest()
  let idx = 0
  return () => {
    if (idx + 4 > hash.length) idx = 0
    const val = hash.readUInt32BE(idx % (hash.length - 3))
    idx += 4
    return (val >>> 0) / 0x100000000
  }
}

function seededPick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}

// ── Activity Rhythm 生成 ─────────────────────────────────────────────────────

const ACTIVITY_PATTERNS = [
  { name: 'morning',   peakStart: 6,  peakEnd: 12, weight: 0.15 },
  { name: 'daytime',   peakStart: 9,  peakEnd: 18, weight: 0.25 },
  { name: 'evening',   peakStart: 17, peakEnd: 24, weight: 0.30 },
  { name: 'night',     peakStart: 20, peakEnd: 2,  weight: 0.20 },
  { name: 'latenight', peakStart: 22, peakEnd: 5,  weight: 0.10 },
]

function generateActivityRhythm(rng: () => number): ActivityRhythm {
  // 重み付き選択
  const totalWeight = ACTIVITY_PATTERNS.reduce((s, p) => s + p.weight, 0)
  let r = rng() * totalWeight
  let pattern = ACTIVITY_PATTERNS[0]
  for (const p of ACTIVITY_PATTERNS) {
    r -= p.weight
    if (r <= 0) { pattern = p; break }
  }

  // 各時間帯の activity weight を生成
  const hourlyWeights: number[] = []
  for (let h = 0; h < 24; h++) {
    const inPeak = pattern.peakEnd > pattern.peakStart
      ? (h >= pattern.peakStart && h < pattern.peakEnd)
      : (h >= pattern.peakStart || h < pattern.peakEnd)

    if (inPeak) {
      // peak 内: 0.6 ~ 1.0
      hourlyWeights.push(0.6 + rng() * 0.4)
    } else {
      // off-peak: 0.0 ~ 0.3
      hourlyWeights.push(rng() * 0.3)
    }
  }

  return {
    pattern: pattern.name,
    hourlyWeights,
    weekendBias: 0.8 + rng() * 0.6,       // 0.8 ~ 1.4
    lunchBreakBoost: rng() > 0.5,
  }
}

// ── Browsing Personality 生成 ─────────────────────────────────────────────────

const SCROLL_TYPES = [
  { type: 'fast',     speed: [800, 1200], pause: [200, 500],   weight: 0.20 },
  { type: 'moderate', speed: [400, 700],  pause: [500, 1200],  weight: 0.40 },
  { type: 'slow',     speed: [150, 350],  pause: [1000, 2500], weight: 0.25 },
  { type: 'burst',    speed: [600, 1500], pause: [100, 300],   weight: 0.15 },
]

const REEL_TYPES = [
  { type: 'short',    watchSec: [2, 6],   weight: 0.30 },
  { type: 'moderate', watchSec: [5, 15],  weight: 0.45 },
  { type: 'long',     watchSec: [12, 30], weight: 0.25 },
]

function generateBrowsingPersonality(rng: () => number): BrowsingPersonality {
  // scroll type
  const scrollTotal = SCROLL_TYPES.reduce((s, t) => s + t.weight, 0)
  let sr = rng() * scrollTotal
  let scroll = SCROLL_TYPES[0]
  for (const t of SCROLL_TYPES) {
    sr -= t.weight
    if (sr <= 0) { scroll = t; break }
  }

  // reel type
  const reelTotal = REEL_TYPES.reduce((s, t) => s + t.weight, 0)
  let rr = rng() * reelTotal
  let reel = REEL_TYPES[0]
  for (const t of REEL_TYPES) {
    rr -= t.weight
    if (rr <= 0) { reel = t; break }
  }

  const lerp = (min: number, max: number) => min + rng() * (max - min)

  return {
    scrollType: scroll.type,
    scrollSpeed: Math.round(lerp(scroll.speed[0], scroll.speed[1])),
    scrollPauseMs: Math.round(lerp(scroll.pause[0], scroll.pause[1])),
    dwellTimeMs: Math.round(lerp(1500, 8000)),
    longDwellChance: 0.05 + rng() * 0.15,  // 5% ~ 20%
    reelAttention: reel.type,
    reelWatchSec: Math.round(lerp(reel.watchSec[0], reel.watchSec[1])),
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * behavior_seed から BehaviorProfile を生成して DB に保存する。
 * seed がなければ null を返す（既存垢は従来のランダム動作）。
 */
export function loadOrCreateBehaviorProfile(accountId: number): BehaviorProfile | null {
  const db = getDb()
  const row = db.prepare('SELECT behavior_seed, behavior_profile FROM accounts WHERE id = ?').get(accountId) as {
    behavior_seed: string | null
    behavior_profile: string | null
  } | undefined

  if (!row?.behavior_seed) return null

  // 既に生成済みならキャッシュを返す
  if (row.behavior_profile) {
    try {
      return JSON.parse(row.behavior_profile) as BehaviorProfile
    } catch { /* 破損時は再生成 */ }
  }

  // seed から生成
  const activityRng = createRng(row.behavior_seed, 'activity')
  const browsingRng = createRng(row.behavior_seed, 'browsing')

  const profile: BehaviorProfile = {
    activity: generateActivityRhythm(activityRng),
    browsing: generateBrowsingPersonality(browsingRng),
    generatedAt: new Date().toISOString(),
  }

  db.prepare('UPDATE accounts SET behavior_profile = ? WHERE id = ?')
    .run(JSON.stringify(profile), accountId)

  return profile
}

/**
 * 現在時刻での activity multiplier を取得する。
 * behavior_seed がない垢は常に 1.0 を返す。
 */
export function getActivityMultiplier(accountId: number): number {
  const profile = loadOrCreateBehaviorProfile(accountId)
  if (!profile) return 1.0

  const now = new Date()
  const hour = now.getHours()
  const isWeekend = now.getDay() === 0 || now.getDay() === 6

  let multiplier = profile.activity.hourlyWeights[hour] ?? 0.5

  // 週末 bias
  if (isWeekend) multiplier *= profile.activity.weekendBias

  // 昼休み boost (12-13時)
  if (profile.activity.lunchBreakBoost && hour >= 12 && hour < 13) {
    multiplier = Math.min(1.0, multiplier + 0.3)
  }

  return Math.max(0.0, Math.min(1.0, multiplier))
}

/**
 * activity multiplier が閾値未満ならスキップすべきか判定する。
 * 閾値のデフォルトは 0.15（ほぼ睡眠時間帯のみスキップ）。
 */
export function shouldSkipForInactiveHours(accountId: number, threshold = 0.15): boolean {
  const multiplier = getActivityMultiplier(accountId)
  return multiplier < threshold
}

/**
 * browsing personality に基づいた timing パラメータを取得する。
 * behavior_seed がない垢はデフォルト値を返す。
 */
export function getBrowsingParams(accountId: number): BrowsingPersonality {
  const profile = loadOrCreateBehaviorProfile(accountId)
  if (!profile) {
    // 既存垢のデフォルト
    return {
      scrollType: 'moderate',
      scrollSpeed: 500,
      scrollPauseMs: 800,
      dwellTimeMs: 3000,
      longDwellChance: 0.10,
      reelAttention: 'moderate',
      reelWatchSec: 10,
    }
  }
  return profile.browsing
}
