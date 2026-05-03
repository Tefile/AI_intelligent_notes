// MCP 桥接规范化工具：负责把响应式对象整理成可跨进程传递的数据。
import { toRaw } from 'vue'

export function cloneForBridge(value, seen = new WeakMap()) {
  if (value === null || value === undefined) return value
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => cloneForBridge(item, seen))
  if (seen.has(value)) return seen.get(value)

  const out = {}
  seen.set(value, out)
  for (const key of Object.keys(value)) {
    const next = cloneForBridge(value[key], seen)
    if (next !== undefined) out[key] = next
  }
  return out
}

export function normalizeMcpServerConfigForBridge(serverConfig) {
  return cloneForBridge(toRaw(serverConfig || {}))
}

export function stableSerialize(value) {
  try {
    const normalize = (input) => {
      if (Array.isArray(input)) return input.map(normalize)
      if (!input || typeof input !== 'object') return input
      return Object.keys(input)
        .sort()
        .reduce((acc, key) => {
          acc[key] = normalize(input[key])
          return acc
        }, {})
    }
    return JSON.stringify(normalize(value))
  } catch {
    return String(value)
  }
}

export function getMcpServerFingerprint(serverConfig) {
  const normalized = normalizeMcpServerConfigForBridge(serverConfig)
  return stableSerialize({
    transportType: normalized?.transportType,
    command: normalized?.command,
    args: Array.isArray(normalized?.args) ? normalized.args : [],
    env: normalized?.env && typeof normalized.env === 'object' ? normalized.env : {},
    cwd: normalized?.cwd,
    url: normalized?.url,
    headers: normalized?.headers && typeof normalized.headers === 'object' ? normalized.headers : {},
    method: normalized?.method,
    stream: normalized?.stream,
    pingOnConnect: normalized?.pingOnConnect,
    maxTotalTimeout: normalized?.maxTotalTimeout,
    timeout: normalized?.timeout
  })
}
