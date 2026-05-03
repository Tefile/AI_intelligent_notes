// 云同步桥接：处理同步目录、文件上传和下载的本地实现。
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

function toBase64(buffer) {
    return Buffer.from(buffer || []).toString('base64')
}

function fromBase64(text) {
    return Buffer.from(String(text || ''), 'base64')
}

const FALLBACK_EMPTY_DATABASE_BASE64 = Buffer.from('AITOOLS_EMPTY_SQLITE_V1', 'utf8').toString('base64')

async function exportDatabaseBase64() {
    if (typeof dbBridge.exportDatabase === 'function') {
        return String(await dbBridge.exportDatabase() || '')
    }
    if (typeof dbBridge.export === 'function') {
        const payload = await dbBridge.export()
        if (typeof payload === 'string') return payload
        if (Buffer.isBuffer(payload)) return payload.toString('base64')
        if (payload?.type === 'Buffer' && Array.isArray(payload.data)) {
            return Buffer.from(payload.data).toString('base64')
        }
    }
    return FALLBACK_EMPTY_DATABASE_BASE64
}

async function importDatabaseBuffer(buffer) {
    if (typeof dbBridge.importDatabase === 'function') {
        return await dbBridge.importDatabase(buffer)
    }
    if (typeof dbBridge.import === 'function') {
        return await dbBridge.import(buffer)
    }
    return true
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

    _getSnapshotContentHash(scope, notes, sessions, configRecord, databaseHash = '') {
        const payload = stableSerialize({
            userId: this._getUserId(),
            scope: scope || {},
            databaseHash: String(databaseHash || ''),
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
        const rootAbs = mysqlSync._getDataRoot()
        const notes = scope.notes ? await mysqlSync._listLocalNotes(rootAbs) : []
        const sessions = scope.sessions ? await mysqlSync._listLocalSessions(rootAbs) : []
        const configRecord = (scope.config || scope.noteMeta) ? this._getConfigRecord(scope) : null
        const dbBase64 = await exportDatabaseBase64()
        const databaseHash = sha256(String(dbBase64 || ''))
        const generatedAt = nowIso()
        const contentUpdatedAt = [
            ...notes.map((item) => item.updatedAt || ''),
            ...sessions.map((item) => item.updatedAt || '')
        ]
            .map((value) => toIsoOrEmpty(value))
            .filter(Boolean)
            .sort((a, b) => toTimestamp(b) - toTimestamp(a))[0] || generatedAt

        const latestUpdatedAt = configRecord?.updatedAt
            ? [contentUpdatedAt, toIsoOrEmpty(configRecord.updatedAt)].filter(Boolean).sort((a, b) => toTimestamp(b) - toTimestamp(a))[0] || contentUpdatedAt
            : contentUpdatedAt

        return {
            buffer: Buffer.from(JSON.stringify({
                format: 'cloud_workspace_bundle_v1',
                userId: this._getUserId(),
                generatedAt,
                updatedAt: latestUpdatedAt,
                scope,
                database: dbBase64,
                databaseHash,
                files: {
                    notes: notes.map((item) => ({
                        relPath: item.relPath,
                        content: toBase64(item.content),
                        contentHash: item.contentHash,
                        updatedAt: item.updatedAt || ''
                    })),
                    sessions: sessions.map((item) => ({
                        relPath: item.relPath,
                        content: toBase64(item.content),
                        contentHash: item.contentHash,
                        updatedAt: item.updatedAt || ''
                    }))
                },
                configRecord: configRecord ? {
                    configJson: configRecord.configJson,
                    contentHash: configRecord.contentHash,
                    updatedAt: configRecord.updatedAt || ''
                } : null
            }), 'utf8'),
            updatedAt: latestUpdatedAt,
            hash: this._getSnapshotContentHash(scope, notes, sessions, configRecord, databaseHash),
            notes: notes.length,
            sessions: sessions.length,
            config: configRecord ? 1 : 0
        }
    }

    async _writeTempSnapshot(buffer) {
        const tempPath = path.join(os.tmpdir(), `ai-tools-sync-${process.pid}-${Date.now()}.bundle.json`)
        await fs.writeFile(tempPath, buffer)
        return tempPath
    }

    async _downloadRemoteSnapshot(s3, cloudConfig, snapshotKey) {
        const tempPath = path.join(os.tmpdir(), `ai-tools-sync-download-${process.pid}-${Date.now()}.bundle.json`)
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
        const parsed = JSON.parse(Buffer.from(buffer).toString('utf8'))
        if (parsed?.format !== 'cloud_workspace_bundle_v1') {
            throw new Error('Unsupported cloud bundle format')
        }
        const rootAbs = mysqlSync._getDataRoot()
        const scope = parsed.scope || {}
        const noteFiles = Array.isArray(parsed?.files?.notes) ? parsed.files.notes : []
        const sessionFiles = Array.isArray(parsed?.files?.sessions) ? parsed.files.sessions : []
        const shouldSyncNotes = scope.notes !== false
        const shouldSyncSessions = scope.sessions !== false

        if (parsed.database) {
            await importDatabaseBuffer(fromBase64(parsed.database))
        }

        if (shouldSyncNotes) {
            const localNoteFiles = await mysqlSync._getLocalFiles(rootAbs, 'note')
            const remoteNoteSet = new Set(noteFiles.map((item) => item.relPath))
            for (const relPath of localNoteFiles) {
                if (!remoteNoteSet.has(relPath)) {
                    await fs.rm(path.join(rootAbs, relPath), { force: true })
                }
            }
            for (const item of noteFiles) {
                await mysqlSync._writeLocalNote(rootAbs, {
                    relPath: item.relPath,
                    content: fromBase64(item.content || ''),
                    contentHash: String(item.contentHash || ''),
                    updatedAt: toIsoOrEmpty(item.updatedAt)
                })
            }
        }

        if (shouldSyncSessions) {
            const localSessionFiles = await mysqlSync._getLocalFiles(rootAbs, 'session')
            const remoteSessionSet = new Set(sessionFiles.map((item) => item.relPath))
            for (const relPath of localSessionFiles) {
                if (!remoteSessionSet.has(relPath)) {
                    await fs.rm(path.join(rootAbs, relPath), { force: true })
                }
            }
            for (const item of sessionFiles) {
                await mysqlSync._writeLocalSession(rootAbs, {
                    relPath: item.relPath,
                    sessionJson: fromBase64(item.content || '').toString('utf8'),
                    contentHash: String(item.contentHash || ''),
                    updatedAt: toIsoOrEmpty(item.updatedAt)
                })
            }
        }

        if (parsed.configRecord) {
            mysqlSync._importRemoteConfig({
                configJson: String(parsed.configRecord.configJson || '{}'),
                configObject: JSON.parse(String(parsed.configRecord.configJson || '{}')),
                contentHash: String(parsed.configRecord.contentHash || ''),
                updatedAt: toIsoOrEmpty(parsed.configRecord.updatedAt)
            })
        }

        return {
            notes: noteFiles.length,
            sessions: sessionFiles.length,
            config: parsed.configRecord ? 1 : 0,
            database: 1
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
                contentType: 'application/json'
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
                    contentType: 'application/json'
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
                    provider: 'cloud_workspace_bundle_v1',
                    user_id: this._getUserId()
                },
                contentType: 'application/json'
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
