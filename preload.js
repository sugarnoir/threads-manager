"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // Accounts
    accounts: {
        list: () => electron_1.ipcRenderer.invoke('accounts:list'),
        add: (options) => electron_1.ipcRenderer.invoke('accounts:add', options),
        updateProxy: (data) => electron_1.ipcRenderer.invoke('accounts:update-proxy', data),
        updateDisplayName: (data) => electron_1.ipcRenderer.invoke('accounts:update-display-name', data),
        updateGroup: (data) => electron_1.ipcRenderer.invoke('accounts:update-group', data),
        updateMemo: (data) => electron_1.ipcRenderer.invoke('accounts:update-memo', data),
        updateSpeedPreset: (data) => electron_1.ipcRenderer.invoke('accounts:update-speed-preset', data),
        clearCookies: (id) => electron_1.ipcRenderer.invoke('accounts:clear-cookies', id),
        reorder: (updates) => electron_1.ipcRenderer.invoke('accounts:reorder', updates),
        contextMenu: (accountId) => electron_1.ipcRenderer.invoke('accounts:context-menu', accountId),
        check: (id) => electron_1.ipcRenderer.invoke('accounts:check', id),
        checkAll: () => electron_1.ipcRenderer.invoke('accounts:check-all'),
        delete: (id) => electron_1.ipcRenderer.invoke('accounts:delete', id),
    },
    // Posts
    posts: {
        list: (accountId) => electron_1.ipcRenderer.invoke('posts:list', accountId),
        send: (data) => electron_1.ipcRenderer.invoke('posts:send', data),
        broadcast: (data) => electron_1.ipcRenderer.invoke('posts:broadcast', data),
    },
    // Schedules
    schedules: {
        list: () => electron_1.ipcRenderer.invoke('schedules:list'),
        create: (data) => electron_1.ipcRenderer.invoke('schedules:create', data),
        delete: (id) => electron_1.ipcRenderer.invoke('schedules:delete', id),
    },
    // Playwright Contexts (for post/like/repost automation)
    contexts: {
        list: () => electron_1.ipcRenderer.invoke('contexts:list'),
        open: (accountId) => electron_1.ipcRenderer.invoke('contexts:open', accountId),
        close: (accountId) => electron_1.ipcRenderer.invoke('contexts:close', accountId),
        activeIds: () => electron_1.ipcRenderer.invoke('contexts:active-ids'),
    },
    // Engagements
    engagements: {
        history: () => electron_1.ipcRenderer.invoke('engagements:history'),
        like: (data) => electron_1.ipcRenderer.invoke('engagements:like', data),
        repost: (data) => electron_1.ipcRenderer.invoke('engagements:repost', data),
    },
    // Embedded browser views (WebContentsView)
    browserView: {
        list: () => electron_1.ipcRenderer.invoke('browserView:list'),
        show: (accountId, y, height) => electron_1.ipcRenderer.invoke('browserView:show', accountId, y, height),
        hide: (accountId) => electron_1.ipcRenderer.invoke('browserView:hide', accountId),
        close: (accountId) => electron_1.ipcRenderer.invoke('browserView:close', accountId),
        setBounds: (accountId, y, height) => electron_1.ipcRenderer.invoke('browserView:set-bounds', accountId, y, height),
        navigate: (accountId, url) => electron_1.ipcRenderer.invoke('browserView:navigate', accountId, url),
        back: (accountId) => electron_1.ipcRenderer.invoke('browserView:back', accountId),
        forward: (accountId) => electron_1.ipcRenderer.invoke('browserView:forward', accountId),
        reload: (accountId) => electron_1.ipcRenderer.invoke('browserView:reload', accountId),
    },
    // Settings
    settings: {
        getAll: () => electron_1.ipcRenderer.invoke('settings:get-all'),
        set: (key, value) => electron_1.ipcRenderer.invoke('settings:set', key, value),
        setMany: (entries) => electron_1.ipcRenderer.invoke('settings:set-many', entries),
        testWebhook: () => electron_1.ipcRenderer.invoke('settings:test-webhook'),
        botStart: () => electron_1.ipcRenderer.invoke('settings:bot-start'),
        botStop: () => electron_1.ipcRenderer.invoke('settings:bot-stop'),
        botStatus: () => electron_1.ipcRenderer.invoke('settings:bot-status'),
    },
    // Groups
    groups: {
        list: () => electron_1.ipcRenderer.invoke('groups:list'),
        create: (name) => electron_1.ipcRenderer.invoke('groups:create', name),
        rename: (data) => electron_1.ipcRenderer.invoke('groups:rename', data),
        delete: (name) => electron_1.ipcRenderer.invoke('groups:delete', name),
    },
    // Research
    research: {
        debug: (data) => electron_1.ipcRenderer.invoke('research:debug', data),
        hashtag: (data) => electron_1.ipcRenderer.invoke('research:hashtag', data),
        account: (data) => electron_1.ipcRenderer.invoke('research:account', data),
        keyword: (data) => electron_1.ipcRenderer.invoke('research:keyword', data),
        competitive: (data) => electron_1.ipcRenderer.invoke('research:competitive', data),
    },
    // Stocks
    stocks: {
        list: (accountId) => electron_1.ipcRenderer.invoke('stocks:list', accountId),
        create: (data) => electron_1.ipcRenderer.invoke('stocks:create', data),
        update: (data) => electron_1.ipcRenderer.invoke('stocks:update', data),
        delete: (id) => electron_1.ipcRenderer.invoke('stocks:delete', id),
    },
    // Templates
    templates: {
        list: (accountId) => electron_1.ipcRenderer.invoke('templates:list', accountId),
        create: (data) => electron_1.ipcRenderer.invoke('templates:create', data),
        update: (data) => electron_1.ipcRenderer.invoke('templates:update', data),
        delete: (id) => electron_1.ipcRenderer.invoke('templates:delete', id),
    },
    // License Admin (service_role key required)
    license: {
        list: () => electron_1.ipcRenderer.invoke('license:list'),
        create: (row) => electron_1.ipcRenderer.invoke('license:create', row),
        update: (data) => electron_1.ipcRenderer.invoke('license:update', data),
        delete: (key) => electron_1.ipcRenderer.invoke('license:delete', key),
    },
    // Auth
    auth: {
        check: () => electron_1.ipcRenderer.invoke('auth:check'),
        verify: (key) => electron_1.ipcRenderer.invoke('auth:verify', key),
        logout: () => electron_1.ipcRenderer.invoke('auth:logout'),
    },
    // Autopost
    autopost: {
        get: (accountId) => electron_1.ipcRenderer.invoke('autopost:get', accountId),
        save: (data) => electron_1.ipcRenderer.invoke('autopost:save', data),
        resetNext: (accountId) => electron_1.ipcRenderer.invoke('autopost:reset-next', accountId),
    },
    // Events
    on: (channel, callback) => {
        electron_1.ipcRenderer.on(channel, (_event, ...args) => callback(...args));
        return () => electron_1.ipcRenderer.removeAllListeners(channel);
    },
});
