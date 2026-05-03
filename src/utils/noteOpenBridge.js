// 笔记打开桥接：负责把文件打开请求交给 Electron 或本地运行时。
let pendingNotePath = ''
const listeners = new Set()

function normalizeNotePath(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function requestOpenNoteFile(filePath) {
  const path = normalizeNotePath(filePath)
  if (!path) return

  pendingNotePath = path
  listeners.forEach((listener) => {
    try {
      listener(path)
    } catch {
      // ignore listener errors
    }
  })
}

export function consumePendingNoteFile() {
  const path = pendingNotePath
  pendingNotePath = ''
  return path
}

export function onOpenNoteFile(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}
