import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Accounts
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: (options?: {
      proxy_url?: string
      proxy_username?: string
      proxy_password?: string
    }) => ipcRenderer.invoke('accounts:add', options),
    register: (options?: {
      proxy_url?: string
      proxy_username?: string
      proxy_password?: string
    }) => ipcRenderer.invoke('accounts:register', options),
    updateProxy: (data: {
      id: number
      proxy_url: string | null
      proxy_username: string | null
      proxy_password: string | null
    }) => ipcRenderer.invoke('accounts:update-proxy', data),
    updateDisplayName: (data: { id: number; display_name: string | null }) =>
      ipcRenderer.invoke('accounts:update-display-name', data),
    updateGroup: (data: { id: number; group_name: string | null }) =>
      ipcRenderer.invoke('accounts:update-group', data),
    updateMemo: (data: { id: number; memo: string | null }) =>
      ipcRenderer.invoke('accounts:update-memo', data),
    updateSpeedPreset: (data: { id: number; speed_preset: 'slow' | 'normal' | 'fast' }) =>
      ipcRenderer.invoke('accounts:update-speed-preset', data),
    updateUserAgent: (data: { id: number; user_agent: string | null }) =>
      ipcRenderer.invoke('accounts:update-user-agent', data),
    loginInstagram: (id: number) =>
      ipcRenderer.invoke('accounts:login-instagram', id),
    bulkLoginInstagram: (data: { group_name: string | null }) =>
      ipcRenderer.invoke('accounts:bulk-login-instagram', data),
    clearCookies: (id: number) =>
      ipcRenderer.invoke('accounts:clear-cookies', id),
    resetSession: (id: number) =>
      ipcRenderer.invoke('accounts:reset-session', id),
    reorder: (updates: { id: number; sort_order: number; group_name: string | null }[]) =>
      ipcRenderer.invoke('accounts:reorder', updates),
    contextMenu: (accountId: number) =>
      ipcRenderer.invoke('accounts:context-menu', accountId),
    check: (id: number) => ipcRenderer.invoke('accounts:check', id),
    checkAll: () => ipcRenderer.invoke('accounts:check-all'),
    delete: (id: number) => ipcRenderer.invoke('accounts:delete', id),
    fingerprint: (id: number) => ipcRenderer.invoke('accounts:fingerprint', id),
    autoRegister: (data: {
      name: string; email: string; password: string
      proxy_url?: string | null; proxy_username?: string | null; proxy_password?: string | null
    }) => ipcRenderer.invoke('accounts:auto-register', data),
  },

  // Posts
  posts: {
    list: (accountId: number) => ipcRenderer.invoke('posts:list', accountId),
    send: (data: { account_id: number; content: string; media_paths?: string[] }) =>
      ipcRenderer.invoke('posts:send', data),
    broadcast: (data: {
      account_ids: number[]
      content: string
      media_paths?: string[]
    }) => ipcRenderer.invoke('posts:broadcast', data),
  },

  // Schedules
  schedules: {
    list: () => ipcRenderer.invoke('schedules:list'),
    create: (data: {
      account_id: number
      content: string
      media_paths?: string[]
      scheduled_at: string
    }) => ipcRenderer.invoke('schedules:create', data),
    delete: (id: number) => ipcRenderer.invoke('schedules:delete', id),
  },

  // Playwright Contexts (for post/like/repost automation)
  contexts: {
    list: () => ipcRenderer.invoke('contexts:list'),
    open: (accountId: number) => ipcRenderer.invoke('contexts:open', accountId),
    close: (accountId: number) => ipcRenderer.invoke('contexts:close', accountId),
    activeIds: () => ipcRenderer.invoke('contexts:active-ids'),
  },

  // Engagements
  engagements: {
    history: () => ipcRenderer.invoke('engagements:history'),
    like: (data: { account_ids: number[]; post_url: string }) =>
      ipcRenderer.invoke('engagements:like', data),
    repost: (data: { account_ids: number[]; post_url: string }) =>
      ipcRenderer.invoke('engagements:repost', data),
  },

  // Embedded browser views (WebContentsView)
  browserView: {
    list: () => ipcRenderer.invoke('browserView:list'),
    show: (accountId: number, y: number, height: number) =>
      ipcRenderer.invoke('browserView:show', accountId, y, height),
    hide: (accountId: number) => ipcRenderer.invoke('browserView:hide', accountId),
    close: (accountId: number) => ipcRenderer.invoke('browserView:close', accountId),
    setBounds: (accountId: number, y: number, height: number) =>
      ipcRenderer.invoke('browserView:set-bounds', accountId, y, height),
    navigate: (accountId: number, url: string) =>
      ipcRenderer.invoke('browserView:navigate', accountId, url),
    back: (accountId: number)    => ipcRenderer.invoke('browserView:back', accountId),
    forward: (accountId: number) => ipcRenderer.invoke('browserView:forward', accountId),
    reload: (accountId: number)  => ipcRenderer.invoke('browserView:reload', accountId),
    openCompose: (accountId: number, content: string, images?: string[]) =>
      ipcRenderer.invoke('browserView:open-compose', accountId, content, images ?? []),
    enableCapture: (accountId: number) =>
      ipcRenderer.invoke('browserView:enableCapture', accountId),
    getCaptured: () =>
      ipcRenderer.invoke('browserView:getCaptured'),
    clearCaptured: () =>
      ipcRenderer.invoke('browserView:clearCaptured'),
    getFollowerCandidates: () =>
      ipcRenderer.invoke('browserView:getFollowerCandidates'),
    changeProfilePic: (accountId: number, imagePath: string) =>
      ipcRenderer.invoke('browserView:changeProfilePic', accountId, imagePath),
  },

  // Settings
  settings: {
    getAll: () => ipcRenderer.invoke('settings:get-all'),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    setMany: (entries: Record<string, string>) => ipcRenderer.invoke('settings:set-many', entries),
    testWebhook: () => ipcRenderer.invoke('settings:test-webhook'),
    botStart: () => ipcRenderer.invoke('settings:bot-start'),
    botStop: () => ipcRenderer.invoke('settings:bot-stop'),
    botStatus: () => ipcRenderer.invoke('settings:bot-status'),
  },

  // Proxy Presets
  proxyPresets: {
    list:   () => ipcRenderer.invoke('proxy-presets:list'),
    create: (data: { name: string; type: string; host: string; port: number; username?: string | null; password?: string | null }) =>
      ipcRenderer.invoke('proxy-presets:create', data),
    update: (data: { id: number; name: string; type: string; host: string; port: number; username?: string | null; password?: string | null }) =>
      ipcRenderer.invoke('proxy-presets:update', data),
    delete: (id: number) => ipcRenderer.invoke('proxy-presets:delete', id),
  },

  // Groups
  groups: {
    list: () => ipcRenderer.invoke('groups:list'),
    create: (name: string) => ipcRenderer.invoke('groups:create', name),
    rename: (data: { oldName: string; newName: string }) => ipcRenderer.invoke('groups:rename', data),
    delete: (name: string) => ipcRenderer.invoke('groups:delete', name),
    reorder: (updates: { id: number; sort_order: number }[]) => ipcRenderer.invoke('groups:reorder', updates),
  },

  // Research
  research: {
    debug: (data: { accountId: number; keyword: string }) =>
      ipcRenderer.invoke('research:debug', data),
    hashtag: (data: { accountId: number; hashtag: string }) =>
      ipcRenderer.invoke('research:hashtag', data),
    account: (data: { accountId: number; targetUsername: string }) =>
      ipcRenderer.invoke('research:account', data),
    keyword: (data: { accountId: number; keyword: string }) =>
      ipcRenderer.invoke('research:keyword', data),
    competitive: (data: { accountId: number; keyword: string }) =>
      ipcRenderer.invoke('research:competitive', data),
  },

  // Stocks
  stocks: {
    list:   (accountId: number) => ipcRenderer.invoke('stocks:list', accountId),
    create: (data: { account_id: number; title?: string | null; content: string; image_url?: string | null }) =>
      ipcRenderer.invoke('stocks:create', data),
    update: (data: { id: number; title?: string | null; content: string; image_url?: string | null }) =>
      ipcRenderer.invoke('stocks:update', data),
    delete:           (id: number)       => ipcRenderer.invoke('stocks:delete', id),
    deleteAll:        (accountId: number) => ipcRenderer.invoke('stocks:deleteAll', accountId),
    deleteAllByGroup: (groupKey: string)  => ipcRenderer.invoke('stocks:deleteAllByGroup', groupKey),
    importCsv: (rows: Array<{ account_id: number; content: string; image_url?: string | null; image_url_2?: string | null }>) =>
      ipcRenderer.invoke('stocks:import-csv', rows),
    randomizeImages: (accountId: number) => ipcRenderer.invoke('stocks:randomize-images', accountId),
    updateAllTopics: (data: { account_id: number; topic: string | null }) =>
      ipcRenderer.invoke('stocks:updateAllTopics', data),
    schedulePost: (data: { account_id: number; content: string; scheduled_at: string; image_url?: string | null; image_url_2?: string | null }) =>
      ipcRenderer.invoke('stocks:schedule-post', data),
  },

  // Image Groups
  imageGroups: {
    get:  () => ipcRenderer.invoke('imageGroups:get'),
    save: (data: { group1: string[]; group2: string[] }) => ipcRenderer.invoke('imageGroups:save', data),
  },

  // Templates
  templates: {
    list:   (accountId?: number | null) => ipcRenderer.invoke('templates:list', accountId),
    create: (data: { title: string; content: string; account_id?: number | null }) => ipcRenderer.invoke('templates:create', data),
    update: (data: { id: number; title: string; content: string }) => ipcRenderer.invoke('templates:update', data),
    delete: (id: number) => ipcRenderer.invoke('templates:delete', id),
  },

  // License Admin (service_role key required)
  license: {
    list:   () => ipcRenderer.invoke('license:list'),
    create: (row: { key: string; is_active: boolean; expires_at: string | null; memo: string | null }) =>
      ipcRenderer.invoke('license:create', row),
    update: (data: { key: string; is_active?: boolean; expires_at?: string | null; memo?: string | null }) =>
      ipcRenderer.invoke('license:update', data),
    delete:   (key: string) => ipcRenderer.invoke('license:delete', key),
    resetMac: (key: string) => ipcRenderer.invoke('license:reset-mac', key),
  },

  // Auth
  auth: {
    check:  () => ipcRenderer.invoke('auth:check'),
    verify: (key: string) => ipcRenderer.invoke('auth:verify', key),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },

  // Master Key (予約投稿タブ認証)
  masterKey: {
    check:  () => ipcRenderer.invoke('master-key:check'),
    verify: (key: string) => ipcRenderer.invoke('master-key:verify', key),
    list:   () => ipcRenderer.invoke('master-key:list'),
    create: (row: { key: string; is_active: boolean; expires_at: string | null; memo: string | null }) =>
      ipcRenderer.invoke('master-key:create', row),
    update: (data: { key: string; is_active?: boolean; expires_at?: string | null; memo?: string | null }) =>
      ipcRenderer.invoke('master-key:update', data),
    delete: (key: string) => ipcRenderer.invoke('master-key:delete', key),
  },

  // Autopost
  autopost: {
    get:       (accountId: number) => ipcRenderer.invoke('autopost:get', accountId),
    save:      (data: {
      account_id:    number
      enabled:       boolean
      mode:          'stock' | 'rewrite' | 'random'
      use_api:       boolean
      min_interval:  number
      max_interval:  number
      rewrite_texts: string[]
    }) => ipcRenderer.invoke('autopost:save', data),
    resetNext: (accountId: number) => ipcRenderer.invoke('autopost:reset-next', accountId),
    setNextAt: (data: { account_id: number; next_at: string }) => ipcRenderer.invoke('autopost:set-next-at', data),
  },

  // API Post (non-browser immediate post)
  apiPost: {
    send: (data: { account_id: number; content: string; image_urls?: (string | null)[] }) =>
      ipcRenderer.invoke('apiPost:send', data),
  },

  // Auto Engagement (API-based auto like / follow)
  autoEngagement: {
    get:       (accountId: number, action: 'like' | 'follow') =>
      ipcRenderer.invoke('autoEngagement:get', accountId, action),
    save:      (data: {
      account_id:       number
      action:           'like' | 'follow'
      target_usernames: string
      enabled:          boolean
      min_interval:     number
      max_interval:     number
    }) => ipcRenderer.invoke('autoEngagement:save', data),
    resetNext: (accountId: number, action: 'like' | 'follow') =>
      ipcRenderer.invoke('autoEngagement:reset-next', accountId, action),
  },

  // Auto Reply
  autoReply: {
    get:       (groupName: string) => ipcRenderer.invoke('autoReply:get', groupName),
    save:      (data: {
      group_name:     string
      enabled:        boolean
      check_interval: number
      reply_texts:    string[]
    }) => ipcRenderer.invoke('autoReply:save', data),
    history:   (groupName: string) => ipcRenderer.invoke('autoReply:history', groupName),
    checkNow:  (groupName: string) => ipcRenderer.invoke('autoReply:checkNow', groupName),
    templates: {
      list:   () => ipcRenderer.invoke('autoReply:templates:list'),
      save:   (name: string, replyTexts: string[]) => ipcRenderer.invoke('autoReply:templates:save', name, replyTexts),
      delete: (id: number) => ipcRenderer.invoke('autoReply:templates:delete', id),
    },
  },

  // Follow Queue (競合フォロワー自動フォロー)
  followQueue: {
    enqueue:          (accountId: number) => ipcRenderer.invoke('followQueue:enqueue', accountId),
    fetchAndEnqueue:  (accountId: number, targetUsername: string, maxCount?: number) =>
      ipcRenderer.invoke('followQueue:fetchAndEnqueue', accountId, targetUsername, maxCount ?? 2000),
    stats:            (accountId: number) => ipcRenderer.invoke('followQueue:stats', accountId),
    clearPending:     (accountId: number) => ipcRenderer.invoke('followQueue:clearPending', accountId),
  },

  // Dialog
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:open-file') as Promise<{ name: string; data: number[] } | null>,
  },

  // Debug
  debugLog: (msg: string) => ipcRenderer.invoke('debug:log', msg),

  // Events
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    return () => ipcRenderer.removeAllListeners(channel)
  },
})
