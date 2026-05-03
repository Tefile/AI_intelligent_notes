// MySQL 同步桥接：提供数据库同步所需的本地适配层。
const path = require('path')
const fs = require('fs').promises
const crypto = require('crypto')
const mysql = require('mysql2/promise')
const globalConfig = require('./global-config')
const dbBridge = require('./db-bridge')

const MYSQL_SYNC_TABLE_PREFIX = 'aitools_'

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex')
}

function normalizeSyncOverride(raw) {
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

function normalizeRelativePath(input) {
    return String(input || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
}

function nowIso() {
    return new Date().toISOString()
}

function buildPathKey(input) {
    return sha256(normalizeRelativePath(input))
}

function toIsoOrEmpty(value) {
    const text = String(value || '').trim()
    if (!text) return ''
    const time = Date.parse(text)
    return Number.isFinite(time) ? new Date(time).toISOString() : ''
}

function toTimestamp(value) {
    const iso = toIsoOrEmpty(value)
    if (!iso) return 0
    const ts = Date.parse(iso)
    return Number.isFinite(ts) ? ts : 0
}

function sortByKey(items) {
    return [...items].sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')))
}

function stableSerialize(value) {
    if (Array.isArray(value)) {
        return value.map((item) => stableSerialize(item))
    }
    if (!value || typeof value !== 'object') {
        return value
    }

    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    const next = {}
    for (const [key, nestedValue] of entries) {
        next[key] = stableSerialize(nestedValue)
    }
    return next
}

class MysqlSyncService {
    _getConfig(override = null) {
        const normalizedOverride = normalizeSyncOverride(override)
        const syncConfig = normalizedOverride.syncConfig && typeof normalizedOverride.syncConfig === 'object'
            ? normalizedOverride.syncConfig
            : (
                normalizedOverride.enabled !== undefined
                || normalizedOverride.provider !== undefined
                || normalizedOverride.cloud !== undefined
                || normalizedOverride.mysql !== undefined
                || normalizedOverride.scope !== undefined
                || normalizedOverride.conflictPolicy !== undefined
            )
                ? normalizedOverride
                : globalConfig.getSyncConfig()
        const mysqlConfig = syncConfig?.mysql || {}
        const required = ['host', 'database', 'username']
        const missing = required.filter((key) => !String(mysqlConfig?.[key] || '').trim())
        if (syncConfig?.provider !== 'mysql' || syncConfig?.enabled !== true) {
            throw new Error('MySQL sync is not enabled')
        }
        if (missing.length) {
            throw new Error(`MySQL sync config is incomplete: ${missing.join(', ')}`)
        }
        return {
            syncConfig,
            mysqlConfig: {
                host: String(mysqlConfig.host || '').trim(),
                port: Number(mysqlConfig.port || 3306) || 3306,
                database: String(mysqlConfig.database || '').trim(),
                user: String(mysqlConfig.username || '').trim(),
                password: String(mysqlConfig.password || ''),
                multipleStatements: false
            },
            mysqlAdminConfig: {
                host: String(mysqlConfig.host || '').trim(),
                port: Number(mysqlConfig.port || 3306) || 3306,
                user: String(mysqlConfig.username || '').trim(),
                password: String(mysqlConfig.password || ''),
                multipleStatements: false
            },
            databaseName: String(mysqlConfig.database || '').trim(),
            tablePrefix: MYSQL_SYNC_TABLE_PREFIX
        }
    }

    async _connect(override = null) {
        const { mysqlConfig } = this._getConfig(override)
        return mysql.createConnection(mysqlConfig)
    }

    async _connectAdmin(override = null) {
        const { mysqlAdminConfig } = this._getConfig(override)
        return mysql.createConnection(mysqlAdminConfig)
    }

    async _ensureDatabaseExists(override = null) {
        const { databaseName } = this._getConfig(override)
        if (!databaseName) {
            throw new Error('MySQL database is not configured')
        }

        const conn = await this._connectAdmin(override)
        try {
            const [existingRows] = await conn.query('SHOW DATABASES LIKE ?', [databaseName])
            await conn.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
            return {
                database: databaseName,
                created: !Array.isArray(existingRows) || existingRows.length === 0
            }
        } finally {
            await conn.end()
        }
    }

    async _tableExists(conn, tableName) {
        const [rows] = await conn.query('SHOW TABLES LIKE ?', [tableName])
        return Array.isArray(rows) && rows.length > 0
    }

    async _columnExists(conn, tableName, columnName) {
        const [rows] = await conn.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName])
        return Array.isArray(rows) && rows.length > 0
    }

    async _ensureColumn(conn, tableName, columnName, columnDefinitionSql) {
        const exists = await this._columnExists(conn, tableName, columnName)
        if (exists) {
            return { created: false }
        }
        await conn.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefinitionSql}`)
        return { created: true }
    }

    async _ensureIndex(conn, tableName, indexName, columnsSql) {
        const [rows] = await conn.query(`SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`, [indexName])
        if (Array.isArray(rows) && rows.length) {
            return { created: false }
        }
        await conn.execute(`CREATE INDEX \`${indexName}\` ON \`${tableName}\` ${columnsSql}`)
        return { created: true }
    }

    async _ensureUniqueIndex(conn, tableName, indexName, columnsSql) {
        const [rows] = await conn.query(`SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`, [indexName])
        if (Array.isArray(rows) && rows.length) {
            return { created: false }
        }
        await conn.execute(`CREATE UNIQUE INDEX \`${indexName}\` ON \`${tableName}\` ${columnsSql}`)
        return { created: true }
    }

    async _ensureSchema(conn, tablePrefix) {
        const usersTable = `${tablePrefix}sync_users`
        const notesTable = `${tablePrefix}sync_notes`
        const noteMetaTable = `${tablePrefix}sync_note_meta`
        const configTable = `${tablePrefix}sync_config`
        const sessionsTable = `${tablePrefix}sync_sessions`
        const notesPathKeyIndex = `${tablePrefix}uk_notes_user_path_key`
        const noteMetaPathKeyIndex = `${tablePrefix}uk_note_meta_user_path_key`
        const sessionsPathKeyIndex = `${tablePrefix}uk_sessions_user_key`
        const notesUpdatedIndex = `${tablePrefix}idx_notes_user_updated`
        const noteMetaUpdatedIndex = `${tablePrefix}idx_note_meta_user_updated`
        const sessionsUpdatedIndex = `${tablePrefix}idx_sessions_user_updated`
        const tableSummaries = [
            { key: 'users', name: usersTable },
            { key: 'notes', name: notesTable },
            { key: 'noteMeta', name: noteMetaTable },
            { key: 'config', name: configTable },
            { key: 'sessions', name: sessionsTable }
        ]
        const tableStates = {}

        for (const item of tableSummaries) {
            tableStates[item.key] = {
                name: item.name,
                created: !(await this._tableExists(conn, item.name))
            }
        }

        await conn.execute(`
            CREATE TABLE IF NOT EXISTS \`${usersTable}\` (
                user_id VARCHAR(191) NOT NULL PRIMARY KEY,
                nickname VARCHAR(255) NOT NULL DEFAULT '',
                display_name VARCHAR(255) NOT NULL DEFAULT '',
                email VARCHAR(320) NOT NULL DEFAULT '',
                avatar TEXT NULL,
                provider VARCHAR(64) NOT NULL DEFAULT 'local',
                role VARCHAR(64) NOT NULL DEFAULT 'owner',
                user_secret VARCHAR(512) NOT NULL DEFAULT '',
                created_at VARCHAR(64) NOT NULL,
                updated_at VARCHAR(64) NOT NULL
            )
        `)
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS \`${notesTable}\` (
                user_id VARCHAR(191) NOT NULL,
                path_key VARCHAR(64) NOT NULL,
                rel_path VARCHAR(1024) NOT NULL,
                content LONGBLOB NOT NULL,
                content_hash VARCHAR(64) NOT NULL,
                updated_at VARCHAR(64) NOT NULL,
                PRIMARY KEY (user_id, path_key)
            )
        `)
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS \`${noteMetaTable}\` (
                user_id VARCHAR(191) NOT NULL,
                path_key VARCHAR(64) NOT NULL,
                rel_path VARCHAR(1024) NOT NULL,
                note_type VARCHAR(64) NOT NULL DEFAULT 'markdown',
                note_name VARCHAR(255) NOT NULL DEFAULT '',
                note_extension VARCHAR(32) NOT NULL DEFAULT '',
                encrypted TINYINT(1) NOT NULL DEFAULT 0,
                has_fallback_recovery TINYINT(1) NOT NULL DEFAULT 0,
                meta_json LONGTEXT NOT NULL,
                meta_hash VARCHAR(64) NOT NULL,
                updated_at VARCHAR(64) NOT NULL,
                PRIMARY KEY (user_id, path_key)
            )
        `)
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS \`${configTable}\` (
                user_id VARCHAR(191) NOT NULL PRIMARY KEY,
                config_json LONGTEXT NOT NULL,
                config_hash VARCHAR(64) NOT NULL,
                updated_at VARCHAR(64) NOT NULL
            )
        `)
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS \`${sessionsTable}\` (
                user_id VARCHAR(191) NOT NULL,
                session_key VARCHAR(64) NOT NULL,
                session_id VARCHAR(1024) NOT NULL,
                session_json LONGTEXT NOT NULL,
                session_hash VARCHAR(64) NOT NULL,
                updated_at VARCHAR(64) NOT NULL,
                PRIMARY KEY (user_id, session_key)
            )
        `)
        const notesPathKeyColumn = await this._ensureColumn(conn, notesTable, 'path_key', `VARCHAR(64) NOT NULL DEFAULT '' AFTER user_id`)
        const noteMetaPathKeyColumn = await this._ensureColumn(conn, noteMetaTable, 'path_key', `VARCHAR(64) NOT NULL DEFAULT '' AFTER user_id`)
        const sessionKeyColumn = await this._ensureColumn(conn, sessionsTable, 'session_key', `VARCHAR(64) NOT NULL DEFAULT '' AFTER user_id`)
        const sessionHashColumn = await this._ensureColumn(conn, sessionsTable, 'session_hash', `VARCHAR(64) NOT NULL DEFAULT '' AFTER session_json`)

        await conn.execute(`UPDATE \`${notesTable}\` SET path_key = SHA2(rel_path, 256) WHERE path_key = '' OR path_key IS NULL`)
        await conn.execute(`UPDATE \`${noteMetaTable}\` SET path_key = SHA2(rel_path, 256) WHERE path_key = '' OR path_key IS NULL`)
        await conn.execute(`UPDATE \`${sessionsTable}\` SET session_key = SHA2(session_id, 256) WHERE session_key = '' OR session_key IS NULL`)
        await conn.execute(`UPDATE \`${sessionsTable}\` SET session_hash = SHA2(session_json, 256) WHERE session_hash = '' OR session_hash IS NULL`)

        const notesKeyIndex = await this._ensureUniqueIndex(conn, notesTable, notesPathKeyIndex, '(user_id, path_key)')
        const noteMetaKeyIndex = await this._ensureUniqueIndex(conn, noteMetaTable, noteMetaPathKeyIndex, '(user_id, path_key)')
        const sessionsKeyIndex = await this._ensureUniqueIndex(conn, sessionsTable, sessionsPathKeyIndex, '(user_id, session_key)')
        const notesIndex = await this._ensureIndex(conn, notesTable, notesUpdatedIndex, '(user_id, updated_at)')
        const noteMetaIndex = await this._ensureIndex(conn, noteMetaTable, noteMetaUpdatedIndex, '(user_id, updated_at)')
        const sessionsIndex = await this._ensureIndex(conn, sessionsTable, sessionsUpdatedIndex, '(user_id, updated_at)')

        return {
            tables: tableStates,
            columns: {
                notesPathKey: {
                    table: notesTable,
                    name: 'path_key',
                    created: notesPathKeyColumn.created === true
                },
                noteMetaPathKey: {
                    table: noteMetaTable,
                    name: 'path_key',
                    created: noteMetaPathKeyColumn.created === true
                },
                sessionKey: {
                    table: sessionsTable,
                    name: 'session_key',
                    created: sessionKeyColumn.created === true
                },
                sessionHash: {
                    table: sessionsTable,
                    name: 'session_hash',
                    created: sessionHashColumn.created === true
                }
            },
            indexes: {
                notesPathKey: {
                    table: notesTable,
                    name: notesPathKeyIndex,
                    created: notesKeyIndex.created === true
                },
                noteMetaPathKey: {
                    table: noteMetaTable,
                    name: noteMetaPathKeyIndex,
                    created: noteMetaKeyIndex.created === true
                },
                sessionsKey: {
                    table: sessionsTable,
                    name: sessionsPathKeyIndex,
                    created: sessionsKeyIndex.created === true
                },
                notesUpdated: {
                    table: notesTable,
                    name: notesUpdatedIndex,
                    created: notesIndex.created === true
                },
                noteMetaUpdated: {
                    table: noteMetaTable,
                    name: noteMetaUpdatedIndex,
                    created: noteMetaIndex.created === true
                },
                sessionsUpdated: {
                    table: sessionsTable,
                    name: sessionsUpdatedIndex,
                    created: sessionsIndex.created === true
                }
            }
        }
    }

    async _getLocalFiles(rootAbs, relativePath = '') {
        const target = path.resolve(rootAbs, relativePath)
        try {
            const entries = await fs.readdir(target, { withFileTypes: true })
            const results = []
            for (const entry of entries) {
                const rel = normalizeRelativePath(path.join(relativePath, entry.name))
                if (entry.isDirectory()) {
                    const nested = await this._getLocalFiles(rootAbs, rel)
                    results.push(...nested)
                } else if (entry.isFile()) {
                    results.push(rel)
                }
            }
            return results
        } catch (err) {
            if (err?.code === 'ENOENT') return []
            throw err
        }
    }

    _getUserId() {
        return String(dbBridge.getCurrentUserId() || 'local-default').trim() || 'local-default'
    }

    _getUserRecord() {
        const user = dbBridge.getCurrentUser?.() || {}
        const userId = this._getUserId()
        const createdAt = toIsoOrEmpty(user.createdAt) || nowIso()
        const updatedAt = toIsoOrEmpty(user.updatedAt) || nowIso()
        return {
            userId,
            nickname: String(user.nickname || '').trim(),
            displayName: String(user.displayName || user.nickname || '').trim(),
            email: String(user.email || '').trim(),
            avatar: String(user.avatar || '').trim(),
            provider: String(user.provider || 'local').trim() || 'local',
            role: String(user.role || 'owner').trim() || 'owner',
            userSecret: sha256(`${userId}:${String(user.createdAt || createdAt)}:${String(user.provider || 'local')}`),
            createdAt,
            updatedAt
        }
    }

    _getDataRoot() {
        const root = String(globalConfig.getDataStorageRoot() || '').trim()
        if (!root) throw new Error('dataStorageRoot is not configured')
        return path.resolve(root)
    }

    _getConfigPayload(scope = {}) {
        const exported = globalConfig.exportConfigObject()
        const includeConfig = scope.config === true
        const includeNoteMeta = scope.noteMeta !== false
        if (!includeConfig && !includeNoteMeta) return null

        const next = includeConfig ? { ...exported } : {}
        next.__syncMeta = {
            type: 'config',
            includeConfig,
            includeNoteMeta
        }

        const noteConfig = exported?.noteConfig && typeof exported.noteConfig === 'object'
            ? { ...exported.noteConfig }
            : {}

        if (includeNoteMeta) {
            noteConfig.noteSecurity = noteConfig.noteSecurity && typeof noteConfig.noteSecurity === 'object'
                ? { ...noteConfig.noteSecurity }
                : { protectedNotes: {} }
        } else if (noteConfig.noteSecurity && typeof noteConfig.noteSecurity === 'object') {
            noteConfig.noteSecurity = {
                ...noteConfig.noteSecurity,
                protectedNotes: {}
            }
        }

        if (includeConfig || includeNoteMeta) {
            next.noteConfig = noteConfig
        }

        return next
    }

    _getConfigHash(payload) {
        return sha256(JSON.stringify(stableSerialize(payload)))
    }

    _getLocalNoteMetaMap(syncScope) {
        if (syncScope?.noteMeta === false) return new Map()
        const exported = globalConfig.exportConfigObject()
        const protectedNotes = exported?.noteConfig?.noteSecurity?.protectedNotes && typeof exported.noteConfig.noteSecurity.protectedNotes === 'object'
            ? exported.noteConfig.noteSecurity.protectedNotes
            : {}
        const map = new Map()
        Object.entries(protectedNotes).forEach(([rawPath, meta]) => {
            const relPath = normalizeRelativePath(rawPath)
            if (!relPath) return
            const noteType = relPath.endsWith('.ipynb') ? 'notebook' : 'markdown'
            const noteName = path.basename(relPath)
            const noteExtension = path.extname(relPath)
            const metaObject = meta && typeof meta === 'object' ? { ...meta } : {}
            const metaJson = JSON.stringify(metaObject)
            map.set(relPath, {
                type: 'noteMeta',
                key: relPath,
                relPath,
                noteType,
                noteName,
                noteExtension,
                encrypted: 1,
                hasFallbackRecovery: metaObject.hasFallbackRecovery === true ? 1 : 0,
                metaObject,
                metaJson,
                contentHash: sha256(metaJson),
                updatedAt: toIsoOrEmpty(metaObject.updatedAt) || toIsoOrEmpty(globalConfig.getConfigUpdatedAt()) || '1970-01-01T00:00:00.000Z'
            })
        })
        return map
    }

    async _listLocalNotes(rootAbs) {
        const files = await this._getLocalFiles(rootAbs, 'note')
        const items = []
        for (const relPath of files) {
            const absPath = path.join(rootAbs, relPath)
            const content = await fs.readFile(absPath)
            const stat = await fs.stat(absPath)
            items.push({
                type: 'note',
                key: relPath,
                relPath,
                content,
                contentHash: sha256(content),
                updatedAt: stat.mtime.toISOString()
            })
        }
        return sortByKey(items)
    }

    async _listRemoteNotes(conn, tablePrefix, userId) {
        const [rows] = await conn.execute(
            `SELECT rel_path, content, content_hash, updated_at
             FROM \`${tablePrefix}sync_notes\`
             WHERE user_id = ?
             ORDER BY rel_path ASC`,
            [userId]
        )
        return rows.map((row) => ({
            type: 'note',
            key: normalizeRelativePath(row.rel_path),
            relPath: normalizeRelativePath(row.rel_path),
            content: row.content,
            contentHash: String(row.content_hash || ''),
            updatedAt: toIsoOrEmpty(row.updated_at)
        }))
    }

    async _listRemoteNoteMeta(conn, tablePrefix, userId) {
        const [rows] = await conn.execute(
            `SELECT rel_path, note_type, note_name, note_extension, encrypted, has_fallback_recovery, meta_json, meta_hash, updated_at
             FROM \`${tablePrefix}sync_note_meta\`
             WHERE user_id = ?
             ORDER BY rel_path ASC`,
            [userId]
        )
        return rows.map((row) => ({
            type: 'noteMeta',
            key: normalizeRelativePath(row.rel_path),
            relPath: normalizeRelativePath(row.rel_path),
            noteType: String(row.note_type || 'markdown'),
            noteName: String(row.note_name || ''),
            noteExtension: String(row.note_extension || ''),
            encrypted: Number(row.encrypted || 0) ? 1 : 0,
            hasFallbackRecovery: Number(row.has_fallback_recovery || 0) ? 1 : 0,
            metaJson: String(row.meta_json || '{}'),
            metaObject: JSON.parse(String(row.meta_json || '{}')),
            contentHash: String(row.meta_hash || sha256(String(row.meta_json || '{}'))),
            updatedAt: toIsoOrEmpty(row.updated_at)
        }))
    }

    async _getLocalNoteItem(rootAbs, relPath) {
        const normalized = normalizeRelativePath(relPath)
        if (!normalized) return null
        const absPath = path.join(rootAbs, normalized)
        try {
            const content = await fs.readFile(absPath)
            const stat = await fs.stat(absPath)
            return {
                type: 'note',
                key: normalized,
                relPath: normalized,
                content,
                contentHash: sha256(content),
                updatedAt: stat.mtime.toISOString()
            }
        } catch (err) {
            if (err?.code === 'ENOENT') return null
            throw err
        }
    }

    async _getRemoteNoteItem(conn, tablePrefix, userId, relPath) {
        const normalized = normalizeRelativePath(relPath)
        const pathKey = buildPathKey(normalized)
        const [rows] = await conn.execute(
            `SELECT rel_path, content, content_hash, updated_at
             FROM \`${tablePrefix}sync_notes\`
             WHERE user_id = ? AND path_key = ?`,
            [userId, pathKey]
        )
        if (!rows.length) return null
        const row = rows[0]
        return {
            type: 'note',
            key: normalizeRelativePath(row.rel_path),
            relPath: normalizeRelativePath(row.rel_path),
            content: row.content,
            contentHash: String(row.content_hash || ''),
            updatedAt: toIsoOrEmpty(row.updated_at)
        }
    }

    async _getRemoteNoteMetaItem(conn, tablePrefix, userId, relPath) {
        const normalized = normalizeRelativePath(relPath)
        const pathKey = buildPathKey(normalized)
        const [rows] = await conn.execute(
            `SELECT rel_path, note_type, note_name, note_extension, encrypted, has_fallback_recovery, meta_json, meta_hash, updated_at
             FROM \`${tablePrefix}sync_note_meta\`
             WHERE user_id = ? AND path_key = ?`,
            [userId, pathKey]
        )
        if (!rows.length) return null
        const row = rows[0]
        return {
            type: 'noteMeta',
            key: normalizeRelativePath(row.rel_path),
            relPath: normalizeRelativePath(row.rel_path),
            noteType: String(row.note_type || 'markdown'),
            noteName: String(row.note_name || ''),
            noteExtension: String(row.note_extension || ''),
            encrypted: Number(row.encrypted || 0) ? 1 : 0,
            hasFallbackRecovery: Number(row.has_fallback_recovery || 0) ? 1 : 0,
            metaJson: String(row.meta_json || '{}'),
            metaObject: JSON.parse(String(row.meta_json || '{}')),
            contentHash: String(row.meta_hash || sha256(String(row.meta_json || '{}'))),
            updatedAt: toIsoOrEmpty(row.updated_at)
        }
    }

    async _listLocalSessions(rootAbs) {
        const files = await this._getLocalFiles(rootAbs, 'session')
        const items = []
        for (const relPath of files) {
            const absPath = path.join(rootAbs, relPath)
            const sessionJson = String(await fs.readFile(absPath, 'utf8') || '')
            const stat = await fs.stat(absPath)
            items.push({
                type: 'session',
                key: relPath,
                relPath,
                sessionJson,
                contentHash: sha256(sessionJson),
                updatedAt: stat.mtime.toISOString()
            })
        }
        return sortByKey(items)
    }

    async _listRemoteSessions(conn, tablePrefix, userId) {
        const [rows] = await conn.execute(
            `SELECT session_id, session_json, session_hash, updated_at
             FROM \`${tablePrefix}sync_sessions\`
             WHERE user_id = ?
             ORDER BY session_id ASC`,
            [userId]
        )
        return rows.map((row) => ({
            type: 'session',
            key: normalizeRelativePath(row.session_id),
            relPath: normalizeRelativePath(row.session_id),
            sessionJson: String(row.session_json || ''),
            contentHash: String(row.session_hash || sha256(String(row.session_json || ''))),
            updatedAt: toIsoOrEmpty(row.updated_at)
        }))
    }

    async _getLocalSessionItem(rootAbs, relPath) {
        const normalized = normalizeRelativePath(relPath)
        if (!normalized) return null
        const absPath = path.join(rootAbs, normalized)
        try {
            const sessionJson = String(await fs.readFile(absPath, 'utf8') || '')
            const stat = await fs.stat(absPath)
            return {
                type: 'session',
                key: normalized,
                relPath: normalized,
                sessionJson,
                contentHash: sha256(sessionJson),
                updatedAt: stat.mtime.toISOString()
            }
        } catch (err) {
            if (err?.code === 'ENOENT') return null
            throw err
        }
    }

    async _getRemoteSessionItem(conn, tablePrefix, userId, relPath) {
        const normalized = normalizeRelativePath(relPath)
        const sessionKey = buildPathKey(normalized)
        const [rows] = await conn.execute(
            `SELECT session_id, session_json, session_hash, updated_at
             FROM \`${tablePrefix}sync_sessions\`
             WHERE user_id = ? AND session_key = ?`,
            [userId, sessionKey]
        )
        if (!rows.length) return null
        const row = rows[0]
        return {
            type: 'session',
            key: normalizeRelativePath(row.session_id),
            relPath: normalizeRelativePath(row.session_id),
            sessionJson: String(row.session_json || ''),
            contentHash: String(row.session_hash || sha256(String(row.session_json || ''))),
            updatedAt: toIsoOrEmpty(row.updated_at)
        }
    }

    _getLocalConfigRecord(syncScope) {
        const payload = this._getConfigPayload(syncScope)
        if (!payload) return null
        return {
            type: 'config',
            key: 'config',
            configObject: payload,
            configJson: JSON.stringify(payload),
            contentHash: this._getConfigHash(payload),
            updatedAt: toIsoOrEmpty(globalConfig.getConfigUpdatedAt()) || '1970-01-01T00:00:00.000Z'
        }
    }

    async _getRemoteConfigRecord(conn, tablePrefix, userId) {
        const [rows] = await conn.execute(
            `SELECT config_json, config_hash, updated_at
             FROM \`${tablePrefix}sync_config\`
             WHERE user_id = ?`,
            [userId]
        )
        if (!rows.length) return null
        const row = rows[0]
        const configJson = String(row.config_json || '{}')
        const configObject = JSON.parse(configJson)
        return {
            type: 'config',
            key: 'config',
            configJson,
            configObject,
            contentHash: this._getConfigHash(configObject),
            updatedAt: toIsoOrEmpty(row.updated_at)
        }
    }

    _compareItems(localItem, remoteItem) {
        if (!localItem && !remoteItem) return 'equal'
        if (!localItem) return 'remote_only'
        if (!remoteItem) return 'local_only'
        if (localItem.contentHash === remoteItem.contentHash) return 'equal'

        const localTs = toTimestamp(localItem.updatedAt)
        const remoteTs = toTimestamp(remoteItem.updatedAt)
        if (localTs > remoteTs) return 'local_newer'
        if (remoteTs > localTs) return 'remote_newer'
        return 'conflict'
    }

    async _writeRemoteNote(conn, tablePrefix, userId, item) {
        const pathKey = buildPathKey(item.relPath)
        await conn.execute(
            `INSERT INTO \`${tablePrefix}sync_notes\` (user_id, path_key, rel_path, content, content_hash, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE content = VALUES(content), content_hash = VALUES(content_hash), updated_at = VALUES(updated_at)`,
            [userId, pathKey, item.relPath, item.content, item.contentHash, item.updatedAt || nowIso()]
        )
    }

    async _writeRemoteUser(conn, tablePrefix, userRecord) {
        await conn.execute(
            `INSERT INTO \`${tablePrefix}sync_users\`
                (user_id, nickname, display_name, email, avatar, provider, role, user_secret, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                nickname = VALUES(nickname),
                display_name = VALUES(display_name),
                email = VALUES(email),
                avatar = VALUES(avatar),
                provider = VALUES(provider),
                role = VALUES(role),
                user_secret = VALUES(user_secret),
                updated_at = VALUES(updated_at)`,
            [
                userRecord.userId,
                userRecord.nickname,
                userRecord.displayName,
                userRecord.email,
                userRecord.avatar,
                userRecord.provider,
                userRecord.role,
                userRecord.userSecret,
                userRecord.createdAt,
                userRecord.updatedAt
            ]
        )
    }

    async _writeRemoteNoteMeta(conn, tablePrefix, userId, item) {
        const pathKey = buildPathKey(item.relPath)
        await conn.execute(
            `INSERT INTO \`${tablePrefix}sync_note_meta\`
                (user_id, path_key, rel_path, note_type, note_name, note_extension, encrypted, has_fallback_recovery, meta_json, meta_hash, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                note_type = VALUES(note_type),
                note_name = VALUES(note_name),
                note_extension = VALUES(note_extension),
                encrypted = VALUES(encrypted),
                has_fallback_recovery = VALUES(has_fallback_recovery),
                meta_json = VALUES(meta_json),
                meta_hash = VALUES(meta_hash),
                updated_at = VALUES(updated_at)`,
            [
                userId,
                pathKey,
                item.relPath,
                item.noteType || 'markdown',
                item.noteName || path.basename(item.relPath || ''),
                item.noteExtension || path.extname(item.relPath || ''),
                item.encrypted ? 1 : 0,
                item.hasFallbackRecovery ? 1 : 0,
                item.metaJson || '{}',
                item.contentHash || sha256(String(item.metaJson || '{}')),
                item.updatedAt || nowIso()
            ]
        )
    }

    async _writeRemoteSession(conn, tablePrefix, userId, item) {
        const sessionKey = buildPathKey(item.relPath)
        await conn.execute(
            `INSERT INTO \`${tablePrefix}sync_sessions\` (user_id, session_key, session_id, session_json, session_hash, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE session_json = VALUES(session_json), session_hash = VALUES(session_hash), updated_at = VALUES(updated_at)`,
            [userId, sessionKey, item.relPath, item.sessionJson, item.contentHash, item.updatedAt || nowIso()]
        )
    }

    async _writeRemoteConfig(conn, tablePrefix, userId, item) {
        await conn.execute(
            `INSERT INTO \`${tablePrefix}sync_config\` (user_id, config_json, config_hash, updated_at)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), config_hash = VALUES(config_hash), updated_at = VALUES(updated_at)`,
            [userId, item.configJson, item.contentHash, item.updatedAt || nowIso()]
        )
    }

    async _writeLocalNote(rootAbs, item) {
        const absPath = path.join(rootAbs, item.relPath)
        await fs.mkdir(path.dirname(absPath), { recursive: true })
        await fs.writeFile(absPath, item.content)
    }

    async _writeLocalSession(rootAbs, item) {
        const absPath = path.join(rootAbs, item.relPath)
        await fs.mkdir(path.dirname(absPath), { recursive: true })
        await fs.writeFile(absPath, item.sessionJson, 'utf8')
    }

    _importRemoteConfig(item) {
        const payload = item?.configObject && typeof item.configObject === 'object' ? { ...item.configObject } : {}
        const syncMeta = payload.__syncMeta && typeof payload.__syncMeta === 'object' ? payload.__syncMeta : null
        delete payload.__syncMeta

        if (syncMeta?.includeConfig === true) {
            globalConfig.importFromObject(payload)
            return
        }

        if (syncMeta?.includeNoteMeta === true) {
            globalConfig.updateNoteConfig({
                noteSecurity: payload?.noteConfig?.noteSecurity || {}
            })
            return
        }

        globalConfig.importFromObject(payload)
    }

    _importRemoteNoteMeta(items = []) {
        const nextProtectedNotes = {}
        ;(Array.isArray(items) ? items : []).forEach((item) => {
            const relPath = normalizeRelativePath(item?.relPath)
            if (!relPath) return
            const metaObject = item?.metaObject && typeof item.metaObject === 'object'
                ? { ...item.metaObject }
                : {}
            if (item?.hasFallbackRecovery === 1 || item?.hasFallbackRecovery === true) {
                metaObject.hasFallbackRecovery = true
            }
            nextProtectedNotes[relPath] = metaObject
        })
        globalConfig.updateNoteConfig({
            noteSecurity: {
                protectedNotes: nextProtectedNotes
            }
        })
    }

    _buildConflictItem(type, key, localItem, remoteItem) {
        return {
            type,
            key,
            localUpdatedAt: toIsoOrEmpty(localItem?.updatedAt),
            remoteUpdatedAt: toIsoOrEmpty(remoteItem?.updatedAt),
            localHash: String(localItem?.contentHash || ''),
            remoteHash: String(remoteItem?.contentHash || ''),
            resolution: 'manual_required'
        }
    }

    async _loadConflictPair(conn, tablePrefix, userId, rootAbs, syncScope, type, key) {
        if (type === 'note') {
            return {
                localItem: await this._getLocalNoteItem(rootAbs, key),
                remoteItem: await this._getRemoteNoteItem(conn, tablePrefix, userId, key)
            }
        }

        if (type === 'noteMeta') {
            const localMetaMap = this._getLocalNoteMetaMap(syncScope)
            return {
                localItem: localMetaMap.get(key) || null,
                remoteItem: await this._getRemoteNoteMetaItem(conn, tablePrefix, userId, key)
            }
        }

        if (type === 'session') {
            return {
                localItem: await this._getLocalSessionItem(rootAbs, key),
                remoteItem: await this._getRemoteSessionItem(conn, tablePrefix, userId, key)
            }
        }

        return {
            localItem: this._getLocalConfigRecord(syncScope),
            remoteItem: await this._getRemoteConfigRecord(conn, tablePrefix, userId)
        }
    }

    async _applyConflictResolution(conn, tablePrefix, userId, rootAbs, type, resolution, localItem, remoteItem) {
        if (resolution === 'local') {
            if (!localItem) throw new Error('Local conflict source does not exist')
            if (type === 'note') {
                await this._writeRemoteNote(conn, tablePrefix, userId, localItem)
            } else if (type === 'noteMeta') {
                await this._writeRemoteNoteMeta(conn, tablePrefix, userId, localItem)
            } else if (type === 'session') {
                await this._writeRemoteSession(conn, tablePrefix, userId, localItem)
            } else {
                await this._writeRemoteConfig(conn, tablePrefix, userId, localItem)
            }
            return { applied: 'local' }
        }

        if (!remoteItem) throw new Error('Remote conflict source does not exist')
        if (type === 'note') {
            await this._writeLocalNote(rootAbs, remoteItem)
        } else if (type === 'noteMeta') {
            this._importRemoteNoteMeta([remoteItem])
        } else if (type === 'session') {
            await this._writeLocalSession(rootAbs, remoteItem)
        } else {
            this._importRemoteConfig(remoteItem)
        }
        return { applied: 'remote' }
    }

    async testConnection(override = null) {
        const { tablePrefix, databaseName, mysqlConfig } = this._getConfig(override)
        const databaseProvision = await this._ensureDatabaseExists(override)
        const conn = await this._connect(override)
        try {
            const schemaProvision = await this._ensureSchema(conn, tablePrefix)
            await conn.query('SELECT 1')
            return {
                ok: true,
                provider: 'mysql',
                host: mysqlConfig.host,
                port: mysqlConfig.port,
                database: databaseName,
                username: mysqlConfig.user,
                userId: this._getUserId(),
                isolation: {
                    mode: 'user_id',
                    field: 'user_id',
                    value: this._getUserId()
                },
                provisioning: {
                    database: databaseProvision,
                    ...schemaProvision
                }
            }
        } finally {
            await conn.end()
        }
    }

    async backup(progressCallback) {
        const { syncConfig, tablePrefix } = this._getConfig()
        await this._ensureDatabaseExists()
        const conn = await this._connect()
        const userId = this._getUserId()
        const rootAbs = this._getDataRoot()
        let completed = 0

        try {
            await this._ensureSchema(conn, tablePrefix)
            await this._writeRemoteUser(conn, tablePrefix, this._getUserRecord())
            const notes = syncConfig.scope?.notes ? await this._listLocalNotes(rootAbs) : []
            const noteMeta = syncConfig.scope?.noteMeta ? [...this._getLocalNoteMetaMap(syncConfig.scope).values()] : []
            const sessions = syncConfig.scope?.sessions ? await this._listLocalSessions(rootAbs) : []
            const configRecord = (syncConfig.scope?.config || syncConfig.scope?.noteMeta) ? this._getLocalConfigRecord(syncConfig.scope) : null
            const total = notes.length + noteMeta.length + sessions.length + (configRecord ? 1 : 0)
            const tick = () => {
                completed += 1
                if (progressCallback) progressCallback(completed, total)
            }

            for (const item of notes) {
                await this._writeRemoteNote(conn, tablePrefix, userId, item)
                tick()
            }

            for (const item of noteMeta) {
                await this._writeRemoteNoteMeta(conn, tablePrefix, userId, item)
                tick()
            }

            if (configRecord) {
                await this._writeRemoteConfig(conn, tablePrefix, userId, configRecord)
                tick()
            }

            for (const item of sessions) {
                await this._writeRemoteSession(conn, tablePrefix, userId, item)
                tick()
            }

            return {
                uploaded: notes.length + noteMeta.length + sessions.length + (configRecord ? 1 : 0),
                notes: notes.length,
                noteMeta: noteMeta.length,
                sessions: sessions.length,
                config: configRecord ? 1 : 0
            }
        } finally {
            await conn.end()
        }
    }

    async restore(progressCallback) {
        const { syncConfig, tablePrefix } = this._getConfig()
        await this._ensureDatabaseExists()
        const conn = await this._connect()
        const userId = this._getUserId()
        const rootAbs = this._getDataRoot()
        let completed = 0

        try {
            await this._ensureSchema(conn, tablePrefix)
            const notes = syncConfig.scope?.notes ? await this._listRemoteNotes(conn, tablePrefix, userId) : []
            const noteMeta = syncConfig.scope?.noteMeta ? await this._listRemoteNoteMeta(conn, tablePrefix, userId) : []
            const sessions = syncConfig.scope?.sessions ? await this._listRemoteSessions(conn, tablePrefix, userId) : []
            const configRecord = (syncConfig.scope?.config || syncConfig.scope?.noteMeta)
                ? await this._getRemoteConfigRecord(conn, tablePrefix, userId)
                : null
            const total = notes.length + noteMeta.length + sessions.length + (configRecord ? 1 : 0)
            const tick = () => {
                completed += 1
                if (progressCallback) progressCallback(completed, total)
            }

            for (const item of notes) {
                await this._writeLocalNote(rootAbs, item)
                tick()
            }

            if (noteMeta.length) {
                this._importRemoteNoteMeta(noteMeta)
                completed += noteMeta.length
                if (progressCallback) progressCallback(completed, total)
            }

            for (const item of sessions) {
                await this._writeLocalSession(rootAbs, item)
                tick()
            }

            if (configRecord) {
                this._importRemoteConfig(configRecord)
                tick()
            }

            return {
                downloaded: notes.length + noteMeta.length + sessions.length + (configRecord ? 1 : 0),
                notes: notes.length,
                noteMeta: noteMeta.length,
                sessions: sessions.length,
                config: configRecord ? 1 : 0
            }
        } finally {
            await conn.end()
        }
    }

    async sync(progressCallback) {
        const { syncConfig, tablePrefix } = this._getConfig()
        await this._ensureDatabaseExists()
        const conn = await this._connect()
        const userId = this._getUserId()
        const rootAbs = this._getDataRoot()

        try {
            await this._ensureSchema(conn, tablePrefix)
            await this._writeRemoteUser(conn, tablePrefix, this._getUserRecord())

            const localNotes = syncConfig.scope?.notes ? await this._listLocalNotes(rootAbs) : []
            const remoteNotes = syncConfig.scope?.notes ? await this._listRemoteNotes(conn, tablePrefix, userId) : []
            const localNoteMeta = syncConfig.scope?.noteMeta ? [...this._getLocalNoteMetaMap(syncConfig.scope).values()] : []
            const remoteNoteMeta = syncConfig.scope?.noteMeta ? await this._listRemoteNoteMeta(conn, tablePrefix, userId) : []
            const localSessions = syncConfig.scope?.sessions ? await this._listLocalSessions(rootAbs) : []
            const remoteSessions = syncConfig.scope?.sessions ? await this._listRemoteSessions(conn, tablePrefix, userId) : []
            const localConfig = (syncConfig.scope?.config || syncConfig.scope?.noteMeta) ? this._getLocalConfigRecord(syncConfig.scope) : null
            const remoteConfig = (syncConfig.scope?.config || syncConfig.scope?.noteMeta)
                ? await this._getRemoteConfigRecord(conn, tablePrefix, userId)
                : null

            const noteKeys = new Set([...localNotes.map((item) => item.key), ...remoteNotes.map((item) => item.key)])
            const noteMetaKeys = new Set([...localNoteMeta.map((item) => item.key), ...remoteNoteMeta.map((item) => item.key)])
            const sessionKeys = new Set([...localSessions.map((item) => item.key), ...remoteSessions.map((item) => item.key)])
            const total = noteKeys.size + noteMetaKeys.size + sessionKeys.size + (localConfig || remoteConfig ? 1 : 0)
            let completed = 0
            const tick = () => {
                completed += 1
                if (progressCallback) progressCallback(completed, total)
            }

            const localNoteMap = new Map(localNotes.map((item) => [item.key, item]))
            const remoteNoteMap = new Map(remoteNotes.map((item) => [item.key, item]))
            const localNoteMetaMap = new Map(localNoteMeta.map((item) => [item.key, item]))
            const remoteNoteMetaMap = new Map(remoteNoteMeta.map((item) => [item.key, item]))
            const localSessionMap = new Map(localSessions.map((item) => [item.key, item]))
            const remoteSessionMap = new Map(remoteSessions.map((item) => [item.key, item]))

            const result = {
                notes: 0,
                noteMeta: 0,
                sessions: 0,
                config: 0,
                pushed: { notes: 0, noteMeta: 0, sessions: 0, config: 0 },
                pulled: { notes: 0, noteMeta: 0, sessions: 0, config: 0 },
                conflicts: []
            }

            for (const key of [...noteKeys].sort()) {
                const localItem = localNoteMap.get(key) || null
                const remoteItem = remoteNoteMap.get(key) || null
                const relation = this._compareItems(localItem, remoteItem)

                if (syncConfig.conflictPolicy === 'manual' && relation === 'conflict') {
                    result.conflicts.push(this._buildConflictItem('note', key, localItem, remoteItem))
                    tick()
                    continue
                }

                if (relation === 'local_only' || relation === 'local_newer' || (relation === 'conflict' && syncConfig.conflictPolicy === 'last_write_wins')) {
                    if (localItem) {
                        await this._writeRemoteNote(conn, tablePrefix, userId, localItem)
                        result.pushed.notes += 1
                        result.notes += 1
                    }
                } else if (relation === 'remote_only' || relation === 'remote_newer') {
                    if (remoteItem) {
                        await this._writeLocalNote(rootAbs, remoteItem)
                        result.pulled.notes += 1
                        result.notes += 1
                    }
                }

                tick()
            }

            for (const key of [...noteMetaKeys].sort()) {
                const localItem = localNoteMetaMap.get(key) || null
                const remoteItem = remoteNoteMetaMap.get(key) || null
                const relation = this._compareItems(localItem, remoteItem)

                if (syncConfig.conflictPolicy === 'manual' && relation === 'conflict') {
                    result.conflicts.push(this._buildConflictItem('noteMeta', key, localItem, remoteItem))
                    tick()
                    continue
                }

                if (relation === 'local_only' || relation === 'local_newer' || (relation === 'conflict' && syncConfig.conflictPolicy === 'last_write_wins')) {
                    if (localItem) {
                        await this._writeRemoteNoteMeta(conn, tablePrefix, userId, localItem)
                        result.pushed.noteMeta += 1
                        result.noteMeta += 1
                    }
                } else if (relation === 'remote_only' || relation === 'remote_newer') {
                    if (remoteItem) {
                        this._importRemoteNoteMeta([remoteItem])
                        result.pulled.noteMeta += 1
                        result.noteMeta += 1
                    }
                }

                tick()
            }

            for (const key of [...sessionKeys].sort()) {
                const localItem = localSessionMap.get(key) || null
                const remoteItem = remoteSessionMap.get(key) || null
                const relation = this._compareItems(localItem, remoteItem)

                if (syncConfig.conflictPolicy === 'manual' && relation === 'conflict') {
                    result.conflicts.push(this._buildConflictItem('session', key, localItem, remoteItem))
                    tick()
                    continue
                }

                if (relation === 'local_only' || relation === 'local_newer' || (relation === 'conflict' && syncConfig.conflictPolicy === 'last_write_wins')) {
                    if (localItem) {
                        await this._writeRemoteSession(conn, tablePrefix, userId, localItem)
                        result.pushed.sessions += 1
                        result.sessions += 1
                    }
                } else if (relation === 'remote_only' || relation === 'remote_newer') {
                    if (remoteItem) {
                        await this._writeLocalSession(rootAbs, remoteItem)
                        result.pulled.sessions += 1
                        result.sessions += 1
                    }
                }

                tick()
            }

            if (localConfig || remoteConfig) {
                const relation = this._compareItems(localConfig, remoteConfig)

                if (syncConfig.conflictPolicy === 'manual' && relation === 'conflict') {
                    result.conflicts.push(this._buildConflictItem('config', 'config', localConfig, remoteConfig))
                } else if (relation === 'local_only' || relation === 'local_newer' || (relation === 'conflict' && syncConfig.conflictPolicy === 'last_write_wins')) {
                    if (localConfig) {
                        await this._writeRemoteConfig(conn, tablePrefix, userId, localConfig)
                        result.pushed.config += 1
                        result.config += 1
                    }
                } else if (relation === 'remote_only' || relation === 'remote_newer') {
                    if (remoteConfig) {
                        this._importRemoteConfig(remoteConfig)
                        result.pulled.config += 1
                        result.config += 1
                    }
                }

                tick()
            }

            if (result.conflicts.length) {
                return {
                    ok: false,
                    ...result
                }
            }

            return {
                ok: true,
                ...result
            }
        } finally {
            await conn.end()
        }
    }

    async resolveConflict(options = {}) {
        const { syncConfig, tablePrefix } = this._getConfig()
        const type = String(options.type || '').trim()
        const key = String(options.key || '').trim()
        const resolution = String(options.resolution || '').trim().toLowerCase()
        if (!['note', 'noteMeta', 'session', 'config'].includes(type)) {
            throw new Error('Unsupported conflict type')
        }
        if (type !== 'config' && !key) {
            throw new Error('Conflict key is required')
        }
        if (!['local', 'remote'].includes(resolution)) {
            throw new Error('Conflict resolution must be local or remote')
        }

        const conn = await this._connect()
        const userId = this._getUserId()
        const rootAbs = this._getDataRoot()
        try {
            await this._ensureSchema(conn, tablePrefix)
            const pair = await this._loadConflictPair(conn, tablePrefix, userId, rootAbs, syncConfig.scope || {}, type, type === 'config' ? 'config' : key)
            const relation = this._compareItems(pair.localItem, pair.remoteItem)
            if (relation === 'equal') {
                return {
                    ok: true,
                    type,
                    key: type === 'config' ? 'config' : key,
                    resolution,
                    alreadyResolved: true
                }
            }

            await this._applyConflictResolution(conn, tablePrefix, userId, rootAbs, type, resolution, pair.localItem, pair.remoteItem)
            const refreshed = await this._loadConflictPair(conn, tablePrefix, userId, rootAbs, syncConfig.scope || {}, type, type === 'config' ? 'config' : key)
            return {
                ok: true,
                type,
                key: type === 'config' ? 'config' : key,
                resolution,
                alreadyResolved: false,
                relation: this._compareItems(refreshed.localItem, refreshed.remoteItem)
            }
        } finally {
            await conn.end()
        }
    }
}

module.exports = new MysqlSyncService()
