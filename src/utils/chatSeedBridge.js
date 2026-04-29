let pendingChatSeed = null
const listeners = new Set()

function normalizeSeedPayload(payload = {}) {
  const text = String(payload?.text || payload?.prompt || '').trim()
  if (!text) return null

  return {
    text,
    title: String(payload?.title || '').trim(),
    source: String(payload?.source || '').trim(),
    filePath: String(payload?.filePath || '').trim(),
    cellId: String(payload?.cellId || '').trim(),
    kind: String(payload?.kind || 'chat-seed').trim()
  }
}

export function requestChatSeed(payload = {}) {
  const seed = normalizeSeedPayload(payload)
  if (!seed) return null

  pendingChatSeed = seed

  try {
    window?.dispatchEvent?.(new CustomEvent('chat-seed-request', { detail: seed }))
  } catch {
    // ignore
  }

  listeners.forEach((listener) => {
    try {
      listener(seed)
    } catch {
      // ignore listener errors
    }
  })

  return seed
}

export function consumePendingChatSeed() {
  const seed = pendingChatSeed
  pendingChatSeed = null
  return seed
}

export function onChatSeed(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}
