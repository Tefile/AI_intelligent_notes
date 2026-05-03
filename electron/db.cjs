const initSqlJs = require('sql.js')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

let dbPath = ''
let db = null
let SQL = null
let encryptionPassword = ''
let dbLocked = false

const ENCRYPTION_CONTAINER_MAGIC = 'AITOOLS_DB_ENC_V1'
const ENCRYPTION_ITERATIONS = 240000
const ENCRYPTION_ALGORITHM = 'AES-256-GCM'
const PASSWORD_CACHE_SUFFIX = '.pass'

function getElectronSafeStorage() {
  try {
    return require('electron')?.safeStorage || null
  } catch {
    return null
  }
}

const DEFAULT_USER_ID = 'local-default'
const DEFAULT_USER_NAME = 'Local User'
const CURRENT_USER_STATE_KEY = 'current_user_id'

function nowIso() {
  return new Date().toISOString()
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function getPasswordCachePath() {
  return dbPath ? `${dbPath}${PASSWORD_CACHE_SUFFIX}` : ''
}

function isEncryptedContainer(buffer) {
  if (!buffer) return false
  const prefix = Buffer.from(`${ENCRYPTION_CONTAINER_MAGIC}\n`, 'utf8')
  return Buffer.from(buffer).subarray(0, prefix.length).equals(prefix)
}

function deriveEncryptionKey(password, salt) {
  return crypto.pbkdf2Sync(String(password || ''), salt, ENCRYPTION_ITERATIONS, 32, 'sha256')
}

function encryptDatabaseBuffer(plaintextBuffer, password) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = deriveEncryptionKey(password, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintextBuffer)), cipher.final()])
  const authTag = cipher.getAuthTag()
  const payload = {
    v: 1,
    alg: ENCRYPTION_ALGORITHM,
    kdf: 'PBKDF2-SHA256',
    iterations: ENCRYPTION_ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
  return Buffer.from(`${ENCRYPTION_CONTAINER_MAGIC}\n${JSON.stringify(payload)}\n`, 'utf8')
}

function decryptDatabaseBuffer(containerBuffer, password) {
  const text = Buffer.from(containerBuffer).toString('utf8')
  const firstNewline = text.indexOf('\n')
  const secondNewline = text.indexOf('\n', firstNewline + 1)
  if (firstNewline < 0 || secondNewline < 0) {
    throw new Error('encrypted database container is invalid')
  }
  const header = text.slice(firstNewline + 1, secondNewline)
  const payload = JSON.parse(header)
  if (payload?.alg !== ENCRYPTION_ALGORITHM || payload?.kdf !== 'PBKDF2-SHA256') {
    throw new Error('unsupported database encryption format')
  }
  const salt = Buffer.from(String(payload.salt || ''), 'base64')
  const iv = Buffer.from(String(payload.iv || ''), 'base64')
  const authTag = Buffer.from(String(payload.authTag || ''), 'base64')
  const ciphertext = Buffer.from(String(payload.ciphertext || ''), 'base64')
  const key = deriveEncryptionKey(password, salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function readPasswordCache() {
  const cachePath = getPasswordCachePath()
  if (!cachePath || !fs.existsSync(cachePath)) return ''
  const safeStorage = getElectronSafeStorage()
  try {
    const raw = fs.readFileSync(cachePath)
    if (safeStorage?.decryptString) {
      return String(safeStorage.decryptString(raw) || '')
    }
    return raw.toString('utf8')
  } catch {
    return ''
  }
}

function writePasswordCache(password) {
  const cachePath = getPasswordCachePath()
  if (!cachePath) return false
  const safeStorage = getElectronSafeStorage()
  try {
    ensureParentDir(cachePath)
    const text = String(password || '')
    const payload = safeStorage?.encryptString ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8')
    fs.writeFileSync(cachePath, payload)
    return true
  } catch {
    return false
  }
}

function clearPasswordCache() {
  const cachePath = getPasswordCachePath()
  if (!cachePath) return false
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
    return true
  } catch {
    return false
  }
}

function updateEncryptionRuntime(password, { persistCache = true } = {}) {
  const text = String(password || '')
  encryptionPassword = text
  dbLocked = false
  if (persistCache) {
    if (text) {
      writePasswordCache(text)
    } else {
      clearPasswordCache()
    }
  }
  return text
}

function getEncryptionState() {
  const fileExists = !!dbPath && fs.existsSync(dbPath)
  const cachedPassword = encryptionPassword || readPasswordCache()
  return {
    encrypted: fileExists ? isEncryptedContainer(fs.readFileSync(dbPath)) : false,
    locked: dbLocked,
    hasPassword: !!cachedPassword,
    passwordCached: !!encryptionPassword || !!readPasswordCache()
  }
}

function readDatabaseFileBuffer() {
  if (!dbPath || !fs.existsSync(dbPath)) return null
  return fs.readFileSync(dbPath)
}

function loadDatabaseFromDisk(passwordCandidate = '') {
  const buffer = readDatabaseFileBuffer()
  if (!buffer) {
    loadDatabaseFromBuffer(null)
    return { encrypted: false, loaded: true }
  }

  if (isEncryptedContainer(buffer)) {
    const effectivePassword = String(passwordCandidate || encryptionPassword || readPasswordCache() || '')
    if (!effectivePassword) {
      db = null
      dbLocked = true
      return { encrypted: true, loaded: false, locked: true }
    }
    const decrypted = decryptDatabaseBuffer(buffer, effectivePassword)
    updateEncryptionRuntime(effectivePassword, { persistCache: false })
    loadDatabaseFromBuffer(decrypted)
    return { encrypted: true, loaded: true }
  }

  loadDatabaseFromBuffer(buffer)
  return { encrypted: false, loaded: true }
}

function loadDatabaseFromBuffer(buffer) {
  db = new SQL.Database(buffer ? Buffer.from(buffer) : undefined)

  db.run('PRAGMA journal_mode = OFF')
  db.run('PRAGMA foreign_keys = ON')

  db.run(`
    CREATE TABLE IF NOT EXISTS app_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      nickname     TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      email        TEXT NOT NULL DEFAULT '',
      avatar       TEXT NOT NULL DEFAULT '',
      provider     TEXT NOT NULL DEFAULT 'sqlite',
      role         TEXT NOT NULL DEFAULT 'owner',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL DEFAULT '',
      path           TEXT NOT NULL UNIQUE,
      folder         TEXT NOT NULL DEFAULT '',
      user_id        TEXT NOT NULL DEFAULT 'local-default',
      messages_json  TEXT NOT NULL DEFAULT '[]',
      state_json     TEXT NOT NULL DEFAULT '{}',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  try { db.run("ALTER TABLE chat_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local-default'") } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_sessions_folder ON chat_sessions(folder)') } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_sessions_path ON chat_sessions(path)') } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON chat_sessions(user_id)') } catch {}

  listUsers()
  getCurrentUserId()
  db.run("UPDATE chat_sessions SET user_id = ? WHERE user_id IS NULL OR user_id = ''", [getCurrentUserId()])
  saveToDisk()
  dbLocked = false
  return db
}

function normalizeUserId(value, fallback = DEFAULT_USER_ID) {
  const raw = String(value || '').trim()
  return raw || fallback
}

function buildDefaultUser() {
  const now = nowIso()
  return {
    id: DEFAULT_USER_ID,
    nickname: DEFAULT_USER_NAME,
    displayName: DEFAULT_USER_NAME,
    email: '',
    avatar: '',
    provider: 'sqlite',
    role: 'owner',
    createdAt: now,
    updatedAt: now
  }
}

function hydrateUser(row) {
  return {
    id: String(row.id || '').trim(),
    nickname: String(row.nickname || '').trim(),
    displayName: String(row.display_name || '').trim(),
    email: String(row.email || '').trim(),
    avatar: String(row.avatar || '').trim(),
    provider: String(row.provider || 'sqlite').trim() || 'sqlite',
    role: String(row.role || 'owner').trim() || 'owner',
    createdAt: String(row.created_at || '').trim(),
    updatedAt: String(row.updated_at || '').trim()
  }
}

function normalizeUser(raw, fallbackId = DEFAULT_USER_ID) {
  const source = isPlainObject(raw) ? raw : {}
  const fallback = buildDefaultUser()
  const id = normalizeUserId(source.id || source._id || fallbackId || fallback.id, fallback.id)
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

function hydrateSession(row) {
  return {
    id: row.id,
    title: row.title,
    path: row.path,
    folder: row.folder,
    user_id: row.user_id,
    messages: JSON.parse(row.messages_json || '[]'),
    state: JSON.parse(row.state_json || '{}'),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function ensureParentDir(filePath) {
  const parentDir = path.dirname(filePath)
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true })
  }
}

function saveToDisk() {
  if (!db || !dbPath || (dbLocked && !encryptionPassword)) return
  try {
    const plainBuffer = Buffer.from(db.export())
    const outputBuffer = encryptionPassword
      ? encryptDatabaseBuffer(plainBuffer, encryptionPassword)
      : plainBuffer
    ensureParentDir(dbPath)
    fs.writeFileSync(dbPath, outputBuffer)
  } catch (err) {
    console.error('[db] failed to save database', err?.message || err)
  }
}

function rebindDatabasePath(nextDbPath) {
  const normalizedPath = typeof nextDbPath === 'string' ? path.resolve(String(nextDbPath).trim()) : ''
  if (!normalizedPath) throw new Error('database path is required')

  const previousPath = dbPath
  if (previousPath === normalizedPath) {
    ensureParentDir(dbPath)
    if (encryptionPassword) {
      writePasswordCache(encryptionPassword)
    }
    return dbPath
  }

  dbPath = normalizedPath
  ensureParentDir(dbPath)
  saveToDisk()
  if (encryptionPassword) {
    writePasswordCache(encryptionPassword)
  } else {
    clearPasswordCache()
  }
  return dbPath
}

function exportDatabase() {
  if (!db) throw new Error('database is not initialized')
  saveToDisk()
  return Buffer.from(db.export())
}

function importDatabase(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new Error('database buffer is required')
  }
  if (!dbPath) throw new Error('database path is not initialized')
  const normalizedBuffer = Buffer.from(buffer)
  if (db) {
    try {
      db.close()
    } catch {}
  }
  db = new SQL.Database(normalizedBuffer)
  saveToDisk()
  return true
}

function readAppStateValue(key) {
  if (!db) return null
  try {
    const stmt = db.prepare('SELECT value FROM app_state WHERE key = ?')
    stmt.bind([key])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return row.value ?? null
    }
    stmt.free()
  } catch {}
  return null
}

function writeAppStateValue(key, value) {
  if (!db) return false
  db.run(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, String(value ?? '')]
  )
  return true
}

function listUsers() {
  if (!db) return [buildDefaultUser()]
  const rows = []
  try {
    const stmt = db.prepare('SELECT * FROM users ORDER BY created_at ASC, updated_at ASC')
    while (stmt.step()) {
      rows.push(hydrateUser(stmt.getAsObject()))
    }
    stmt.free()
  } catch {}

  if (!rows.length) {
    const fallback = buildDefaultUser()
    db.run(
      `INSERT INTO users (id, nickname, display_name, email, avatar, provider, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fallback.id, fallback.nickname, fallback.displayName, fallback.email, fallback.avatar, fallback.provider, fallback.role, fallback.createdAt, fallback.updatedAt]
    )
    writeAppStateValue(CURRENT_USER_STATE_KEY, fallback.id)
    return [fallback]
  }

  return rows
}

function getCurrentUserId() {
  if (!db) return DEFAULT_USER_ID

  const currentId = normalizeUserId(readAppStateValue(CURRENT_USER_STATE_KEY), DEFAULT_USER_ID)
  const users = listUsers()
  if (users.some((item) => item.id === currentId)) {
    return currentId
  }

  const fallback = users[0] || buildDefaultUser()
  writeAppStateValue(CURRENT_USER_STATE_KEY, fallback.id)
  return fallback.id
}

function getCurrentUser() {
  const currentId = getCurrentUserId()
  const user = listUsers().find((item) => item.id === currentId)
  return user ? clone(user) : clone(buildDefaultUser())
}

function saveUser(user, options = {}) {
  if (!db) throw new Error('database is not initialized')
  const activate = options?.activate !== false
  const normalized = normalizeUser(user, getCurrentUserId())
  const existing = listUsers().find((item) => item.id === normalized.id)
  const createdAt = existing?.createdAt || normalized.createdAt
  const updatedAt = nowIso()

  db.run(
    `INSERT INTO users (id, nickname, display_name, email, avatar, provider, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       nickname = excluded.nickname,
       display_name = excluded.display_name,
       email = excluded.email,
       avatar = excluded.avatar,
       provider = excluded.provider,
       role = excluded.role,
       updated_at = excluded.updated_at`,
    [
      normalized.id,
      normalized.nickname,
      normalized.displayName,
      normalized.email,
      normalized.avatar,
      normalized.provider,
      normalized.role,
      createdAt,
      updatedAt
    ]
  )

  if (activate) {
    writeAppStateValue(CURRENT_USER_STATE_KEY, normalized.id)
  }

  saveToDisk()
  return getCurrentUser()
}

function cleanupUserScopedData(userId) {
  const normalized = normalizeUserId(userId)
  const prefix = `user:${normalized}:`
  db.run('DELETE FROM kv_store WHERE key LIKE ?', [`${prefix}%`])
  db.run('DELETE FROM chat_sessions WHERE user_id = ?', [normalized])
}

function switchUser(id) {
  if (!db) throw new Error('database is not initialized')
  const targetId = normalizeUserId(id, '')
  if (!targetId) return getCurrentUser()

  const users = listUsers()
  if (!users.some((item) => item.id === targetId)) {
    throw new Error(`User not found: ${targetId}`)
  }

  writeAppStateValue(CURRENT_USER_STATE_KEY, targetId)
  saveToDisk()
  return getCurrentUser()
}

function deleteUser(id) {
  if (!db) throw new Error('database is not initialized')
  const targetId = normalizeUserId(id, '')
  if (!targetId) return listUsers()

  const users = listUsers()
  if (!users.some((item) => item.id === targetId)) {
    return users
  }

  const remaining = users.filter((item) => item.id !== targetId)
  const safeUsers = remaining.length ? remaining : [buildDefaultUser()]

  cleanupUserScopedData(targetId)
  db.run('DELETE FROM users WHERE id = ?', [targetId])

  if (!remaining.length) {
    const fallback = safeUsers[0]
    db.run(
      `INSERT INTO users (id, nickname, display_name, email, avatar, provider, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fallback.id, fallback.nickname, fallback.displayName, fallback.email, fallback.avatar, fallback.provider, fallback.role, fallback.createdAt, fallback.updatedAt]
    )
    writeAppStateValue(CURRENT_USER_STATE_KEY, fallback.id)
  } else {
    const currentId = getCurrentUserId()
    if (currentId === targetId || !safeUsers.some((item) => item.id === currentId)) {
      writeAppStateValue(CURRENT_USER_STATE_KEY, safeUsers[0].id)
    }
  }

  saveToDisk()
  return safeUsers
}

async function init(_dbPath) {
  dbPath = _dbPath
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  SQL = await initSqlJs()
  try {
    const result = loadDatabaseFromDisk()
    if (!result.loaded) {
      return null
    }
  } catch (err) {
    console.error('[db] failed to initialize database', err?.message || err)
    db = new SQL.Database()
    dbLocked = false
  }

  return db
}

function close() {
  if (!db) return
  saveToDisk()
  db.close()
  db = null
}

function getItem(key) {
  if (!db) return null
  try {
    const stmt = db.prepare('SELECT value FROM kv_store WHERE key = ?')
    stmt.bind([key])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return JSON.parse(row.value)
    }
    stmt.free()
    return null
  } catch {
    return null
  }
}

function setItem(key, value) {
  if (!db) return false
  try {
    const json = JSON.stringify(value)
    db.run(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, json]
    )
    saveToDisk()
    return true
  } catch {
    return false
  }
}

function removeItem(key) {
  if (!db) return false
  try {
    db.run('DELETE FROM kv_store WHERE key = ?', [key])
    saveToDisk()
    return true
  } catch {
    return false
  }
}

function setEncryptionPassword(password) {
  const nextPassword = updateEncryptionRuntime(password, { persistCache: true })
  if (!db && fs.existsSync(dbPath)) {
    loadDatabaseFromDisk(nextPassword)
  }
  saveToDisk()
  return getEncryptionState()
}

function clearEncryptionPassword() {
  updateEncryptionRuntime('', { persistCache: true })
  saveToDisk()
  return getEncryptionState()
}

function sessionCreate(data) {
  if (!db) throw new Error('database is not initialized')
  const id = data.id || _uuid()
  const title = data.title || ''
  const fp = data.path || id
  const folder = data.folder || ''
  const userId = getCurrentUserId()
  const messagesJson = JSON.stringify(data.messages || [])
  const stateJson = JSON.stringify(data.state || {})

  db.run(
    `INSERT OR REPLACE INTO chat_sessions (id, title, path, folder, user_id, messages_json, state_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [id, title, fp, folder, userId, messagesJson, stateJson]
  )
  saveToDisk()
  return sessionGet(id)
}

function sessionUpdate(id, patch) {
  if (!db) throw new Error('database is not initialized')
  const sets = []
  const vals = []

  if (patch.title !== undefined) { sets.push('title = ?'); vals.push(patch.title) }
  if (patch.path !== undefined) { sets.push('path = ?'); vals.push(patch.path) }
  if (patch.folder !== undefined) { sets.push('folder = ?'); vals.push(patch.folder) }
  if (patch.messages !== undefined) { sets.push('messages_json = ?'); vals.push(JSON.stringify(patch.messages)) }
  if (patch.state !== undefined) { sets.push('state_json = ?'); vals.push(JSON.stringify(patch.state)) }

  if (sets.length === 0) return sessionGet(id)

  sets.push('updated_at = datetime(\'now\')')
  vals.push(id)
  vals.push(getCurrentUserId())

  db.run(`UPDATE chat_sessions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, vals)
  saveToDisk()
  return sessionGet(id)
}

function sessionDelete(id) {
  if (!db) throw new Error('database is not initialized')
  db.run('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?', [id, getCurrentUserId()])
  saveToDisk()
  return { ok: true }
}

function sessionGet(id) {
  if (!db) return null
  try {
    const stmt = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?')
    stmt.bind([id, getCurrentUserId()])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return hydrateSession(row)
    }
    stmt.free()
    return null
  } catch {
    return null
  }
}

function sessionGetByPath(fp) {
  if (!db) return null
  try {
    const stmt = db.prepare('SELECT * FROM chat_sessions WHERE path = ? AND user_id = ?')
    stmt.bind([fp, getCurrentUserId()])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return hydrateSession(row)
    }
    stmt.free()
    return null
  } catch {
    return null
  }
}

function sessionListByFolder(folder) {
  if (!db) return []
  const rows = []
  try {
    const stmt = db.prepare('SELECT * FROM chat_sessions WHERE folder = ? AND user_id = ? ORDER BY updated_at DESC')
    stmt.bind([folder, getCurrentUserId()])
    while (stmt.step()) {
      rows.push(hydrateSession(stmt.getAsObject()))
    }
    stmt.free()
  } catch {}
  return rows
}

function sessionListTree() {
  if (!db) return {}
  const tree = {}
  try {
    const stmt = db.prepare('SELECT id, title, path, folder, created_at, updated_at FROM chat_sessions WHERE user_id = ? ORDER BY folder, updated_at DESC')
    stmt.bind([getCurrentUserId()])
    while (stmt.step()) {
      const row = stmt.getAsObject()
      const folder = row.folder || '__root__'
      if (!tree[folder]) tree[folder] = []
      tree[folder].push({
        id: row.id,
        title: row.title,
        path: row.path,
        folder: row.folder,
        created_at: row.created_at,
        updated_at: row.updated_at
      })
    }
    stmt.free()
  } catch {}
  return tree
}

function _uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

module.exports = {
  init,
  close,
  rebindDatabasePath,
  setEncryptionPassword,
  clearEncryptionPassword,
  getEncryptionState,
  getItem,
  setItem,
  removeItem,
  sessionCreate,
  sessionUpdate,
  sessionDelete,
  sessionGet,
  sessionGetByPath,
  sessionListByFolder,
  sessionListTree,
  getCurrentUserId,
  getCurrentUser,
  listUsers,
  saveUser,
  switchUser,
  deleteUser,
  exportDatabase,
  importDatabase,
  getDbPath: () => dbPath
}
