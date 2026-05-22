/**
 * Stealth evasion スクリプト (playwright-extra/stealth 相当)
 *
 * 既存の fingerprint override (buildOverrideScript) とは独立。
 * Meta が検知しやすい Chromium/Electron 特有の痕跡を隠す。
 *
 * デフォルト OFF。stealth_enabled 設定で有効化。
 */

export function buildStealthScript(): string {
  return `(function() {
  try {

    // ── 1. navigator.webdriver を完全に削除 ──
    // 'webdriver' in navigator が false になるよう delete でプロパティ自体を消す
    // defineProperty で再定義すると in 演算子で検知されるため使わない
    try { delete Navigator.prototype.webdriver } catch(e) {}
    try { delete navigator.webdriver } catch(e) {}

    // ── 2. window.chrome オブジェクト偽装 ──
    // Electron は chrome オブジェクトを持たない or 不完全。
    // 実際の Chrome と同等の構造にする。
    if (!window.chrome) {
      window.chrome = {}
    }
    if (!window.chrome.app) {
      window.chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: function() { return null },
        getIsInstalled: function() { return false },
        installState: function(cb) { if (cb) cb('not_installed') },
        runningState: function() { return 'cannot_run' },
      }
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        OnInstalledReason: {
          CHROME_UPDATE: 'chrome_update',
          INSTALL: 'install',
          SHARED_MODULE_UPDATE: 'shared_module_update',
          UPDATE: 'update',
        },
        OnRestartRequiredReason: {
          APP_UPDATE: 'app_update',
          OS_UPDATE: 'os_update',
          PERIODIC: 'periodic',
        },
        PlatformArch: {
          ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64',
          X86_32: 'x86-32', X86_64: 'x86-64',
        },
        PlatformNaclArch: {
          ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64',
          X86_32: 'x86-32', X86_64: 'x86-64',
        },
        PlatformOs: {
          ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia',
          LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win',
        },
        RequestUpdateCheckStatus: {
          NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available',
        },
        connect: function() {
          // throw "Error: Could not establish connection..." のような実Chrome挙動
          return { onDisconnect: { addListener: function() {} }, onMessage: { addListener: function() {} }, postMessage: function() {}, disconnect: function() {} }
        },
        sendMessage: function() {
          // 通常のChrome拡張APIと同等のスタブ
        },
        id: undefined,
      }
    }
    if (!window.chrome.csi) {
      window.chrome.csi = function() {
        return {
          startE: Date.now(),
          onloadT: Date.now(),
          pageT: Math.random() * 1000 + 500,
          tran: 15,
        }
      }
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return {
          commitLoadTime: Date.now() / 1000,
          connectionInfo: 'h2',
          finishDocumentLoadTime: Date.now() / 1000,
          finishLoadTime: Date.now() / 1000,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: Date.now() / 1000,
          navigationType: 'Other',
          npnNegotiatedProtocol: 'h2',
          requestTime: Date.now() / 1000 - 0.3,
          startLoadTime: Date.now() / 1000 - 0.3,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
        }
      }
    }

    // ── 3. Plugins 偽装 ──
    // 空配列ではなく実 Chrome のようなプラグインリストを持たせる
    // (既存の fingerprint override が plugins=[] にしてる場合、stealth 側で上書き)
    try {
      const _makeMime = function(type, suffixes, desc) {
        const m = Object.create(MimeType.prototype)
        Object.defineProperties(m, {
          type:        { get: () => type },
          suffixes:    { get: () => suffixes },
          description: { get: () => desc },
        })
        return m
      }
      const _makePlugin = function(name, desc, filename, mimes) {
        const p = Object.create(Plugin.prototype)
        Object.defineProperties(p, {
          name:        { get: () => name },
          description: { get: () => desc },
          filename:    { get: () => filename },
          length:      { get: () => mimes.length },
        })
        for (let i = 0; i < mimes.length; i++) {
          Object.defineProperty(p, i, { get: () => mimes[i] })
          Object.defineProperty(mimes[i], 'enabledPlugin', { get: () => p })
        }
        p.item = function(idx) { return mimes[idx] || null }
        p.namedItem = function(n) { return mimes.find(function(m) { return m.type === n }) || null }
        p[Symbol.iterator] = function() { return mimes[Symbol.iterator]() }
        return p
      }

      const pdfMime = _makeMime('application/pdf', 'pdf', 'Portable Document Format')
      const textMime = _makeMime('text/pdf', 'pdf', 'Portable Document Format')
      const pdfPlugin = _makePlugin('PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer', [pdfMime, textMime])
      const chromePdf = _makePlugin('Chrome PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer', [
        _makeMime('application/pdf', 'pdf', 'Portable Document Format'),
      ])
      const chromePlugin = _makePlugin('Chromium PDF Plugin', 'Portable Document Format', 'internal-pdf-viewer', [
        _makeMime('application/x-google-chrome-pdf', 'pdf', ''),
      ])
      const nativePdf = _makePlugin('Microsoft Edge PDF Plugin', '', 'internal-pdf-viewer', [
        _makeMime('application/pdf', 'pdf', ''),
      ])
      const nativeViewer = _makePlugin('Microsoft Edge PDF Viewer', '', 'internal-pdf-viewer', [
        _makeMime('application/pdf', 'pdf', ''),
      ])

      const plugins = [pdfPlugin, chromePdf, chromePlugin, nativePdf, nativeViewer]
      const allMimes = plugins.flatMap(function(p) {
        var m = []
        for (var i = 0; i < p.length; i++) m.push(p[i])
        return m
      })

      const pluginArray = Object.create(PluginArray.prototype)
      for (let i = 0; i < plugins.length; i++) {
        Object.defineProperty(pluginArray, i, { get: () => plugins[i], configurable: true })
        Object.defineProperty(pluginArray, plugins[i].name, { get: () => plugins[i], configurable: true })
      }
      Object.defineProperty(pluginArray, 'length', { get: () => plugins.length })
      pluginArray.item = function(idx) { return plugins[idx] || null }
      pluginArray.namedItem = function(n) { return plugins.find(function(p) { return p.name === n }) || null }
      pluginArray.refresh = function() {}
      pluginArray[Symbol.iterator] = function() { return plugins[Symbol.iterator]() }

      const mimeTypeArray = Object.create(MimeTypeArray.prototype)
      for (let i = 0; i < allMimes.length; i++) {
        Object.defineProperty(mimeTypeArray, i, { get: () => allMimes[i], configurable: true })
        Object.defineProperty(mimeTypeArray, allMimes[i].type, { get: () => allMimes[i], configurable: true })
      }
      Object.defineProperty(mimeTypeArray, 'length', { get: () => allMimes.length })
      mimeTypeArray.item = function(idx) { return allMimes[idx] || null }
      mimeTypeArray.namedItem = function(n) { return allMimes.find(function(m) { return m.type === n }) || null }
      mimeTypeArray[Symbol.iterator] = function() { return allMimes[Symbol.iterator]() }

      Object.defineProperty(navigator, 'plugins',   { get: () => pluginArray,   configurable: true })
      Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypeArray, configurable: true })
      Object.defineProperty(navigator, 'pdfViewerEnabled', { get: () => true, configurable: true })
    } catch(e) {}

    // ── 4. iframe contentWindow.chrome 注入 ──
    // 新しく作られる iframe にも chrome オブジェクトを注入
    try {
      const _origCreateElement = document.createElement.bind(document)
      document.createElement = function(tagName, options) {
        const el = _origCreateElement(tagName, options)
        if (tagName.toLowerCase() === 'iframe') {
          const _origAppend = el.appendChild
          el.appendChild = function(child) {
            const result = _origAppend.call(this, child)
            _patchIframe(this)
            return result
          }
          // MutationObserver で DOM 追加時にも対応
          const obs = new MutationObserver(function() {
            _patchIframe(el)
            obs.disconnect()
          })
          setTimeout(function() {
            if (el.parentNode) _patchIframe(el)
            else {
              // まだDOMに追加されていなければ、追加されたタイミングでパッチ
              try { obs.observe(document.documentElement || document.body, { childList: true, subtree: true }) } catch(e) {}
            }
          }, 0)
        }
        return el
      }
      // toString をオリジナルと同じに
      document.createElement.toString = function() { return 'function createElement() { [native code] }' }
    } catch(e) {}

    function _patchIframe(iframe) {
      try {
        const win = iframe.contentWindow
        if (win && !win.chrome) {
          win.chrome = window.chrome
        }
      } catch(e) { /* cross-origin iframe → skip */ }
    }
    // 既存の iframe もパッチ
    try {
      var iframes = document.querySelectorAll('iframe')
      for (var i = 0; i < iframes.length; i++) _patchIframe(iframes[i])
    } catch(e) {}

    // ── 5. Notification.permission の整合性 ──
    // Permissions API の notifications と Notification.permission を一致させる
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Object.defineProperty(Notification, 'permission', {
          get: () => 'denied',
          configurable: true,
        })
      }
    } catch(e) {}

    // ── 6. toString 偽装 ──
    // 偽装した関数の toString() が "[native code]" を返すようにする
    try {
      const _nativeToString = Function.prototype.toString
      const _patchedFns = new Set()

      const _addNative = function(fn, name) {
        _patchedFns.add(fn)
      }

      const _handler = {
        apply: function(target, thisArg, args) {
          if (_patchedFns.has(thisArg)) {
            return 'function ' + (thisArg.name || '') + '() { [native code] }'
          }
          return _nativeToString.apply(thisArg, args)
        }
      }
      Function.prototype.toString = new Proxy(_nativeToString, _handler)
      _patchedFns.add(Function.prototype.toString)

      // 上で偽装した関数を登録
      if (navigator.permissions && navigator.permissions.query) _addNative(navigator.permissions.query, 'query')
      if (document.createElement !== _origCreateElement) _addNative(document.createElement, 'createElement')
    } catch(e) {}

    // ── 7. Electron 固有の痕跡を削除 ──
    try {
      // process, require, __electron 等が漏れていないか確認して削除
      if (typeof window.process !== 'undefined') delete window.process
      if (typeof window.require !== 'undefined') delete window.require
      if (typeof window.__electron_preload !== 'undefined') delete window.__electron_preload
    } catch(e) {}

    // ── 8. connection.rtt の偽装 ──
    // Chromium headless は rtt=0 を返す
    try {
      if (navigator.connection) {
        const origConn = navigator.connection
        const rtt = [50, 100, 150][Math.floor(Math.random() * 3)]
        Object.defineProperty(origConn, 'rtt', {
          get: () => rtt,
          configurable: true,
        })
      }
    } catch(e) {}

  } catch(e) {}
})()`
}
