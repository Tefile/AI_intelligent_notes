// 附件文本解析入口：把附件交给 worker 提取可读文本。
let worker = null
let sequence = 0
const pendingMap = new Map()

function ensureWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../workers/attachmentTextParser.worker.js', import.meta.url), { type: 'module' })

  worker.addEventListener('message', (event) => {
    const payload = event?.data || {}
    const pending = pendingMap.get(payload.id)
    if (!pending) return
    pendingMap.delete(payload.id)
    // worker 正常返回时直接完成对应请求，异常则把错误往上抛。
    if (payload.ok) pending.resolve(String(payload.text || ''))
    else pending.reject(new Error(payload.error || '附件解析失败'))
  })

  worker.addEventListener('error', (event) => {
    const error = event?.error || new Error(event?.message || '附件解析工作线程失败')
    // worker 崩了时，把所有挂起请求一起失败掉，并清掉旧 worker，避免后续一直卡死。
    for (const pending of pendingMap.values()) {
      pending.reject(error)
    }
    pendingMap.clear()
    try {
      worker?.terminate?.()
    } catch {
      // ignore
    }
    worker = null
  })

  return worker
}

export async function parseAttachmentTextInWorker(options = {}) {
  const ext = String(options.ext || '').trim().toLowerCase()
  const file = options.file
  if (!file) throw new Error('Attachment file is required')
  if (!ext) throw new Error('Attachment extension is required')

  const id = `attachment_${Date.now()}_${sequence++}`
  const parserWorker = ensureWorker()
  const arrayBuffer = await file.arrayBuffer()

  return new Promise((resolve, reject) => {
    // 先登记 pending，再把二进制丢给 worker，避免极端情况下消息先回再丢失回调。
    pendingMap.set(id, { resolve, reject })
    parserWorker.postMessage(
      {
        id,
        ext,
        fileName: String(options.fileName || file.name || ''),
        maxChars: Number(options.maxChars) || 0,
        arrayBuffer
      },
      [arrayBuffer]
    )
  })
}

export async function parseAttachmentTextWithFallback(options = {}) {
  const ext = String(options.ext || '').trim().toLowerCase()
  const file = options.file
  if (!file) throw new Error('Attachment file is required')
  if (!ext) throw new Error('Attachment extension is required')

  try {
    return await parseAttachmentTextInWorker(options)
  } catch (workerError) {
    // worker 失败后再走纯前端解析，尽量不让附件文本直接丢失。
    const arrayBuffer = await file.arrayBuffer()
    try {
      const { parseAttachmentText, truncateAttachmentText } = await import('./attachmentTextParserCore')
      const text = await parseAttachmentText(ext, arrayBuffer)
      return truncateAttachmentText(text, Number(options.maxChars) || 0)
    } catch (fallbackError) {
      const workerMessage = workerError?.message || String(workerError)
      const fallbackMessage = fallbackError?.message || String(fallbackError)
      throw new Error(`附件解析失败。工作线程：${workerMessage}；降级方案：${fallbackMessage}`)
    }
  }
}

export function resetAttachmentTextParserWorker() {
  try {
    worker?.terminate?.()
  } catch {
    // ignore
  }
  worker = null
  pendingMap.clear()
}
