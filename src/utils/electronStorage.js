// Electron 存储适配层：封装本地持久化读写和降级方案。
const electronAPI = typeof window !== 'undefined' ? window.electronAPI : null

export function getDbStorage() {
  if (electronAPI?.db) return electronAPI.db
  const memory = new Map()
  return {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null
    },
    setItem(key, value) {
      memory.set(key, value)
    },
    removeItem(key) {
      memory.delete(key)
    }
  }
}
