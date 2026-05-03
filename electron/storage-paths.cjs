const fs = require('node:fs')
const path = require('node:path')

const STORAGE_STATE_FILE = '.ai-tools-storage.json'
const DEFAULT_DATA_ROOT_SUFFIX = path.join('users', 'local-default')
const LEGACY_DB_FILENAME = 'aitools.db'

function normalizeAbsolutePath(value) {
  const text = String(value || '').trim()
  if (!text || text.includes('\0')) return ''
  return path.isAbsolute(text) ? path.resolve(text) : ''
}

function getDefaultDataStorageRoot(userDataRoot) {
  const root = normalizeAbsolutePath(userDataRoot)
  if (!root) return ''
  return path.join(root, DEFAULT_DATA_ROOT_SUFFIX)
}

function getLegacyDbPath(userDataRoot) {
  const root = normalizeAbsolutePath(userDataRoot)
  if (!root) return ''
  return path.join(getDefaultDataStorageRoot(root), LEGACY_DB_FILENAME)
}

function getStorageStatePath(userDataRoot) {
  const root = normalizeAbsolutePath(userDataRoot)
  if (!root) return ''
  return path.join(root, STORAGE_STATE_FILE)
}

function readStorageState(userDataRoot) {
  const statePath = getStorageStatePath(userDataRoot)
  if (!statePath || !fs.existsSync(statePath)) {
    return { dataStorageRoot: '' }
  }

  try {
    const parsed = JSON.parse(String(fs.readFileSync(statePath, 'utf-8') || '{}'))
    return {
      dataStorageRoot: normalizeAbsolutePath(parsed?.dataStorageRoot),
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : ''
    }
  } catch {
    return { dataStorageRoot: '' }
  }
}

function writeStorageState(userDataRoot, dataStorageRoot) {
  const statePath = getStorageStatePath(userDataRoot)
  if (!statePath) return ''

  const payload = {
    dataStorageRoot: normalizeAbsolutePath(dataStorageRoot),
    updatedAt: new Date().toISOString()
  }

  const dir = path.dirname(statePath)
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
  return statePath
}

function removeStorageState(userDataRoot) {
  const statePath = getStorageStatePath(userDataRoot)
  if (!statePath) return false

  try {
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath)
    }
    return true
  } catch {
    return false
  }
}

function resolveStoragePaths(userDataRoot) {
  const defaultDataStorageRoot = getDefaultDataStorageRoot(userDataRoot)
  const state = readStorageState(userDataRoot)
  const dataStorageRoot = state.dataStorageRoot || defaultDataStorageRoot

  return {
    dataStorageRoot,
    dbPath: path.join(dataStorageRoot, LEGACY_DB_FILENAME),
    statePath: getStorageStatePath(userDataRoot)
  }
}

function copyDirectoryContents(sourceRoot, targetRoot, options = {}) {
  const fromRoot = normalizeAbsolutePath(sourceRoot)
  const toRoot = normalizeAbsolutePath(targetRoot)
  if (!fromRoot || !toRoot || fromRoot === toRoot) return false
  if (!fs.existsSync(fromRoot)) return false

  const excludeNames = new Set(Array.isArray(options.excludeNames) ? options.excludeNames.map((name) => String(name || '').trim()).filter(Boolean) : [])

  const walk = (srcDir, dstDir) => {
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true })
    }

    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      if (excludeNames.has(entry.name)) continue

      const srcPath = path.join(srcDir, entry.name)
      const dstPath = path.join(dstDir, entry.name)

      if (entry.isDirectory()) {
        walk(srcPath, dstPath)
      } else if (entry.isFile()) {
        if (!fs.existsSync(dstPath)) {
          fs.mkdirSync(path.dirname(dstPath), { recursive: true })
          fs.copyFileSync(srcPath, dstPath)
        }
      }
    }
  }

  walk(fromRoot, toRoot)
  return true
}

module.exports = {
  getDefaultDataStorageRoot,
  getLegacyDbPath,
  getStorageStatePath,
  readStorageState,
  writeStorageState,
  removeStorageState,
  copyDirectoryContents,
  resolveStoragePaths
}
