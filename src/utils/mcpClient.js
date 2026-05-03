/**
 * 前端 MCP 客户端桥接，实际调用 `window.createMCPClient`（由 preload 注入）。
 *
 * 默认行为：每次创建一个新的 MCP client，由调用方负责 close。
 * keepAlive：当 `serverConfig.keepAlive === true` 且存在 `_id` 时，会复用同一个 client，
 * 用于需要“保持会话/长连接”的 MCP 服务器（例如 playwright-mcp-server）。
 */

import {
  normalizeMcpServerConfigForBridge as bridgeNormalizeMcpServerConfigForBridge,
  getMcpServerFingerprint
} from './mcpBridge.js'

const pooledClientsByServerId = new Map()

export function createMCPClient(serverConfig) {
  const createBridgeClient = window?.createMCPClient
  if (typeof createBridgeClient !== 'function') {
    throw new Error('MCP client bridge is not available')
  }

  const normalizedConfig = bridgeNormalizeMcpServerConfigForBridge(serverConfig)
  const result = createBridgeClient(normalizedConfig)

  // preload 既可能直接返回完整 client，也可能只返回一个句柄字符串，这里两种都兼容。
  if (result && typeof result === 'object' && typeof result.listTools === 'function') {
    return result
  }

  const handle = String(result || '').trim()
  if (!handle) {
    throw new Error('Failed to create MCP client handle')
  }

  const invoke = window?.mcpClientInvoke
  const closeHandle = window?.closeMCPClient
  if (typeof invoke !== 'function' || typeof closeHandle !== 'function') {
    throw new Error('MCP client bridge methods are not available')
  }

  let closed = false
  const call = (action, payload) => invoke(handle, action, payload)

  return {
    async sendRequest(method, params) {
      return call('sendRequest', { method, params })
    },
    async sendNotification(method, params) {
      return call('sendNotification', { method, params })
    },
    async listTools() {
      return call('listTools')
    },
    async callTool(toolName, args) {
      return call('callTool', { toolName, args })
    },
    async listPrompts() {
      return call('listPrompts')
    },
    async getPrompt(promptName, args) {
      return call('getPrompt', { promptName, args })
    },
    async listResources() {
      return call('listResources')
    },
    async readResource(uri) {
      return call('readResource', { uri })
    },
    async close() {
      if (closed) return
      closed = true
      await closeHandle(handle)
    }
  }
}

export function normalizeMcpPromptArgs(args) {
  if (args === undefined || args === null) return undefined
  if (args && typeof args === 'object' && !Array.isArray(args) && !Object.keys(args).length) return undefined
  return args
}

export async function getMcpPrompt(client, promptName, args) {
  const name = String(promptName || '').trim()
  if (!name) throw new Error('MCP prompt name is required')

  const normalizedArgs = normalizeMcpPromptArgs(args)
  const params = { name }
  if (normalizedArgs !== undefined) params.arguments = normalizedArgs

  // Prefer the raw request path so renderer fixes work even before Electron reloads preload code.
  if (typeof client?.sendRequest === 'function') {
    try {
      return await client.sendRequest('prompts/get', params)
    } catch (err) {
      const message = String(err?.message || err || '')
      if (normalizedArgs === undefined && /error rendering prompt/i.test(message)) {
        return client.sendRequest('prompts/get', { name, arguments: {} })
      }
      throw err
    }
  }
  if (typeof client?.getPrompt === 'function') {
    return client.getPrompt(name, normalizedArgs)
  }
  throw new Error('MCP 客户端不支持 prompts/get')
}

export function getOrCreateMCPClient(serverConfig) {
  const normalizedServerConfig = bridgeNormalizeMcpServerConfigForBridge(serverConfig)
  const keepAlive = !!normalizedServerConfig?.keepAlive
  const serverId = normalizedServerConfig?._id
  const fingerprint = getMcpServerFingerprint(normalizedServerConfig)

  if (keepAlive && serverId) {
    // keepAlive 的 client 只在配置完全一致时复用，避免拿错旧连接。
    const existing = pooledClientsByServerId.get(serverId)
    if (existing?.client && existing.fingerprint === fingerprint) return { client: existing.client, pooled: true }
    if (existing?.client) {
      try {
        existing.client.close?.()
      } catch {
        // ignore
      }
      pooledClientsByServerId.delete(serverId)
    }

    const client = createMCPClient(normalizedServerConfig)
    if (client) pooledClientsByServerId.set(serverId, { client, fingerprint })
    return { client, pooled: !!client }
  }

  return { client: createMCPClient(normalizedServerConfig), pooled: false }
}

export function normalizeMcpServerConfigForBridge(serverConfig) {
  return bridgeNormalizeMcpServerConfigForBridge(serverConfig)
}

export function prepareMcpServerForBridge(serverConfig) {
  return bridgeNormalizeMcpServerConfigForBridge(serverConfig)
}

export function releaseMCPClient(serverConfig, client) {
  if (!client) return
  const normalizedServerConfig = bridgeNormalizeMcpServerConfigForBridge(serverConfig)
  const keepAlive = !!normalizedServerConfig?.keepAlive
  const serverId = normalizedServerConfig?._id

  // keepAlive 的 client 交给池子管理，不在这里主动 close。
  if (keepAlive && serverId) return

  try {
    client.close?.()
  } catch {
    // ignore
  }
}

export function closePooledMCPClient(serverId) {
  const id = String(serverId || '')
  if (!id) return

  const entry = pooledClientsByServerId.get(id)
  const client = entry?.client
  if (!client) return

  try {
    client.close?.()
  } catch {
    // ignore
  } finally {
    pooledClientsByServerId.delete(id)
  }
}

export function closeAllPooledMCPClients() {
  for (const [serverId, entry] of pooledClientsByServerId.entries()) {
    try {
      entry?.client?.close?.()
    } catch {
      // ignore
    } finally {
      pooledClientsByServerId.delete(serverId)
    }
  }
}

export function hasPooledMCPClient(serverId) {
  const id = String(serverId || '')
  if (!id) return false
  return pooledClientsByServerId.has(id)
}
