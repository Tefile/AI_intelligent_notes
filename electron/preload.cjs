/**
 * Electron 预加载脚本 (Preload Script)
 *
 * 作为 Electron 主进程和渲染进程之间的安全桥梁：
 * 1. 加载原 uTools 插件的 Node.js 工具模块（globalConfig、fileOperations 等）
 * 2. 通过 contextBridge 将服务暴露给渲染进程（Vue 前端），
 *    保持与 uTools 插件完全一致的 window 全局 API 接口
 * 3. 处理 MCP 工具审批事件的跨上下文 IPC 中继
 *
 * 安全原则：contextIsolation: true，渲染进程无法直接访问 Node.js API，
 * 所有系统能力通过此预加载脚本中暴露的有限接口调用。
 */

const { contextBridge, ipcRenderer } = require('electron')

// ---------- 加载原 uTools 插件的所有预加载服务模块（Node.js 上下文）----------
const globalConfig = require('./preload-utils/global-config')
const fileOperations = require('./preload-utils/file-operations')
const createMCPClient = require('./preload-utils/mcp-client')
const localUser = require('./preload-utils/local-user')
const notebookRuntime = require('./preload-utils/notebook-runtime')
const webOperations = require('./preload-utils/web-operations')

function createBridgeApi(source) {
  if (!source || (typeof source !== 'object' && typeof source !== 'function')) return {}

  const api = {}
  const seen = new Set()
  let current = source

  while (current && current !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (key === 'constructor' || seen.has(key)) continue
      const value = source[key]
      if (typeof value !== 'function') continue
      api[key] = (...args) => source[key](...args)
      seen.add(key)
    }
    current = Object.getPrototypeOf(current)
  }

  return api
}

const globalConfigApi = createBridgeApi(globalConfig)
const fileOperationsApi = createBridgeApi(fileOperations)
const notebookRuntimeApi = createBridgeApi(notebookRuntime)

// 确保内置 MCP Server / Skill / Prompt 等预设数据存在
try {
  globalConfig.ensureBuiltins?.()
} catch (e) {
  console.warn('[preload] ensureBuiltins 失败:', e.message)
}

// ---------- 跨上下文事件中继 ----------
// 在 Electron 中，preload 有自己的隔离 window 对象（与 renderer 的 window 不同）。
// preload 模块通过 dispatchEvent 在 preload window 上派发 CustomEvent，
// 但 Vue 前端监听的是 renderer 的 window。因此需要通过 IPC 中继。

// 配置变更事件（configListener 依赖此事件进行响应式更新）
window.addEventListener('globalConfigChanged', (event) => {
  ipcRenderer.send('config:changed', { eventType: 'globalConfigChanged', detail: event.detail })
})
window.addEventListener('globalConfigBackupChanged', (event) => {
  ipcRenderer.send('config:changed', { eventType: 'globalConfigBackupChanged', detail: event.detail })
})

// MCP 工具审批请求（preload → renderer）
window.addEventListener('builtin-agents-tool-approval-request', (event) => {
  ipcRenderer.send('agent:toolApprovalRequest', event.detail)
})
// MCP 工具审批响应（renderer → preload）
ipcRenderer.on('agent:toolApprovalResponse', (_event, data) => {
  window.dispatchEvent(new CustomEvent('builtin-agents-tool-approval-response', { detail: data }))
})

// ---------- 通过 contextBridge 暴露服务给渲染进程 ----------
// 这些全局对象与 uTools 插件环境中的 window.globalConfig、window.fileOperations 等完全一致，
// 业务代码无需任何修改即可使用。

contextBridge.exposeInMainWorld('globalConfig', globalConfigApi)
contextBridge.exposeInMainWorld('fileOperations', fileOperationsApi)
contextBridge.exposeInMainWorld('createMCPClient', createMCPClient)
contextBridge.exposeInMainWorld('localUser', localUser)
contextBridge.exposeInMainWorld('notebookRuntime', notebookRuntimeApi)
contextBridge.exposeInMainWorld('webOperations', webOperations)

// ---------- 暴露底层 Electron API（扩展版，含 SQLite + 会话 + 工具审批） ----------
const api = {
  // 应用信息
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPath: (name) => ipcRenderer.invoke('app:getPath', name)
  },
  // 文件对话框
  dialog: {
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpen', options),
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSave', options)
  },
  // 系统 Shell
  shell: {
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  // 文件系统操作
  fs: {
    readFile: (p, enc) => ipcRenderer.invoke('fs:readFile', p, enc),
    writeFile: (p, data, enc) => ipcRenderer.invoke('fs:writeFile', p, data, enc),
    exists: (p) => ipcRenderer.invoke('fs:exists', p)
  },
  // SQLite 键值存储（替代 utools.dbCryptoStorage）
  db: {
    getItem: (key) => ipcRenderer.sendSync('db:getItem', key),
    setItem: (key, value) => ipcRenderer.sendSync('db:setItem', key, value),
    removeItem: (key) => ipcRenderer.sendSync('db:removeItem', key)
  },
  // 聊天会话 CRUD（替代文件系统 JSON 文件）
  session: {
    listTree: () => ipcRenderer.invoke('session:listTree'),
    get: (id) => ipcRenderer.invoke('session:get', id),
    getByPath: (path) => ipcRenderer.invoke('session:getByPath', path),
    listByFolder: (folder) => ipcRenderer.invoke('session:listByFolder', folder),
    create: (data) => ipcRenderer.invoke('session:create', data),
    update: (id, patch) => ipcRenderer.invoke('session:update', id, patch),
    delete: (id) => ipcRenderer.invoke('session:delete', id)
  },
  user: {
    getCurrent: () => localUser.getCurrentUser(),
    list: () => localUser.listUsers(),
    save: (user, options) => localUser.saveUser(user, options),
    switch: (id) => localUser.switchUser(id),
    delete: (id) => localUser.deleteUser(id),
    getUsersFilePath: () => localUser.getUsersFilePath()
  },
  // 配置变更事件监听（preload → renderer 中继）
  onConfigChanged: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('config:changed', listener)
    return () => ipcRenderer.removeListener('config:changed', listener)
  },
  // 工具审批事件监听（MCP 子智能体工具调用审批）
  onToolApprovalRequest: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('agent:toolApprovalRequest', listener)
    return () => ipcRenderer.removeListener('agent:toolApprovalRequest', listener)
  },
  respondToolApproval: (response) => {
    ipcRenderer.send('agent:toolApprovalResponse', response)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
