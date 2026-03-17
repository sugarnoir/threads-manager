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
    clearCookies: (id: number) =>
      ipcRenderer.invoke('accounts:clear-cookies', id),
    reorder: (updates: { id: number; sort_order: number; group_name: string | null }[]) =>
      ipcRenderer.invoke('accounts:reorder', updates),
    contextMenu: (accountId: number) =>
      ipcRenderer.invoke('accounts:context-menu', accountId),
    check: (id: number) => ipcRenderer.invoke('accounts:check', id),
    checkAll: () => ipcRenderer.invoke('accounts:check-all'),
    delete: (id: number) => ipcRenderer.invoke('accounts:delete', id),
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

  // Groups
  groups: {
    list: () => ipcRenderer.invoke('groups:list'),
    create: (name: string) => ipcRenderer.invoke('groups:create', name),
    rename: (data: { oldName: string; newName: string }) => ipcRenderer.invoke('groups:rename', data),
    delete: (name: string) => ipcRenderer.invoke('groups:delete', name),
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
    delete: (id: number) => ipcRenderer.invoke('stocks:delete', id),
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
    delete: (key: string) => ipcRenderer.invoke('license:delete', key),
  },

  // Auth
  auth: {
    check:  () => ipcRenderer.invoke('auth:check'),
    verify: (key: string) => ipcRenderer.invoke('auth:verify', key),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },

  // Events
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    return () => ipcRenderer.removeAllListeners(channel)
  },
})
