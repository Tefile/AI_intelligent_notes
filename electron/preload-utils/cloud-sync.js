const fs = require('fs').promises
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const initSqlJs = require('sql.js')
const globalConfig = require('./global-config')
const dbBridge = require('./db-bridge')
const S3ClientWrapper = require('./s3-operations')
const mysqlSync = require('./mysql-sync')

let undiciApi = null
try {
    undiciApi = require('undici')
} catch {
    undiciApi = null
}

let SQL = null

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex')
}

function stableSerialize(value) {
    if (Array.isArray(value)) {
        return value.map((item) => stableSerialize(item))
    }
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((acc, key) => {
                acc[key] = stableSerialize(value[key])
                return acc
            }, {})
    }
    return value
}

function nowIso() {
    return new Date().toISOString()
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

async function ensureSqlJs() {
    if (!SQL) {
        SQL = await initSqlJs()
    }
    return SQL
}

function normalizeObjectPrefix(value) {
    const text = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    return text || 'ai-tools-sync'
}

function normalizeSyncOverride(raw) {
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

class CloudSyncService {
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
        const legacyCloud = globalConfig.getCloudConfig?.() || {}
        const cloud = syncConfig?.cloud && typeof syncConfig.cloud === 'object' ? syncConfig.cloud : {}
        const required = ['region', 'accessKeyId', 'secretAccessKey', 'bucket']
        const mergedCloud = {
            region: String(cloud.region || legacyCloud.region || '').trim(),
            accessKeyId: String(cloud.accessKeyId || legacyCloud.accessKeyId || '').trim(),
            secretAccessKey: String(cloud.secretAccessKey || legacyCloud.secretAccessKey || ''),
            bucket: String(cloud.bucket || legacyCloud.bucket || '').trim(),
            endpoint: String(cloud.endpoint || legacyCloud.endpoint || '').trim(),
            forcePathStyle: cloud.forcePathStyle === true || legacyCloud.forcePathStyle === true,
            objectPrefix: normalizeObjectPrefix(cloud.objectPrefix || legacyCloud.objectPrefix || ''),
            allowSelfSignedCertificates: cloud.allowSelfSignedCertificates === true
        }
        const missing = required.filter((key) => !mergedCloud[key])
        if (syncConfig?.provider !== 'cloud' || syncConfig?.enabled !== true) {
            throw new Error('Cloud sync is not enabled')
        }
        if (missing.length) {
            throw new Error(`Cloud sync config is incomplete: ${missing.join(', ')}`)
        }
        return {
            syncConfig,
            cloudConfig: mergedCloud
        }
    }

    _getS3Client(cloudConfig) {
        return new S3ClientWrapper(cloudConfig)
    }

    async _withTlsConfig(cloudConfig, runner) {
        if (cloudConfig?.allowSelfSignedCertificates !== true || !undiciApi?.Agent || !undiciApi?.getGlobalDispatcher || !undiciApi?.setGlobalDispatcher) {
            return runner()
        }
        const previousDispatcher = undiciApi.getGlobalDispatcher()
        const insecureDispatcher = new undiciApi.Agent({
            connect: {
                rejectUnauthorized: false
            }
        })
        undiciApi.setGlobalDispatcher(insecureDispatcher)
        try {
            return await runner()
        } finally {
            undiciApi.setGlobalDispatcher(previousDispatcher)
            await insecureDispatcher.close()
        }
    }

    _getUserId() {
        return String(dbBridge.getCurrentUserId() || 'local-default').trim() || 'local-default'
    }

    _getSnapshotKey(cloudConfig, userId) {
        return `${normalizeObjectPrefix(cloudConfig.objectPrefix)}/${userId}.sqlite`
    }

    _getConfigRecord(scope) {
        return mysqlSync._getLocalConfigRecord(scope)
    }

    _getSnapshotContentHash(scope, notes, sessions, configRecord) {
        const payload = stableSerialize({
            userId: this._getUserId(),
            scope: scope || {},
            notes: (Array.isArray(notes) ? notes : []).map((item) => ({
                relPath: item.relPath,
                contentHash: item.contentHash
            })),
            sessions: (Array.isArray(sessions) ? sessions : []).map((item) => ({
                relPath: item.relPath,
                contentHash: item.contentHash
            })),
            config: configRecord
                ? {
                    contentHash: configRecord.contentHash
                }
                : null
        })
        return sha256(JSON.stringify(payload))
    }

    async _buildSnapshot(scope = {}) {
        const SqlJs = await ensureSqlJs()
        const snapshotDb = new SqlJs.Database()
        const rootAbs = mysqlSync._getDataRoot()
        const notes = scope.notes ? await mysqlSync._listLocalNotes(rootAbs) : []
        const sessions = scope.sessions ? await mysqlSync._listLocalSessions(rootAbs) : []
        const configRecord = (scope.config || scope.noteMeta) ? this._getConfigRecord(scope) : null

        snapshotDb.run(`
            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `)
        snapshotDb.run(`
            CREATE TABLE files (
                rel_path TEXT PRIMARY KEY,
                bucket TEXT NOT NULL,
                content BLOB NOT NULL,
                content_hash TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `)
        snapshotDb.run(`
            CREATE TABLE config_records (
                record_key TEXT PRIMARY KEY,
                config_json TEXT NOT NULL,
                config_hash TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `)

        const allUpdatedAt = []
        const insertFile = snapshotDb.prepare(`
            INSERT INTO files (rel_path, bucket, content, content_hash, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `)

        for (const item of notes) {
            insertFile.run([item.relPath, 'note', item.content, item.contentHash, item.updatedAt || nowIso()])
            allUpdatedAt.push(item.updatedAt || '')
        }
        for (const item of sessions) {
            insertFile.run([item.relPath, 'session', item.sessionJson, item.contentHash, item.updatedAt || nowIso()])
            allUpdatedAt.push(item.updatedAt || '')
        }
        insertFile.free()

        if (configRecord) {
            snapshotDb.run(
                `INSERT INTO config_records (record_key, config_json, config_hash, updated_at)
                 VALUES (?, ?, ?, ?)`,
                ['config', configRecord.configJson, configRecord.contentHash, configRecord.updatedAt || nowIso()]
            )
            allUpdatedAt.push(configRecord.updatedAt || '')
        }

        const generatedAt = nowIso()
        const latestUpdatedAt = allUpdatedAt
            .map((value) => toIsoOrEmpty(value))
            .filter(Boolean)
            .sort((a, b) => toTimestamp(b) - toTimestamp(a))[0] || generatedAt

        const metadataRows = [
            ['format', 'cloud_sqlite_snapshot_v1'],
            ['user_id', this._getUserId()],
            ['generated_at', generatedAt],
            ['updated_at', latestUpdatedAt],
            ['scope_json', JSON.stringify(scope || {})],
            ['note_count', String(notes.length)],
            ['session_count', String(sessions.length)],
            ['config_count', configRecord ? '1' : '0']
        ]
        const insertMeta = snapshotDb.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)')
        for (const row of metadataRows) {
            insertMeta.run(row)
        }
        insertMeta.free()

        const buffer = Buffer.from(snapshotDb.export())
        snapshotDb.close()
        return {
            buffer,
            updatedAt: latestUpdatedAt,
            hash: this._getSnapshotContentHash(scope, notes, sessions, configRecord),
            notes: notes.length,
            sessions: sessions.length,
            config: configRecord ? 1 : 0
        }
    }

    async _writeTempSnapshot(buffer) {
        const tempPath = path.join(os.tmpdir(), `ai-tools-sync-${process.pid}-${Date.now()}.sqlite`)
        await fs.writeFile(tempPath, buffer)
        return tempPath
    }

    async _downloadRemoteSnapshot(s3, cloudConfig, snapshotKey) {
        const tempPath = path.join(os.tmpdir(), `ai-tools-sync-download-${process.pid}-${Date.now()}.sqlite`)
        await s3.downloadFile(cloudConfig.bucket, snapshotKey, tempPath)
        const buffer = await fs.readFile(tempPath)
        await fs.rm(tempPath, { force: true })
        return buffer
    }

    _readMetadataValue(snapshotDb, key) {
        const stmt = snapshotDb.prepare('SELECT value FROM metadata WHERE key = ? LIMIT 1')
        stmt.bind([key])
        const value = stmt.step() ? String(stmt.getAsObject().value || '') : ''
        stmt.free()
        return value
    }

    _readScope(snapshotDb) {
        try {
            return JSON.parse(this._readMetadataValue(snapshotDb, 'scope_json') || '{}')
        } catch {
            return {}
        }
    }

    async _applySnapshot(buffer) {
        const SqlJs = await ensureSqlJs()
        const snapshotDb = new SqlJs.Database(buffer)
        const rootAbs = mysqlSync._getDataRoot()
        const scope = this._readScope(snapshotDb)

        const remoteFiles = []
        const stmt = snapshotDb.prepare(`
            SELECT rel_path, bucket, content, content_hash, updated_at
            FROM files
            ORDER BY rel_path ASC
        `)
        while (stmt.step()) {
            const row = stmt.getAsObject()
            remoteFiles.push({
                relPath: String(row.rel_path || ''),
                bucket: String(row.bucket || ''),
                content: Buffer.from(row.content || []),
                contentHash: String(row.content_hash || ''),
                updatedAt: toIsoOrEmpty(row.updated_at)
            })
        }
        stmt.free()

        const noteFiles = remoteFiles.filter((item) => item.bucket === 'note')
        const sessionFiles = remoteFiles.filter((item) => item.bucket === 'session')

        if (scope.notes) {
            const localNoteFiles = await mysqlSync._getLocalFiles(rootAbs, 'note')
            const remoteNoteSet = new Set(noteFiles.map((item) => item.relPath))
            for (const relPath of localNoteFiles) {
                if (!remoteNoteSet.has(relPath)) {
                    await fs.rm(path.join(rootAbs, relPath), { force: true })
                }
            }
            for (const item of noteFiles) {
                await mysqlSync._writeLocalNote(rootAbs, item)
            }
        }

        if (scope.sessions) {
            const localSessionFiles = await mysqlSync._getLocalFiles(rootAbs, 'session')
            const remoteSessionSet = new Set(sessionFiles.map((item) => item.relPath))
            for (const relPath of localSessionFiles) {
                if (!remoteSessionSet.has(relPath)) {
                    await fs.rm(path.join(rootAbs, relPath), { force: true })
                }
            }
            for (const item of sessionFiles) {
                await mysqlSync._writeLocalSession(rootAbs, {
                    ...item,
                    sessionJson: item.content.toString('utf8')
                })
            }
        }

        const configStmt = snapshotDb.prepare(`
            SELECT config_json, config_hash, updated_at
            FROM config_records
            WHERE record_key = 'config'
            LIMIT 1
        `)
        if (configStmt.step()) {
            const row = configStmt.getAsObject()
            mysqlSync._importRemoteConfig({
                configJson: String(row.config_json || '{}'),
                configObject: JSON.parse(String(row.config_json || '{}')),
                contentHash: String(row.config_hash || ''),
                updatedAt: toIsoOrEmpty(row.updated_at)
            })
        }
        configStmt.free()
        snapshotDb.close()

        return {
            notes: noteFiles.length,
            sessions: sessionFiles.length,
            config: scope.config || scope.noteMeta ? 1 : 0
        }
    }

    async testConnection(override = null) {
        const { cloudConfig } = this._getConfig(override)
        const s3 = this._getS3Client(cloudConfig)
        await this._withTlsConfig(cloudConfig, () => s3.listObjects(cloudConfig.bucket, normalizeObjectPrefix(cloudConfig.objectPrefix)))
        return { ok: true }
    }

    async backup(progressCallback) {
        const { syncConfig, cloudConfig } = this._getConfig()
        const snapshot = await this._buildSnapshot(syncConfig.scope || {})
        const snapshotKey = this._getSnapshotKey(cloudConfig, this._getUserId())
        const tempPath = await this._writeTempSnapshot(snapshot.buffer)
        const s3 = this._getS3Client(cloudConfig)
        try {
            if (progressCallback) progressCallback(0, 1)
            await this._withTlsConfig(cloudConfig, () => s3.uploadFile(cloudConfig.bucket, tempPath, snapshotKey, {
                metadata: {
                    updated_at: snapshot.updatedAt,
                    content_hash: snapshot.hash,
                    provider: 'cloud_sqlite_snapshot_v1',
                    user_id: this._getUserId()
                },
                contentType: 'application/x-sqlite3'
            }))
            if (progressCallback) progressCallback(1, 1)
        } finally {
            await fs.rm(tempPath, { force: true })
        }

        return {
            provider: 'cloud',
            uploaded: 1,
            notes: snapshot.notes,
            sessions: snapshot.sessions,
            config: snapshot.config,
            snapshotKey
        }
    }

    async restore(progressCallback) {
        const { cloudConfig } = this._getConfig()
        const snapshotKey = this._getSnapshotKey(cloudConfig, this._getUserId())
        const s3 = this._getS3Client(cloudConfig)
        if (progressCallback) progressCallback(0, 1)
        const buffer = await this._withTlsConfig(cloudConfig, () => this._downloadRemoteSnapshot(s3, cloudConfig, snapshotKey))
        const result = await this._applySnapshot(buffer)
        if (progressCallback) progressCallback(1, 1)
        return {
            provider: 'cloud',
            downloaded: 1,
            ...result,
            snapshotKey
        }
    }

    async sync(progressCallback) {
        const { syncConfig, cloudConfig } = this._getConfig()
        const snapshotKey = this._getSnapshotKey(cloudConfig, this._getUserId())
        const s3 = this._getS3Client(cloudConfig)
        const localSnapshot = await this._buildSnapshot(syncConfig.scope || {})
        const remoteMeta = await this._withTlsConfig(cloudConfig, () => s3.headObject(cloudConfig.bucket, snapshotKey))
        if (progressCallback) progressCallback(0, 1)

        if (!remoteMeta) {
            const tempPath = await this._writeTempSnapshot(localSnapshot.buffer)
            try {
                await this._withTlsConfig(cloudConfig, () => s3.uploadFile(cloudConfig.bucket, tempPath, snapshotKey, {
                    metadata: {
                        updated_at: localSnapshot.updatedAt,
                        content_hash: localSnapshot.hash,
                        provider: 'cloud_sqlite_snapshot_v1',
                        user_id: this._getUserId()
                    },
                    contentType: 'application/x-sqlite3'
                }))
            } finally {
                await fs.rm(tempPath, { force: true })
            }
            if (progressCallback) progressCallback(1, 1)
            return {
                ok: true,
                provider: 'cloud',
                direction: 'upload',
                uploaded: 1,
                downloaded: 0,
                notes: localSnapshot.notes,
                sessions: localSnapshot.sessions,
                config: localSnapshot.config,
                snapshotKey
            }
        }

        const remoteUpdatedAt = toIsoOrEmpty(remoteMeta?.metadata?.updated_at)
        const remoteHash = String(remoteMeta?.metadata?.content_hash || '').trim()
        const localTs = toTimestamp(localSnapshot.updatedAt)
        const remoteTs = toTimestamp(remoteUpdatedAt)

        if (remoteTs > localTs || (remoteTs === localTs && remoteHash && remoteHash !== localSnapshot.hash)) {
            const buffer = await this._withTlsConfig(cloudConfig, () => this._downloadRemoteSnapshot(s3, cloudConfig, snapshotKey))
            const result = await this._applySnapshot(buffer)
            if (progressCallback) progressCallback(1, 1)
            return {
                ok: true,
                provider: 'cloud',
                direction: 'download',
                uploaded: 0,
                downloaded: 1,
                ...result,
                snapshotKey
            }
        }

        if (remoteHash === localSnapshot.hash && remoteTs === localTs) {
            if (progressCallback) progressCallback(1, 1)
            return {
                ok: true,
                provider: 'cloud',
                direction: 'none',
                uploaded: 0,
                downloaded: 0,
                notes: 0,
                sessions: 0,
                config: 0,
                snapshotKey
            }
        }

        const tempPath = await this._writeTempSnapshot(localSnapshot.buffer)
        try {
            await this._withTlsConfig(cloudConfig, () => s3.uploadFile(cloudConfig.bucket, tempPath, snapshotKey, {
                metadata: {
                    updated_at: localSnapshot.updatedAt,
                    content_hash: localSnapshot.hash,
                    provider: 'cloud_sqlite_snapshot_v1',
                    user_id: this._getUserId()
                },
                contentType: 'application/x-sqlite3'
            }))
        } finally {
            await fs.rm(tempPath, { force: true })
        }
        if (progressCallback) progressCallback(1, 1)

        return {
            ok: true,
            provider: 'cloud',
            direction: 'upload',
            uploaded: 1,
            downloaded: 0,
            notes: localSnapshot.notes,
            sessions: localSnapshot.sessions,
            config: localSnapshot.config,
            snapshotKey
        }
    }
}

module.exports = new CloudSyncService()
