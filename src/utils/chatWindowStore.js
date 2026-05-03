// 聊天窗口状态仓库：保存会话窗口、草稿和临时 UI 状态。
import { getDbStorage } from '@/utils/electronStorage'

const CHAT_WINDOW_STORE_KEY = 'ai-tools:chat-windows:v1'
const CHAT_WINDOW_STORE_VERSION = 1

function nowIso() {
  return new Date().toISOString()
}

function createId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback))
  } catch {
    return JSON.parse(JSON.stringify(fallback))
  }
}

function toSafeInteger(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return Math.max(0, Math.floor(fallback))
  return Math.max(0, Math.floor(number))
}

function resolveWindowKind(source) {
  const explicitKind = String(source?.windowKind || '').trim()
  if (explicitKind === 'draft' || explicitKind === 'archived') return explicitKind
  return String(source?.activeSessionFilePath || '').trim() ? 'archived' : 'draft'
}

function computeWindowUnsavedChanges(source, { messages = [], apiMessages = [] } = {}) {
  if (String(source?.input || '').trim()) return true
  if (Array.isArray(source?.pendingAttachments) && source.pendingAttachments.length > 0) return true
  if (!String(source?.activeSessionFilePath || '').trim()) {
    return messages.length > 0 || apiMessages.length > 0
  }
  return false
}

function normalizeWindowState(raw, index = 0) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const session = source.session && typeof source.session === 'object' ? source.session : {}
  const messages = Array.isArray(session.messages) ? cloneJson(session.messages, []) : []
  const apiMessages = Array.isArray(session.apiMessages) ? cloneJson(session.apiMessages, []) : []
  const messageCount = messages.length
  const title = String(source.title || `窗口 ${index + 1}`).trim() || `窗口 ${index + 1}`
  const lastViewedMessageCount = toSafeInteger(source.lastViewedMessageCount, 0)
  const unreadCount = toSafeInteger(source.unreadCount, Math.max(0, messageCount - lastViewedMessageCount))
  const windowKind = resolveWindowKind(source)
  const lastSavedAt = String(source.lastSavedAt || '').trim()

  return {
    id: String(source.id || createId()).trim() || createId(),
    title,
    session: {
      messages,
      apiMessages
    },
    activeSessionFilePath: String(source.activeSessionFilePath || '').trim(),
    activeSessionTitle: String(source.activeSessionTitle || '').trim(),
    selectedAgentId: source.selectedAgentId ?? null,
    selectedProviderId: source.selectedProviderId ?? null,
    selectedModel: String(source.selectedModel || '').trim(),
    basePromptMode: String(source.basePromptMode || 'custom'),
    selectedPromptId: source.selectedPromptId ?? null,
    customSystemPrompt: String(source.customSystemPrompt || ''),
    selectedSkillIds: cloneJson(source.selectedSkillIds || [], []),
    agentSkillIds: cloneJson(source.agentSkillIds || [], []),
    activatedAgentSkillIds: cloneJson(source.activatedAgentSkillIds || [], []),
    manualMcpIds: cloneJson(source.manualMcpIds || [], []),
    webSearchEnabled: !!source.webSearchEnabled,
    autoApproveTools: source.autoApproveTools !== undefined ? !!source.autoApproveTools : true,
    autoActivateAgentSkills: source.autoActivateAgentSkills !== undefined ? !!source.autoActivateAgentSkills : true,
    toolMode: String(source.toolMode || 'auto'),
    effectiveToolMode: String(source.effectiveToolMode || 'expanded'),
    thinkingEffort: String(source.thinkingEffort || 'auto'),
    imageGenerationMode: String(source.imageGenerationMode || 'auto'),
    videoGenerationMode: String(source.videoGenerationMode || 'auto'),
    input: String(source.input || ''),
    pendingAttachments: cloneJson(source.pendingAttachments || [], []),
    windowKind,
    hasUnsavedChanges: computeWindowUnsavedChanges(source, { messages, apiMessages }),
    lastSavedAt,
    sessionSiderCollapsed: source.sessionSiderCollapsed !== undefined ? !!source.sessionSiderCollapsed : true,
    lastViewedMessageCount,
    unreadCount,
    createdAt: String(source.createdAt || nowIso()),
    updatedAt: String(source.updatedAt || nowIso())
  }
}

function normalizeStoreState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const windows = Array.isArray(source.windows) ? source.windows.map((item, index) => normalizeWindowState(item, index)) : []
  const safeWindows = windows.length ? windows : [normalizeWindowState({}, 0)]
  const activeChatWindowId = String(source.activeChatWindowId || safeWindows[0].id).trim() || safeWindows[0].id

  return {
    schemaVersion: CHAT_WINDOW_STORE_VERSION,
    activeChatWindowId: safeWindows.some((item) => item.id === activeChatWindowId) ? activeChatWindowId : safeWindows[0].id,
    windows: safeWindows
  }
}

export function readChatWindowsState() {
  try {
    const raw = getDbStorage()?.getItem(CHAT_WINDOW_STORE_KEY)
    return normalizeStoreState(raw)
  } catch {
    return normalizeStoreState({})
  }
}

export function writeChatWindowsState(nextState) {
  const normalized = normalizeStoreState(nextState)
  try {
    getDbStorage()?.setItem(CHAT_WINDOW_STORE_KEY, normalized)
  } catch {
    // ignore persistence failures
  }
  return normalized
}

export function clearChatWindowsState() {
  try {
    getDbStorage()?.removeItem(CHAT_WINDOW_STORE_KEY)
  } catch {
    // ignore
  }
}

export function buildPersistedChatWindowSnapshot(windowState, { active = false, index = 0 } = {}) {
  const normalized = normalizeWindowState(windowState, index)
  const messageCount = normalized.session.messages.length
  const lastViewedMessageCount = active
    ? messageCount
    : Math.min(normalized.lastViewedMessageCount, messageCount)

  return {
    ...normalized,
    lastViewedMessageCount,
    unreadCount: active ? 0 : Math.max(0, messageCount - lastViewedMessageCount),
    updatedAt: nowIso()
  }
}
