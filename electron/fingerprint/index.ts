import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export interface Fingerprint {
  userAgent: string
  platform: string
  screenWidth: number
  screenHeight: number
  timezone: string
  language: string
  languages: string[]
  hardwareConcurrency: number
  deviceMemory: number
  webglVendor: string
  webglRenderer: string
  canvasSeed: number
}

// ── Seeded LCG random ────────────────────────────────────────────────────────

function seededRng(seed: number) {
  let s = (seed ^ 0xdeadbeef) >>> 0
  return (): number => {
    s = Math.imul(s ^ (s >>> 15), s | 1)
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61)
    return ((s ^ (s >>> 14)) >>> 0) / 0xffffffff
  }
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}

// ── Fingerprint pools ────────────────────────────────────────────────────────

const UA_MAC = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]
const UA_WIN = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

const SCREEN_SIZES: [number, number][] = [
  [1920, 1080], [1680, 1050], [1440, 900], [1536, 864],
  [2560, 1440], [1280, 800],  [1366, 768], [2560, 1600],
]

const TIMEZONES = [
  'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore',
  'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris',
]

const LANG_CONFIGS = [
  { language: 'ja-JP', languages: ['ja-JP', 'ja', 'en-US', 'en'] },
  { language: 'ko-KR', languages: ['ko-KR', 'ko', 'en-US', 'en'] },
  { language: 'en-US', languages: ['en-US', 'en'] },
  { language: 'zh-CN', languages: ['zh-CN', 'zh', 'en-US', 'en'] },
  { language: 'en-GB', languages: ['en-GB', 'en'] },
]

const WEBGL_CONFIGS = [
  { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.6)' },
  { vendor: 'Google Inc. (Apple)',  renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' },
  { vendor: 'Google Inc. (AMD)',    renderer: 'ANGLE (AMD, AMD Radeon RX 6600M, OpenGL 4.6)' },
  { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.6)' },
]

const HW_CONFIGS = [
  { concurrency: 4,  memory: 8  },
  { concurrency: 8,  memory: 16 },
  { concurrency: 6,  memory: 8  },
  { concurrency: 12, memory: 32 },
  { concurrency: 16, memory: 16 },
]

// ── Generator ────────────────────────────────────────────────────────────────

export function generateFingerprint(accountId: number): Fingerprint {
  const rng = seededRng(accountId * 2654435761 + 12345)

  const useMac = rng() > 0.4
  const ua = pick(useMac ? UA_MAC : UA_WIN, rng)
  const platform = useMac ? 'MacIntel' : 'Win32'
  const [screenWidth, screenHeight] = pick(SCREEN_SIZES, rng)
  const lang = pick(LANG_CONFIGS, rng)
  const webgl = pick(WEBGL_CONFIGS, rng)
  const hw = pick(HW_CONFIGS, rng)
  const timezone = pick(TIMEZONES, rng)
  const canvasSeed = Math.floor(rng() * 65536)

  return {
    userAgent: ua,
    platform,
    screenWidth,
    screenHeight,
    timezone,
    language: lang.language,
    languages: lang.languages,
    hardwareConcurrency: hw.concurrency,
    deviceMemory: hw.memory,
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer,
    canvasSeed,
  }
}

// ── JS override code (injected into main world) ───────────────────────────────

export function buildOverrideScript(fp: Fingerprint): string {
  return `(function() {
  try {
    const _def = (obj, prop, val) => {
      try { Object.defineProperty(obj, prop, { get: () => val, configurable: true }) } catch(e) {}
    }

    // ── navigator ──
    _def(navigator, 'userAgent',          ${JSON.stringify(fp.userAgent)})
    _def(navigator, 'platform',           ${JSON.stringify(fp.platform)})
    _def(navigator, 'language',           ${JSON.stringify(fp.language)})
    _def(navigator, 'languages',          Object.freeze(${JSON.stringify(fp.languages)}))
    _def(navigator, 'hardwareConcurrency', ${fp.hardwareConcurrency})
    _def(navigator, 'deviceMemory',       ${fp.deviceMemory})

    // ── screen ──
    _def(screen, 'width',       ${fp.screenWidth})
    _def(screen, 'height',      ${fp.screenHeight})
    _def(screen, 'availWidth',  ${fp.screenWidth})
    _def(screen, 'availHeight', ${fp.screenHeight - 40})
    _def(screen, 'colorDepth',  24)
    _def(screen, 'pixelDepth',  24)

    // ── Canvas noise (via getImageData) ──
    const _SEED = ${fp.canvasSeed}
    const _origGet = CanvasRenderingContext2D.prototype.getImageData
    CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
      const d = _origGet.call(this, x, y, w, h)
      for (let i = 0; i < d.data.length; i += 128) {
        d.data[i] ^= (_SEED >> (i % 16)) & 1
      }
      return d
    }

    // ── WebGL vendor / renderer ──
    const _patchGL = (Ctx) => {
      if (!Ctx) return
      const orig = Ctx.prototype.getParameter
      Ctx.prototype.getParameter = function(p) {
        if (p === 37445) return ${JSON.stringify(fp.webglVendor)}
        if (p === 37446) return ${JSON.stringify(fp.webglRenderer)}
        return orig.call(this, p)
      }
    }
    _patchGL(WebGLRenderingContext)
    if (typeof WebGL2RenderingContext !== 'undefined') _patchGL(WebGL2RenderingContext)

  } catch(e) {}
})()`
}

// ── Preload script file (written per account, loaded by Electron session) ─────

export function writeAccountPreload(accountId: number): string {
  const fp = generateFingerprint(accountId)
  const overrideCode = buildOverrideScript(fp)

  // The preload runs in the isolated world. Use webFrame.executeJavaScript
  // to inject overrides into the main world before page scripts run.
  const preloadContent = `
;(function() {
  const { webFrame } = require('electron')
  webFrame.executeJavaScript(${JSON.stringify(overrideCode)})
})()
`
  const dir = path.join(app.getPath('userData'), 'fingerprints')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `account-${accountId}.js`)
  fs.writeFileSync(filePath, preloadContent, 'utf8')
  return filePath
}
