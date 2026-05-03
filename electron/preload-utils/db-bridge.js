// Synchronous bridge to persisted config storage.
// In Electron preload it talks to the main-process SQLite bridge.
// In tests / legacy uTools-compatible runtimes it falls back to utools.dbCryptoStorage.

function getElectronIpcRenderer() {
  try {
    return require('electron')?.ipcRenderer || null
  } catch {
    return null
  }
}

function getUtoolsStorage() {
  return globalThis?.utools?.dbCryptoStorage || null
}

function getUtoolsUserDataPath() {
  try {
    const value = globalThis?.utools?.getPath?.('userData')
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

function getFallbackStorage() {
  return getUtoolsStorage() || globalThis?.localStorage || null
}

function readFallbackJson(key, fallback = null) {
  const storage = getFallbackStorage()
  if (!storage?.getItem) return fallback
  try {
    const raw = storage.getItem(key)
    if (raw == null || raw === '') return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeFallbackJson(key, value) {
  const storage = getFallbackStorage()
  if (!storage?.setItem) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function removeFallbackItem(key) {
  const storage = getFallbackStorage()
  if (!storage?.removeItem) return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function nowIso() {
  return new Date().toISOString()
}

function buildDefaultUser() {
  const now = nowIso()
  return {
    id: 'local-default',
    nickname: '本地用户',
    displayName: '本地用户',
    email: '',
    avatar: '',
    provider: 'local',
    role: 'owner',
    createdAt: now,
    updatedAt: now
  }
}

function normalizeUser(raw, fallbackId = 'local-default') {
  const source = raw && typeof raw === 'object' ? raw : {}
  const fallback = buildDefaultUser()
  const id = String(source.id || source._id || fallbackId || fallback.id).trim() || fallback.id
  const nickname = String(source.nickname || source.displayName || source.name || fallback.nickname).trim() || fallback.nickname
  return {
    id,
    nickname,
    displayName: String(source.displayName || source.nickname || source.name || nickname).trim() || nickname,
    email: String(source.email || '').trim(),
    avatar: String(source.avatar || source.avatarUrl || '').trim(),
    provider: String(source.provider || fallback.provider).trim() || fallback.provider,
    role: String(source.role || fallback.role).trim() || fallback.role,
    createdAt: String(source.createdAt || fallback.createdAt).trim() || fallback.createdAt,
    updatedAt: String(source.updatedAt || nowIso()).trim() || nowIso()
  }
}

function normalizeUserState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const inputUsers = Array.isArray(source.users) ? source.users : []
  const users = []
  const seen = new Set()

  inputUsers.forEach((item, index) => {
    const normalized = normalizeUser(item, `local-default-${index + 1}`)
    if (seen.has(normalized.id)) return
    seen.add(normalized.id)
    users.push(normalized)
  })

  if (!users.length) {
    const defaultUser = buildDefaultUser()
    users.push(defaultUser)
    seen.add(defaultUser.id)
  }

  const currentUserId = String(source.currentUserId || '').trim()
  return {
    version: 1,
    currentUserId: seen.has(currentUserId) ? currentUserId : users[0].id,
    users,
    updatedAt: String(source.updatedAt || nowIso()).trim() || nowIso()
  }
}

function readFallbackUserState() {
  return normalizeUserState(readFallbackJson('ai-tools:local-users', null))
}

function writeFallbackUserState(nextState) {
  const normalized = normalizeUserState(nextState)
  writeFallbackJson('ai-tools:local-users', normalized)
  return normalized
}

module.exports = {
  getItem(key) {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      return ipcRenderer.sendSync('db:getItem', key)
    }

    const storage = getUtoolsStorage()
    if (storage?.getItem) {
      return storage.getItem(key)
    }

    return null
  },

  setItem(key, value) {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      return ipcRenderer.sendSync('db:setItem', key, value)
    }

    const storage = getUtoolsStorage()
    if (storage?.setItem) {
      return storage.setItem(key, value)
    }

    return false
  },

  removeItem(key) {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      return ipcRenderer.sendSync('db:removeItem', key)
    }

    const storage = getUtoolsStorage()
    if (storage?.removeItem) {
      return storage.removeItem(key)
    }

    return false
  },

  async exportDatabase() {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.invoke) {
      const payload = await ipcRenderer.invoke('db:export')
      if (typeof payload === 'string') return payload
      if (Buffer.isBuffer(payload)) return payload.toString('base64')
      if (payload?.type === 'Buffer' && Array.isArray(payload.data)) {
        return Buffer.from(payload.data).toString('base64')
      }
      return ''
    }
    return ''
  },

  async importDatabase(payload) {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.invoke) {
      return await ipcRenderer.invoke('db:import', payload)
    }
    return false
  },

  getCurrentUserId() {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      try {
        return String(ipcRenderer.sendSync('user:getCurrentId') || '').trim() || 'local-default'
      } catch {
        // fall through
      }
    }

    return readFallbackUserState().currentUserId
  },

  getCurrentUser() {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      try {
        return ipcRenderer.sendSync('user:getCurrent') || buildDefaultUser()
      } catch {
        // fall through
      }
    }

    const state = readFallbackUserState()
    return state.users.find((item) => item.id === state.currentUserId) || state.users[0] || buildDefaultUser()
  },

  listUsers() {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      try {
        return ipcRenderer.sendSync('user:list') || []
      } catch {
        // fall through
      }
    }

    return readFallbackUserState().users
  },

  saveUser(user, options = {}) {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      try {
        return ipcRenderer.sendSync('user:save', user, options) || buildDefaultUser()
      } catch {
        // fall through
      }
    }

    const state = readFallbackUserState()
    const activate = options?.activate !== false
    const normalizedUser = normalizeUser(user, state.currentUserId || 'local-default')
    const previous = state.users.find((item) => item.id === normalizedUser.id)
    const nextUsers = state.users.filter((item) => item.id !== normalizedUser.id)

    nextUsers.push({
      ...normalizedUser,
      createdAt: previous?.createdAt || normalizedUser.createdAt,
      updatedAt: nowIso()
    })

    const nextState = writeFallbackUserState({
      ...state,
      currentUserId: activate ? normalizedUser.id : state.currentUserId,
      users: nextUsers,
      updatedAt: nowIso()
    })

    return nextState.users.find((item) => item.id === nextState.currentUserId) || nextState.users[0] || buildDefaultUser()
  },

  switchUser(id) {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      try {
        return ipcRenderer.sendSync('user:switch', id) || buildDefaultUser()
      } catch {
        // fall through
      }
    }

    const state = readFallbackUserState()
    const targetId = String(id || '').trim()
    if (!targetId) return state.users.find((item) => item.id === state.currentUserId) || state.users[0] || buildDefaultUser()
    if (!state.users.some((item) => item.id === targetId)) {
      throw new Error(`User not found: ${targetId}`)
    }

    const nextState = writeFallbackUserState({
      ...state,
      currentUserId: targetId,
      updatedAt: nowIso()
    })

    return nextState.users.find((item) => item.id === nextState.currentUserId) || nextState.users[0] || buildDefaultUser()
  },

  deleteUser(id) {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      try {
        return ipcRenderer.sendSync('user:delete', id) || []
      } catch {
        // fall through
      }
    }

    const state = readFallbackUserState()
    const targetId = String(id || '').trim()
    const filteredUsers = state.users.filter((item) => item.id !== targetId)
    const safeUsers = filteredUsers.length ? filteredUsers : [buildDefaultUser()]
    const nextState = writeFallbackUserState({
      ...state,
      currentUserId: safeUsers.some((item) => item.id === state.currentUserId) ? state.currentUserId : safeUsers[0].id,
      users: safeUsers,
      updatedAt: nowIso()
    })
    return nextState.users
  },

  getUserDataPath() {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      try {
        return ipcRenderer.sendSync('app:getPathSync', 'userData')
      } catch {
        // fall through
      }
    }

    return getUtoolsUserDataPath()
  },

  rebindStorageRoot(rootPath) {
    const ipcRenderer = getElectronIpcRenderer()
    if (ipcRenderer?.sendSync) {
      try {
        const result = ipcRenderer.sendSync('db:rebindStorageRoot', rootPath)
        return result !== false && result !== null && result !== undefined && String(result || '').trim() !== ''
      } catch {
        // fall through
      }
    }

    return !!String(rootPath || '').trim()
  }
}
