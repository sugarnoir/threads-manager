import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { getAccountFingerprint, setAccountFingerprint } from '../db/repositories/accounts'

export interface Fingerprint {
  userAgent: string
  platform: string
  vendor: string
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
  batteryLevel:    number
  batteryCharging: boolean
  audioSeed:       number
  fontList:        string[]
}

// ── Fingerprint pools ─────────────────────────────────────────────────────────

const UA_CHROME_MAC = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

const UA_CHROME_WIN = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

const UA_CHROME_LINUX = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

const UA_FIREFOX_WIN = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
]

const UA_FIREFOX_MAC = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13.6; rv:124.0) Gecko/20100101 Firefox/124.0',
]

// { userAgent, platform, vendor, isFirefox }
interface UaProfile {
  userAgent: string
  platform:  string
  vendor:    string
  isFirefox: boolean
}

const UA_POOL: UaProfile[] = [
  ...UA_CHROME_MAC.map(ua   => ({ userAgent: ua, platform: 'MacIntel',   vendor: 'Google Inc.', isFirefox: false })),
  ...UA_CHROME_WIN.map(ua   => ({ userAgent: ua, platform: 'Win32',      vendor: 'Google Inc.', isFirefox: false })),
  ...UA_CHROME_LINUX.map(ua => ({ userAgent: ua, platform: 'Linux x86_64', vendor: 'Google Inc.', isFirefox: false })),
  ...UA_FIREFOX_WIN.map(ua  => ({ userAgent: ua, platform: 'Win32',      vendor: '',             isFirefox: true  })),
  ...UA_FIREFOX_MAC.map(ua  => ({ userAgent: ua, platform: 'MacIntel',   vendor: '',             isFirefox: true  })),
]

const SCREEN_SIZES: [number, number][] = [
  [1920, 1080], [1680, 1050], [1440, 900],  [1536, 864],
  [2560, 1440], [1280, 800],  [1366, 768],  [2560, 1600],
  [1600, 900],  [1280, 1024], [1024, 768],
]

const TIMEZONES = [
  'Asia/Tokyo',        // UTC+9
  'Asia/Seoul',        // UTC+9
  'Asia/Shanghai',     // UTC+8
  'Asia/Singapore',    // UTC+8
  'America/New_York',  // UTC-5/-4
  'America/Los_Angeles', // UTC-8/-7
  'America/Chicago',   // UTC-6/-5
  'Europe/London',     // UTC+0/+1
  'Europe/Paris',      // UTC+1/+2
  'Europe/Berlin',     // UTC+1/+2
  'Australia/Sydney',  // UTC+10/+11
]

// timezone → UTC offset in minutes (standard time, for getTimezoneOffset override)
const TZ_OFFSET: Record<string, number> = {
  'Asia/Tokyo':           -540,
  'Asia/Seoul':           -540,
  'Asia/Shanghai':        -480,
  'Asia/Singapore':       -480,
  'America/New_York':      300,
  'America/Los_Angeles':   480,
  'America/Chicago':       360,
  'Europe/London':           0,
  'Europe/Paris':           -60,
  'Europe/Berlin':          -60,
  'Australia/Sydney':      -600,
}

const LANG_CONFIGS = [
  { language: 'ja-JP', languages: ['ja-JP', 'ja', 'en-US', 'en'] },
]

const WEBGL_CONFIGS = [
  { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.6)' },
  { vendor: 'Google Inc. (Apple)',  renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' },
  { vendor: 'Google Inc. (AMD)',    renderer: 'ANGLE (AMD, AMD Radeon RX 6600M, OpenGL 4.6)' },
  { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.6)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti, OpenGL 4.6)' },
]

const HW_CONFIGS = [
  { concurrency:  2, memory: 2 },
  { concurrency:  4, memory: 4 },
  { concurrency:  4, memory: 8 },
  { concurrency:  8, memory: 4 },
  { concurrency:  8, memory: 8 },
  { concurrency: 16, memory: 8 },
]

const BATTERY_CONFIGS = [
  { level: 0.30, charging: false },
  { level: 0.45, charging: false },
  { level: 0.60, charging: true  },
  { level: 0.75, charging: false },
  { level: 0.85, charging: true  },
  { level: 1.00, charging: true  },
]

// Common system fonts (base set always present)
const FONT_BASE = [
  'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
  'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana',
]

// Optional fonts (subset picked per account for variation)
const FONT_EXTRAS = [
  'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia',
  'Corbel', 'Franklin Gothic Medium', 'Garamond', 'Gill Sans',
  'Helvetica', 'Lucida Console', 'Lucida Sans Unicode',
  'Microsoft Sans Serif', 'Palatino Linotype', 'Tahoma',
  'Century Gothic', 'Book Antiqua', 'Bookman Old Style',
]

// ── Random helper ─────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Generator (true random, not seeded) ──────────────────────────────────────

function generateFingerprint(): Fingerprint {
  const ua      = pick(UA_POOL)
  const size    = pick(SCREEN_SIZES)
  const lang    = pick(LANG_CONFIGS)
  const webgl   = pick(WEBGL_CONFIGS)
  const hw      = pick(HW_CONFIGS)
  const tz      = pick(TIMEZONES)
  const battery = pick(BATTERY_CONFIGS)
  const canvasSeed = Math.floor(Math.random() * 65536)
  const audioSeed  = Math.floor(Math.random() * 65536)

  // Pick a random subset of extra fonts (5–10 fonts) to add to base fonts
  const shuffledExtras = [...FONT_EXTRAS].sort(() => Math.random() - 0.5)
  const extraCount = 5 + Math.floor(Math.random() * 6) // 5–10
  const fontList = [...FONT_BASE, ...shuffledExtras.slice(0, extraCount)]

  return {
    userAgent:           ua.userAgent,
    platform:            ua.platform,
    vendor:              ua.vendor,
    screenWidth:         size[0],
    screenHeight:        size[1],
    timezone:            tz,
    language:            lang.language,
    languages:           lang.languages,
    hardwareConcurrency: hw.concurrency,
    deviceMemory:        hw.memory,
    webglVendor:         webgl.vendor,
    webglRenderer:       webgl.renderer,
    canvasSeed,
    batteryLevel:        battery.level,
    batteryCharging:     battery.charging,
    audioSeed,
    fontList,
  }
}

// ── DB-backed loader (accounts.fingerprint カラムに保存) ─────────────────────
//
// 一度保存されたフィンガープリントは変更しない。
// ブラウザを開くたびに同じフィンガープリントが適用される。

export function loadOrCreateFingerprint(accountId: number): Fingerprint {
  const stored = getAccountFingerprint(accountId)
  if (stored) {
    try {
      return JSON.parse(stored) as Fingerprint
    } catch { /* JSON 破損時は再生成 */ }
  }
  // 未保存のアカウント（既存アカウントの後方互換）は初回起動時に生成して固定
  const fp = generateFingerprint()
  setAccountFingerprint(accountId, JSON.stringify(fp))
  return fp
}

/** アカウント作成直後に呼んでフィンガープリントを固定する */
export function createAndSaveFingerprint(accountId: number): Fingerprint {
  const fp = generateFingerprint()
  setAccountFingerprint(accountId, JSON.stringify(fp))
  return fp
}

// ── JS override code (injected into main world) ───────────────────────────────

export function buildOverrideScript(fp: Fingerprint): string {
  const tzOffset = TZ_OFFSET[fp.timezone] ?? 0

  // Battery chargingTime / dischargingTime を事前計算
  const chargingTime = fp.batteryCharging
    ? (fp.batteryLevel < 1.0 ? Math.round((1 - fp.batteryLevel) * 4800) : 0)
    : Infinity
  const dischargingTime = fp.batteryCharging
    ? Infinity
    : Math.round(fp.batteryLevel * 18000)
  const chargingTimeStr    = chargingTime    === Infinity ? 'Infinity' : String(chargingTime)
  const dischargingTimeStr = dischargingTime === Infinity ? 'Infinity' : String(dischargingTime)

  return `(function() {
  try {
    const _def = (obj, prop, val) => {
      try { Object.defineProperty(obj, prop, { get: () => val, configurable: true }) } catch(e) {}
    }

    // ── navigator ──
    _def(navigator, 'userAgent',           ${JSON.stringify(fp.userAgent)})
    _def(navigator, 'platform',            ${JSON.stringify(fp.platform)})
    _def(navigator, 'vendor',              ${JSON.stringify(fp.vendor)})
    _def(navigator, 'language',            ${JSON.stringify(fp.language)})
    _def(navigator, 'languages',           Object.freeze(${JSON.stringify(fp.languages)}))
    _def(navigator, 'hardwareConcurrency', ${fp.hardwareConcurrency})
    _def(navigator, 'deviceMemory',        ${fp.deviceMemory})
    _def(navigator, 'plugins',             Object.freeze([]))
    _def(navigator, 'mimeTypes',           Object.freeze([]))
    _def(navigator, 'webdriver',           false)
    _def(navigator, 'appCodeName',         'Mozilla')
    _def(navigator, 'appName',             'Netscape')
    _def(navigator, 'product',             'Gecko')
    _def(navigator, 'productSub',          '20030107')

    // ── screen ──
    _def(screen, 'width',       ${fp.screenWidth})
    _def(screen, 'height',      ${fp.screenHeight})
    _def(screen, 'availWidth',  ${fp.screenWidth})
    _def(screen, 'availHeight', ${fp.screenHeight - 40})
    _def(screen, 'colorDepth',  24)
    _def(screen, 'pixelDepth',  24)

    // ── timezone: Intl.DateTimeFormat を差し替えてタイムゾーンを固定 ──
    const _OrigDTF = Intl.DateTimeFormat
    function _FakeDTF(locale, opts) {
      opts = Object.assign({}, opts || {})
      if (!opts.timeZone) opts.timeZone = ${JSON.stringify(fp.timezone)}
      return new _OrigDTF(locale, opts)
    }
    _FakeDTF.prototype             = _OrigDTF.prototype
    _FakeDTF.supportedLocalesOf    = _OrigDTF.supportedLocalesOf.bind(_OrigDTF)
    Object.defineProperty(Intl, 'DateTimeFormat', { value: _FakeDTF, configurable: true, writable: true })

    // ── Date.prototype.getTimezoneOffset (標準時オフセット固定) ──
    const _OrigGetTZO = Date.prototype.getTimezoneOffset
    Date.prototype.getTimezoneOffset = function() { return ${tzOffset} }
    void _OrigGetTZO // keep reference to avoid lint warning

    // ── Canvas noise (via getImageData, toDataURL, toBlob) ──
    const _SEED = ${fp.canvasSeed}
    const _origGet = CanvasRenderingContext2D.prototype.getImageData
    CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
      const d = _origGet.call(this, x, y, w, h)
      for (let i = 0; i < d.data.length; i += 128) {
        d.data[i] ^= (_SEED >> (i % 16)) & 1
      }
      return d
    }
    const _applyCanvasNoise = function(canvas) {
      const ctx2d = canvas.getContext('2d')
      if (!ctx2d || canvas.width <= 0 || canvas.height <= 0 || canvas.width * canvas.height > 50000) return null
      try {
        const orig = _origGet.call(ctx2d, 0, 0, canvas.width, canvas.height)
        const noisy = new ImageData(new Uint8ClampedArray(orig.data), canvas.width, canvas.height)
        for (let i = 0; i < noisy.data.length; i += 128) { noisy.data[i] ^= (_SEED >> (i % 16)) & 1 }
        ctx2d.putImageData(noisy, 0, 0)
        return function() { ctx2d.putImageData(orig, 0, 0) }
      } catch(e) { return null }
    }
    const _origToDataURL = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      const restore = _applyCanvasNoise(this)
      const url = _origToDataURL.apply(this, args)
      if (restore) restore()
      return url
    }
    const _origToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      const restore = _applyCanvasNoise(this)
      _origToBlob.call(this, function(blob) {
        if (restore) restore()
        callback(blob)
      }, ...args)
    }

    // ── WebGL vendor / renderer / extensions ──
    const _GL_EXTS_ALL = [
      'ANGLE_instanced_arrays','EXT_blend_minmax','EXT_clip_control','EXT_color_buffer_float',
      'EXT_color_buffer_half_float','EXT_disjoint_timer_query','EXT_float_blend',
      'EXT_frag_depth','EXT_polygon_offset_clamp','EXT_shader_texture_lod',
      'EXT_texture_compression_bptc','EXT_texture_compression_rgtc',
      'EXT_texture_filter_anisotropic','EXT_texture_mirror_clamp_to_edge','EXT_texture_norm16',
      'KHR_parallel_shader_compile','OES_draw_buffers_indexed','OES_element_index_uint',
      'OES_fbo_render_mipmap','OES_standard_derivatives','OES_texture_float',
      'OES_texture_float_linear','OES_texture_half_float','OES_texture_half_float_linear',
      'OES_vertex_array_object','WEBGL_clip_cull_distance','WEBGL_color_buffer_float',
      'WEBGL_compressed_texture_astc','WEBGL_compressed_texture_etc','WEBGL_compressed_texture_etc1',
      'WEBGL_compressed_texture_pvrtc','WEBGL_compressed_texture_s3tc',
      'WEBGL_compressed_texture_s3tc_srgb','WEBGL_debug_renderer_info',
      'WEBGL_debug_shaders','WEBGL_depth_texture','WEBGL_draw_buffers',
      'WEBGL_draw_instanced_base_vertex_base_instance','WEBGL_lose_context',
      'WEBGL_multi_draw','WEBGL_multi_draw_instanced_base_vertex_base_instance',
      'WEBGL_polygon_mode','WEBGL_provoking_vertex','WEBGL_stencil_texturing',
    ]
    // Seeded LCG to pick a deterministic subset of extensions
    let _lcg = ${fp.canvasSeed} | 1
    const _lcgNext = () => { _lcg = (_lcg * 1664525 + 1013904223) >>> 0; return _lcg }
    // Keep ~70-85% of extensions for realistic variation
    const _GL_EXTS = _GL_EXTS_ALL.filter(() => (_lcgNext() % 100) < 80)
    const _patchGL = (Ctx) => {
      if (!Ctx) return
      const orig = Ctx.prototype.getParameter
      Ctx.prototype.getParameter = function(p) {
        if (p === 37445) return ${JSON.stringify(fp.webglVendor)}
        if (p === 37446) return ${JSON.stringify(fp.webglRenderer)}
        return orig.call(this, p)
      }
      Ctx.prototype.getSupportedExtensions = function() { return _GL_EXTS.slice() }
      const origGetExt = Ctx.prototype.getExtension
      Ctx.prototype.getExtension = function(name) {
        if (!_GL_EXTS.includes(name)) return null
        return origGetExt.call(this, name)
      }
    }
    _patchGL(WebGLRenderingContext)
    if (typeof WebGL2RenderingContext !== 'undefined') _patchGL(WebGL2RenderingContext)

    // ── Battery API ──
    try {
      if (typeof navigator.getBattery === 'function') {
        const _batt = {
          charging:         ${fp.batteryCharging},
          chargingTime:     ${chargingTimeStr},
          dischargingTime:  ${dischargingTimeStr},
          level:            ${fp.batteryLevel},
          addEventListener:    function() {},
          removeEventListener: function() {},
          dispatchEvent:       function() { return true },
        }
        Object.defineProperty(navigator, 'getBattery', {
          get: () => () => Promise.resolve(_batt),
          configurable: true,
        })
      }
    } catch(e) {}

    // ── WebRTC IP leak prevention (JS レベル) ──
    // ICE サーバーを空にし、iceTransportPolicy を relay 限定にすることで
    // STUN による IP 探索と host candidate (LAN IP) 漏洩を防ぐ
    try {
      if (typeof RTCPeerConnection !== 'undefined') {
        const _OrigRTC = RTCPeerConnection
        function _SafeRTC(config, constraints) {
          const cfg = config ? Object.assign({}, config) : {}
          cfg.iceServers = []
          cfg.iceTransportPolicy = 'relay'
          const pc = new _OrigRTC(cfg, constraints)
          // onicecandidate を監視して host/srflx candidate をドロップ
          const _origAddEventListener = pc.addEventListener.bind(pc)
          pc.addEventListener = function(type, listener, options) {
            if (type === 'icecandidate') {
              const wrapped = function(e) {
                if (e.candidate && e.candidate.candidate &&
                    /typ (host|srflx)/.test(e.candidate.candidate)) return
                listener.call(this, e)
              }
              return _origAddEventListener(type, wrapped, options)
            }
            return _origAddEventListener(type, listener, options)
          }
          return pc
        }
        _SafeRTC.prototype = _OrigRTC.prototype
        Object.defineProperty(window, 'RTCPeerConnection', { value: _SafeRTC, configurable: true, writable: true })
      }
    } catch(e) {}

    // ── AudioContext noise ──
    try {
      const _AUDIO_SEED = ${fp.audioSeed}
      const _noiseVal = (_AUDIO_SEED % 100) * 1e-8
      if (typeof AudioBuffer !== 'undefined') {
        const _origGetCh = AudioBuffer.prototype.getChannelData
        AudioBuffer.prototype.getChannelData = function(ch) {
          const data = _origGetCh.call(this, ch)
          for (let i = 0; i < data.length; i += 100) {
            data[i] = Math.max(-1, Math.min(1, data[i] + _noiseVal))
          }
          return data
        }
      }
      if (typeof AnalyserNode !== 'undefined') {
        const _origGFFD = AnalyserNode.prototype.getFloatFrequencyData
        AnalyserNode.prototype.getFloatFrequencyData = function(arr) {
          _origGFFD.call(this, arr)
          for (let i = 0; i < arr.length; i += 50) arr[i] += _noiseVal
        }
      }
    } catch(e) {}

    // ── Font list spoofing (document.fonts.check) ──
    try {
      const _ALLOWED_FONTS = new Set(${JSON.stringify(fp.fontList)})
      if (typeof FontFaceSet !== 'undefined' && document.fonts) {
        const _origCheck = FontFaceSet.prototype.check
        FontFaceSet.prototype.check = function(font, text) {
          const m = font.match(/(?:^|\\s)([\\w\\s]+)$/)
          const name = m ? m[1].trim() : font
          if (!_ALLOWED_FONTS.has(name)) return false
          return _origCheck.call(this, font, text)
        }
      }
    } catch(e) {}

    // ── Permissions API spoofing ──
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const _origQuery = navigator.permissions.query.bind(navigator.permissions)
        const _DENIED = ['camera', 'microphone', 'notifications', 'push', 'midi']
        navigator.permissions.query = function(desc) {
          if (desc && _DENIED.includes(desc.name)) {
            return Promise.resolve({ state: 'denied', onchange: null })
          }
          return _origQuery(desc)
        }
      }
    } catch(e) {}

  } catch(e) {}
})()`
}

// ── Preload script file (written per account, loaded by Electron session) ─────

export function writeAccountPreload(accountId: number, fp: Fingerprint): string {
  const overrideCode = buildOverrideScript(fp)

  // Preload runs in the isolated world.
  // webFrame.executeJavaScript injects overrides into the main world.
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
