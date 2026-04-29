/**
 * uTools API 适配垫片 (Shim)
 *
 * 在 uTools 运行时直接透传 window.utools；
 * 在 Electron 桌面应用下通过 electronAPI + SQLite 提供等效 API。
 * 业务代码统一从此模块引入 utools，无需关心运行环境差异。
 */

const hasUtools = typeof window !== 'undefined' && !!window.utools
const electronAPI = typeof window !== 'undefined' ? window.electronAPI : null
const localUserApi = electronAPI?.user || (typeof window !== 'undefined' ? window.localUser : null)

const LOCAL_USER_STORAGE_KEY = 'ai-tools:local-users'
const LOCAL_DEFAULT_USER_ID = 'local-default'

function buildDefaultLocalUser() {
  const now = new Date().toISOString()
  return {
    id: LOCAL_DEFAULT_USER_ID,
    nickname: '本地用户',
    displayName: '本地用户',
    email: '',
    avatar: '',
    provider: 'local-json',
    role: 'owner',
    createdAt: now,
    updatedAt: now
  }
}

function safeLocalStorageGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore localStorage write failures
  }
}

function normalizeBrowserLocalUser(user, fallbackId = LOCAL_DEFAULT_USER_ID) {
  const source = user && typeof user === 'object' ? user : {}
  const fallback = buildDefaultLocalUser()
  const id = String(source.id || source._id || fallbackId || fallback.id).trim() || fallback.id
  const nickname = String(source.nickname || source.displayName || source.name || fallback.nickname).trim() || fallback.nickname
  return {
    ...fallback,
    id,
    nickname,
    displayName: String(source.displayName || source.nickname || source.name || nickname).trim() || nickname,
    email: String(source.email || '').trim(),
    avatar: String(source.avatar || source.avatarUrl || '').trim(),
    updatedAt: new Date().toISOString()
  }
}

function normalizeBrowserLocalUsersState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const inputUsers = Array.isArray(source.users) ? source.users : []
  const users = []
  const seen = new Set()

  inputUsers.forEach((item, index) => {
    const normalized = normalizeBrowserLocalUser(item, `${LOCAL_DEFAULT_USER_ID}-${index + 1}`)
    if (seen.has(normalized.id)) return
    seen.add(normalized.id)
    users.push({
      ...normalized,
      createdAt: String(item?.createdAt || normalized.createdAt || new Date().toISOString())
    })
  })

  if (!users.length) {
    const defaultUser = buildDefaultLocalUser()
    users.push(defaultUser)
    seen.add(defaultUser.id)
  }

  const currentUserId = String(source.currentUserId || '').trim()
  return {
    currentUserId: seen.has(currentUserId) ? currentUserId : users[0].id,
    users
  }
}

function getBrowserLocalUsersState() {
  const normalized = normalizeBrowserLocalUsersState(safeLocalStorageGet(LOCAL_USER_STORAGE_KEY, null))
  safeLocalStorageSet(LOCAL_USER_STORAGE_KEY, normalized)
  return normalized
}

function saveBrowserLocalUsersState(nextState) {
  const normalized = normalizeBrowserLocalUsersState(nextState)
  safeLocalStorageSet(LOCAL_USER_STORAGE_KEY, normalized)
  return normalized
}

const browserUserStore = {
  getCurrent() {
    const state = getBrowserLocalUsersState()
    return state.users.find((item) => item.id === state.currentUserId) || state.users[0]
  },
  list() {
    return getBrowserLocalUsersState().users
  },
  save(user, options = {}) {
    const state = getBrowserLocalUsersState()
    const normalizedUser = normalizeBrowserLocalUser(user, state.currentUserId || LOCAL_DEFAULT_USER_ID)
    const previous = state.users.find((item) => item.id === normalizedUser.id)
    const activate = options?.activate !== false
    const nextUsers = state.users.filter((item) => item.id !== normalizedUser.id)

    nextUsers.push({
      ...normalizedUser,
      createdAt: previous?.createdAt || normalizedUser.createdAt
    })

    const nextState = saveBrowserLocalUsersState({
      currentUserId: activate ? normalizedUser.id : state.currentUserId,
      users: nextUsers
    })

    return nextState.users.find((item) => item.id === nextState.currentUserId) || nextState.users[0]
  },
  switch(id) {
    const state = getBrowserLocalUsersState()
    const targetId = String(id || '').trim()
    if (!targetId || !state.users.some((item) => item.id === targetId)) {
      return state.users.find((item) => item.id === state.currentUserId) || state.users[0]
    }

    const nextState = saveBrowserLocalUsersState({
      ...state,
      currentUserId: targetId
    })

    return nextState.users.find((item) => item.id === nextState.currentUserId) || nextState.users[0]
  },
  delete(id) {
    const state = getBrowserLocalUsersState()
    const targetId = String(id || '').trim()
    const filteredUsers = state.users.filter((item) => item.id !== targetId)
    const safeUsers = filteredUsers.length ? filteredUsers : [buildDefaultLocalUser()]
    const nextState = saveBrowserLocalUsersState({
      currentUserId: safeUsers.some((item) => item.id === state.currentUserId) ? state.currentUserId : safeUsers[0].id,
      users: safeUsers
    })
    return nextState.users
  }
}

function getLocalUserStore() {
  if (localUserApi?.getCurrent) return localUserApi
  return browserUserStore
}

// ---------- 简易 db 适配（Electron 下使用 SQLite 后端）----------
// 接口模拟 uTools db API：put({ _id, ... }), get(key), remove(id), allDocs(prefix)

const memStore = electronAPI ? {
  // 根据 key 从 SQLite 读取文档
  get(key) {
    try {
      return electronAPI.db.getItem(key)
    } catch {
      return null
    }
  },
  // 存储文档（要求包含 _id 字段）
  put(doc) {
    if (!doc || !doc._id) {
      throw new Error('db.put 需要 _id 字段')
    }
    try {
      electronAPI.db.setItem(doc._id, doc)
      return { ok: true, id: doc._id, rev: String(Date.now()) }
    } catch {
      return { ok: false }
    }
  },
  // 根据 id 或文档对象删除
  remove(id) {
    const key = typeof id === 'string' ? id : id?._id
    if (!key) return { ok: false }
    try {
      electronAPI.db.removeItem(key)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  },
  // 列出所有文档（支持前缀过滤）
  // 注意：SQLite kv_store 结构不原生支持前缀扫描，此处返回空数组
  // 业务代码中会话/笔记等数据的遍历通过 fileOperations 实现
  allDocs(prefix) {
    try {
      const all = electronAPI.db.allKeys?.() || []
      return all.filter(k => !prefix || k.startsWith(prefix)).map(k => {
        try { return electronAPI.db.getItem(k) } catch { return null }
      }).filter(Boolean)
    } catch {
      return []
    }
  }
} : (() => {
  // 浏览器环境下使用 localStorage 作为后备存储
  return {
    get(key) {
      try { return JSON.parse(localStorage.getItem(`db:${key}`) || 'null') } catch { return null }
    },
    put(doc) {
      if (!doc || !doc._id) throw new Error('db.put 需要 _id 字段')
      localStorage.setItem(`db:${doc._id}`, JSON.stringify(doc))
      return { ok: true, id: doc._id, rev: String(Date.now()) }
    },
    remove(id) {
      const key = typeof id === 'string' ? id : id?._id
      if (!key) return { ok: false }
      localStorage.removeItem(`db:${key}`)
      return { ok: true }
    },
    allDocs(prefix) {
      const out = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k || !k.startsWith('db:')) continue
        const id = k.slice(3)
        if (prefix && !id.startsWith(prefix)) continue
        try { out.push(JSON.parse(localStorage.getItem(k))) } catch { /* ignore */ }
      }
      return out
    }
  }
})()

// ---------- dbStorage（模拟 uTools dbCryptoStorage 的 key-value 接口）----------

const dbStorage = electronAPI ? {
  getItem(key) {
    try { return electronAPI.db.getItem(key) } catch { return null }
  },
  setItem(key, value) {
    electronAPI.db.setItem(key, value)
  },
  removeItem(key) {
    electronAPI.db.removeItem(key)
  }
} : {
  getItem(key) {
    try { return JSON.parse(localStorage.getItem(`kv:${key}`) ?? 'null') } catch { return null }
  },
  setItem(key, value) {
    localStorage.setItem(`kv:${key}`, JSON.stringify(value))
  },
  removeItem(key) {
    localStorage.removeItem(`kv:${key}`)
  }
}

// ---------- 工具函数 ----------

function notImplemented(name) {
  return (...args) => {
    console.warn(`[utoolsShim] ${name} 在 Electron 桌面环境中未实现`, args)
  }
}

// ---------- Electron 环境下模拟 utools 对象 ----------

const electronUtools = {
  // 数据存储（SQLite 后端）
  db: memStore,
  dbStorage,

  // 环境检测
  isDev: () => !!import.meta.env?.DEV,

  // 应用信息
  getAppVersion: () => electronAPI?.app.getVersion() ?? Promise.resolve('0.1.0'),
  getNativeId: () => 'electron',

  // 文件对话框
  showOpenDialog: (options) => electronAPI?.dialog.showOpenDialog(options),
  showSaveDialog: (options) => electronAPI?.dialog.showSaveDialog(options),

  // 系统 Shell
  shellOpenPath: (p) => electronAPI?.shell.openPath(p),
  shellOpenExternal: (url) => electronAPI?.shell.openExternal(url),

  // 文件系统（通过 electronAPI）
  getPath: (name) => electronAPI?.app.getPath(name),

  // 剪贴板
  copyText: (t) => navigator.clipboard?.writeText(t),
  copyImage: (buf) => {
    if (buf instanceof Blob) {
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': buf })])
    }
    // 如果是 ArrayBuffer 或 Uint8Array，先转为 Blob
    const blob = new Blob([buf], { type: 'image/png' })
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  },

  // 用户信息（Electron 默认使用本地 JSON / localStorage 持久化）
  getUser: () => {
    try {
      return getLocalUserStore().getCurrent()
    } catch {
      return buildDefaultLocalUser()
    }
  },
  getUsers: () => {
    try {
      return getLocalUserStore().list()
    } catch {
      return [buildDefaultLocalUser()]
    }
  },
  setUser: (user, options) => getLocalUserStore().save(user, options),
  switchUser: (id) => getLocalUserStore().switch(id),
  removeUser: (id) => getLocalUserStore().delete(id),

  // uTools 插件生命周期（在 Electron 中无此概念，提供空操作）
  onPluginEnter: notImplemented('onPluginEnter'),
  onPluginOut: notImplemented('onPluginOut'),
  setSubInput: notImplemented('setSubInput'),
  subInputBlur: notImplemented('subInputBlur'),
  outPlugin: notImplemented('outPlugin')
}

// ---------- 导出 ----------

// 在 uTools 环境使用原生 API，否则使用 Electron 模拟
export const utools = hasUtools ? window.utools : electronUtools

// 运行时环境标识
export const runtime = hasUtools ? 'utools' : (electronAPI ? 'electron' : 'browser')

// 默认导出
export default utools

// ---------- MCP 工具审批事件桥接 ----------
// 在 Electron 中，preload（builtins）和 renderer（Vue UI）有各自隔离的 window。
// 工具审批事件通过 IPC 在两者间中继。

if (!hasUtools && electronAPI) {
  // 配置变更事件中继：preload → IPC → renderer window
  // global-config.js 在 preload 中保存配置后派发 globalConfigChanged，
  // 需要通过此桥接让渲染进程的 configListener 能够接收到变更通知
  electronAPI.onConfigChanged?.(({ eventType, detail }) => {
    window.dispatchEvent(new CustomEvent(eventType, { detail }))
  })

  // 工具审批事件中继：preload ↔ renderer
  electronAPI.onToolApprovalRequest((data) => {
    window.dispatchEvent(new CustomEvent('builtin-agents-tool-approval-request', { detail: data }))
  })

  window.addEventListener('builtin-agents-tool-approval-response', (event) => {
    electronAPI.respondToolApproval(event.detail)
  })
}
