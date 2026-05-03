// 剪贴板工具：封装文本复制、读取和兼容处理。
export async function copyTextToClipboard(text, options = {}) {
  const value = String(text || '')
  if (!value.trim()) return false

  const api = navigator?.clipboard
  if (!api?.writeText) {
    options.onUnsupported?.()
    return false
  }

  try {
    await api.writeText(value)
    options.onSuccess?.()
    return true
  } catch (err) {
    options.onError?.(err)
    return false
  }
}
