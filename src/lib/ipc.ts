// window.electronAPI の型定義と安全なアクセサ

export interface Account {
  id: number
  username: string
  display_name: string | null
  session_dir: string
  status: 'active' | 'inactive' | 'needs_login' | 'frozen' | 'error'
  avatar_url: string | null
  proxy_url: string | null
  proxy_username: string | null
  proxy_password: string | null
  group_name: string | null
  memo: string | null
  follower_count: number | null
  sort_order: number
  speed_preset: 'slow' | 'normal' | 'fast'
  created_at: string
  updated_at: string
}

export interface Group {
  id: number
  name: string
  sort_order: number
}

export interface Post {
  id: number
  account_id: number
  content: string
  media_paths: string[]
  status: 'pending' | 'posted' | 'failed'
  error_msg: string | null
  posted_at: string | null
  created_at: string
}

export interface ContextInfo {
  accountId: number
  state: 'idle' | 'busy'
}

export interface ViewInfo {
  accountId: number
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isActive: boolean
}

export interface EngagementRecord {
  id: number
  account_id: number
  post_url: string
  action: 'like' | 'repost'
  status: 'done' | 'failed' | 'already_done'
  error_msg: string | null
  created_at: string
}

export interface EngagementItemResult {
  account_id: number
  status: 'done' | 'failed' | 'already_done'
  error?: string
}

export interface Schedule {
  id: number
  account_id: number
  content: string
  media_paths: string[]
  scheduled_at: string
  status: 'pending' | 'posted' | 'failed' | 'cancelled'
  post_id: number | null
  created_at: string
}

export type Bounds = { x: number; y: number; width: number; height: number }

export interface HashtagResult {
  hashtag: string
  topPosts: { text: string; likes: string; reposts: string; replies: string; url: string }[]
}

export interface AccountAnalysis {
  username: string
  displayName: string | null
  bio: string | null
  followerCount: string | null
  avgLikes: number | null
  recentPosts: { text: string; likes: string; replies: string; reposts: string; url: string; imageUrl: string | null; timestamp: string | null }[]
}

export interface SearchPost {
  username: string
  text: string
  likes: string
  replies: string
  reposts: string
  url: string
  timestamp: string | null
}

export interface CompetitivePost {
  username: string
  text: string
  likes: number
  reposts: number
  replies: number
  url: string
  score: number
}

export interface PostStock {
  id:          number
  account_id:  number
  title:       string | null
  content:     string
  image_url:   string | null
  image_url_2: string | null
  sort_order:  number
  created_at:  string
  updated_at:  string
}

export interface PostTemplate {
  id:         number
  account_id: number | null
  title:      string
  content:    string
  sort_order: number
  created_at: string
  updated_at: string
}


export interface FingerprintData {
  userAgent:           string
  platform:            string
  vendor:              string
  screenWidth:         number
  screenHeight:        number
  timezone:            string
  language:            string
  languages:           string[]
  hardwareConcurrency: number
  deviceMemory:        number
  webglVendor:         string
  webglRenderer:       string
  canvasSeed:          number
  batteryLevel:        number
  batteryCharging:     boolean
  audioSeed:           number
  fontList:            string[]
}

export interface ProxyPreset {
  id: number
  name: string
  type: 'http' | 'https' | 'socks5'
  host: string
  port: number
  username: string | null
  password: string | null
  created_at: string
}

export interface AutopostConfig {
  id:            number
  account_id:    number
  enabled:       boolean
  mode:          'stock' | 'rewrite'
  min_interval:  number
  max_interval:  number
  next_at:       string | null
  stock_last_id: number | null
  rewrite_idx:   number
  rewrite_texts: string[]
  created_at:    string
  updated_at:    string
}

export interface ImageGroups {
  group1: string[]
  group2: string[]
}

export interface LicenseRow {
  key: string
  is_active: boolean
  expires_at: string | null
  memo: string | null
}

export interface MasterKeyRow {
  key: string
  is_active: boolean
  expires_at: string | null
  memo: string | null
}

declare global {
  interface Window {
    electronAPI: {
      license: {
        list:   () => Promise<{ success: boolean; data?: LicenseRow[]; error?: string }>
        create: (row: LicenseRow) => Promise<{ success: boolean; error?: string }>
        update: (data: Partial<LicenseRow> & { key: string }) => Promise<{ success: boolean; error?: string }>
        delete: (key: string) => Promise<{ success: boolean; error?: string }>
      }
      accounts: {
        list: () => Promise<Account[]>
        add: (options?: {
          proxy_url?: string
          proxy_username?: string
          proxy_password?: string
        }) => Promise<{ success: boolean; account?: Account; error?: string }>
        register: (options?: {
          proxy_url?: string
          proxy_username?: string
          proxy_password?: string
        }) => Promise<{ success: boolean; account?: Account; error?: string }>
        updateProxy: (data: {
          id: number
          proxy_url: string | null
          proxy_username: string | null
          proxy_password: string | null
        }) => Promise<{ success: boolean; account?: Account }>
        updateDisplayName: (data: { id: number; display_name: string | null }) => Promise<{ success: boolean }>
        updateGroup: (data: { id: number; group_name: string | null }) => Promise<{ success: boolean }>
        updateMemo: (data: { id: number; memo: string | null }) => Promise<{ success: boolean }>
        updateSpeedPreset: (data: { id: number; speed_preset: 'slow' | 'normal' | 'fast' }) => Promise<{ success: boolean }>
        clearCookies: (id: number) => Promise<{ success: boolean }>
        resetSession: (id: number) => Promise<{ success: boolean }>
        reorder: (updates: { id: number; sort_order: number; group_name: string | null }[]) => Promise<{ success: boolean }>
        contextMenu: (accountId: number) => Promise<void>
        check: (id: number) => Promise<{ status: string; message?: string }>
        checkAll: () => Promise<{ success: boolean }>
        delete: (id: number) => Promise<{ success: boolean }>
        fingerprint: (id: number) => Promise<FingerprintData | null>
      }
      posts: {
        list: (accountId: number) => Promise<Post[]>
        send: (data: {
          account_id: number
          content: string
          media_paths?: string[]
        }) => Promise<{ success: boolean; post_id?: number; error?: string }>
        broadcast: (data: {
          account_ids: number[]
          content: string
          media_paths?: string[]
        }) => Promise<Array<{ account_id: number; success: boolean; post_id?: number }>>
      }
      schedules: {
        list: () => Promise<Schedule[]>
        create: (data: {
          account_id: number
          content: string
          media_paths?: string[]
          scheduled_at: string
        }) => Promise<Schedule>
        delete: (id: number) => Promise<{ success: boolean }>
      }
      contexts: {
        list: () => Promise<ContextInfo[]>
        open: (accountId: number) => Promise<{ success: boolean; error?: string }>
        close: (accountId: number) => Promise<{ success: boolean }>
        activeIds: () => Promise<number[]>
      }
      engagements: {
        history: () => Promise<EngagementRecord[]>
        like: (data: { account_ids: number[]; post_url: string }) => Promise<EngagementItemResult[]>
        repost: (data: { account_ids: number[]; post_url: string }) => Promise<EngagementItemResult[]>
      }
      browserView: {
        list: () => Promise<ViewInfo[]>
        show: (accountId: number, y: number, height: number) => void
        hide: (accountId: number) => Promise<void>
        close: (accountId: number) => Promise<void>
        setBounds: (accountId: number, y: number, height: number) => Promise<void>
        navigate: (accountId: number, url: string) => Promise<void>
        back: (accountId: number) => Promise<void>
        forward: (accountId: number) => Promise<void>
        reload: (accountId: number) => Promise<void>
        openCompose: (accountId: number, content: string, images?: string[]) => Promise<{ success: boolean; error?: string }>
      }
      settings: {
        getAll: () => Promise<Record<string, string>>
        set: (key: string, value: string) => Promise<{ success: boolean }>
        setMany: (entries: Record<string, string>) => Promise<{ success: boolean }>
        testWebhook: () => Promise<{ ok: boolean; error?: string }>
        botStart: () => Promise<{ ok: boolean; error?: string }>
        botStop: () => Promise<{ ok: boolean }>
        botStatus: () => Promise<{ running: boolean }>
      }
      proxyPresets: {
        list:   () => Promise<ProxyPreset[]>
        create: (data: { name: string; type: string; host: string; port: number; username?: string | null; password?: string | null }) => Promise<ProxyPreset>
        update: (data: { id: number; name: string; type: string; host: string; port: number; username?: string | null; password?: string | null }) => Promise<{ success: boolean }>
        delete: (id: number) => Promise<{ success: boolean }>
      }
      groups: {
        list: () => Promise<Group[]>
        create: (name: string) => Promise<{ success: boolean; group: Group }>
        rename: (data: { oldName: string; newName: string }) => Promise<{ success: boolean }>
        delete: (name: string) => Promise<{ success: boolean }>
      }
      stocks: {
        list:   (accountId: number) => Promise<{ success: boolean; data: PostStock[]; error?: string }>
        create: (data: { account_id: number; title?: string | null; content: string; image_url?: string | null; image_url_2?: string | null }) => Promise<{ success: boolean; data: PostStock; error?: string }>
        update: (data: { id: number; title?: string | null; content: string; image_url?: string | null; image_url_2?: string | null }) => Promise<{ success: boolean; data: PostStock; error?: string }>
        delete: (id: number) => Promise<{ success: boolean; error?: string }>
        importCsv: (rows: Array<{ account_id: number; content: string; image_url?: string | null; image_url_2?: string | null }>) => Promise<{ success: boolean; imported: number; errors: string[] }>
        randomizeImages: (accountId: number) => Promise<{ success: boolean; updated?: number; errors?: string[]; error?: string }>
        schedulePost: (data: { account_id: number; content: string; scheduled_at: string; image_url?: string | null; image_url_2?: string | null }) => Promise<{ success: boolean; error?: string }>
      }
      imageGroups: {
        get:  () => Promise<{ success: boolean; data?: ImageGroups; error?: string }>
        save: (data: ImageGroups) => Promise<{ success: boolean; error?: string }>
      }
      templates: {
        list:   (accountId?: number | null) => Promise<{ success: boolean; data: PostTemplate[]; error?: string }>
        create: (data: { title: string; content: string; account_id?: number | null }) => Promise<{ success: boolean; data: PostTemplate; error?: string }>
        update: (data: { id: number; title: string; content: string }) => Promise<{ success: boolean; data: PostTemplate; error?: string }>
        delete: (id: number) => Promise<{ success: boolean; error?: string }>
      }
      auth: {
        check:  () => Promise<{ required: boolean; authenticated: boolean }>
        verify: (key: string) => Promise<{ ok: boolean; error?: string }>
        logout: () => Promise<{ ok: boolean }>
      }
      masterKey: {
        check:  () => Promise<{ authenticated: boolean }>
        verify: (key: string) => Promise<{ ok: boolean; error?: string }>
        list:   () => Promise<{ success: boolean; data?: MasterKeyRow[]; error?: string }>
        create: (row: MasterKeyRow) => Promise<{ success: boolean; error?: string }>
        update: (data: Partial<MasterKeyRow> & { key: string }) => Promise<{ success: boolean; error?: string }>
        delete: (key: string) => Promise<{ success: boolean; error?: string }>
      }
      research: {
        debug: (data: { accountId: number; keyword: string }) => Promise<{ success: boolean; data: unknown; error?: string }>
        hashtag: (data: { accountId: number; hashtag: string; minLikes?: number; minReposts?: number; minReplies?: number }) => Promise<{ success: boolean; data: HashtagResult; error?: string }>
        account: (data: { accountId: number; targetUsername: string; minLikes?: number; minReposts?: number; minReplies?: number }) => Promise<{ success: boolean; data: AccountAnalysis; error?: string }>
        keyword: (data: { accountId: number; keyword: string; minLikes?: number; minReposts?: number; minReplies?: number }) => Promise<{ success: boolean; data: SearchPost[]; error?: string }>
        competitive: (data: { accountId: number; keyword: string; minLikes?: number; minReposts?: number; minReplies?: number }) => Promise<{ success: boolean; data: CompetitivePost[]; error?: string }>
      }
      autopost: {
        get:       (accountId: number) => Promise<AutopostConfig | null>
        save:      (data: {
          account_id:    number
          enabled:       boolean
          mode:          'stock' | 'rewrite'
          min_interval:  number
          max_interval:  number
          rewrite_texts: string[]
        }) => Promise<AutopostConfig>
        resetNext: (accountId: number) => Promise<{ success: boolean }>
      }
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void
    }
  }
}

export const api = window.electronAPI
