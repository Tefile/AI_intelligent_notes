// Electron 预加载层的 MCP 客户端桥接：管理客户端句柄和调用转发。
function normalizeBridgeValue(value, seen = new WeakMap()) {
  if (value === null || value === undefined) return value
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => normalizeBridgeValue(item, seen))
  if (seen.has(value)) return seen.get(value)

  const out = {}
  seen.set(value, out)
  for (const key of Object.keys(value)) {
    const next = normalizeBridgeValue(value[key], seen)
    if (next !== undefined) out[key] = next
  }
  return out
}

function createMcpClientHandleManager(createClient) {
  const mcpClients = new Map()
  let nextMcpClientId = 1

  function createHandle(serverConfig) {
    const normalizedConfig = normalizeBridgeValue(serverConfig || {})
    const client = createClient(normalizedConfig)
    const handle = `mcp_${Date.now()}_${nextMcpClientId++}`
    mcpClients.set(handle, client)
    return handle
  }

  async function invoke(handle, action, payload) {
    const client = mcpClients.get(String(handle || ''))
    if (!client) throw new Error('MCP client handle not found')

    switch (String(action || '')) {
      case 'sendRequest':
        return client.sendRequest(payload?.method, payload?.params)
      case 'sendNotification':
        return client.sendNotification(payload?.method, payload?.params)
      case 'listTools':
        return client.listTools()
      case 'callTool':
        return client.callTool(payload?.toolName, payload?.args)
      case 'listPrompts':
        return client.listPrompts()
      case 'getPrompt':
        return client.getPrompt(payload?.promptName, payload?.args)
      case 'listResources':
        return client.listResources()
      case 'readResource':
        return client.readResource(payload?.uri)
      default:
        throw new Error(`Unsupported MCP client action: ${action}`)
    }
  }

  async function close(handle) {
    const key = String(handle || '').trim()
    if (!key) return false
    const client = mcpClients.get(key)
    if (!client) return false
    try {
      await client.close?.()
    } finally {
      mcpClients.delete(key)
    }
    return true
  }

  async function closeAll() {
    const handles = Array.from(mcpClients.keys())
    for (const handle of handles) {
      try {
        await close(handle)
      } catch {
        // ignore
      }
    }
  }

  return {
    createHandle,
    invoke,
    close,
    closeAll
  }
}

module.exports = {
  normalizeBridgeValue,
  createMcpClientHandleManager
}
