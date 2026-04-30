/**
 * Electron 主进程入口
 *
 * 负责：
 * 1. 创建 BrowserWindow 并加载 Vue 前端
 * 2. 初始化 SQLite 数据库（替代 uTools dbCryptoStorage）
 * 3. 注册 IPC 通信通道（文件操作、对话框、Shell、数据库、会话管理、MCP 工具审批中继）
 *
 * 安全策略：contextIsolation + nodeIntegration: false，所有 Node.js 能力通过 preload.cjs 暴露。
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const db = require('./db.cjs')

const isDev = process.env.NODE_ENV === 'development'
const DEV_URL = 'http://localhost:5173'
const userDataOverride = String(process.env.AI_TOOLS_USER_DATA_DIR || '').trim()
const rendererEntryPath = path.join(__dirname, '..', 'dist', 'index.html')
const logPrefix = '[main]'

if (userDataOverride) {
  app.setPath('userData', path.resolve(userDataOverride))
}

let mainWindow = null

function logInfo(...args) {
  console.log(logPrefix, ...args)
}

function logError(...args) {
  console.error(logPrefix, ...args)
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildMissingRendererHtml(targetPath) {
  const missingPath = escapeHtml(targetPath)
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Renderer Not Found</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(180deg, #f8fafc, #e2e8f0);
        color: #0f172a;
      }
      .panel {
        width: min(720px, calc(100vw - 48px));
        padding: 28px 32px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 20px 48px rgba(15, 23, 42, 0.14);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.7;
      }
      code, pre {
        font-family: "Fira Code", Consolas, monospace;
      }
      pre {
        margin: 12px 0 0;
        padding: 14px 16px;
        border-radius: 12px;
        background: #0f172a;
        color: #e2e8f0;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      ul {
        margin: 0;
        padding-left: 20px;
        line-height: 1.8;
      }
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>找不到前端构建产物</h1>
      <p>Electron 当前尝试加载生产页面，但下面这个文件不存在：</p>
      <pre>${missingPath}</pre>
      <p>本地开发请直接运行：</p>
      <pre>npm start</pre>
      <p>如果你就是想按生产方式启动，请先构建 renderer：</p>
      <pre>npm run build:renderer
npm run start:prod</pre>
      <p>说明：</p>
      <ul>
        <li><code>npm start</code> 现在会启动 Vite + Electron 的开发模式</li>
        <li><code>npm run start:prod</code> 会按 <code>dist/index.html</code> 启动</li>
      </ul>
    </main>
  </body>
</html>`
}

/** 创建主窗口 */
function createMainWindow() {
  logInfo('createMainWindow:start', { isDev, preload: path.join(__dirname, 'preload.cjs') })
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Figturmobi AI Tools',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,    // 隔离 preload 和 renderer 的 JavaScript 上下文
      nodeIntegration: false,     // 禁止 renderer 直接使用 Node.js API
      sandbox: false              // 允许 preload 使用 require（加载工具模块）
    }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logError('webContents.did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logError('webContents.render-process-gone', details)
  })

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    logError('webContents.preload-error', {
      preloadPath,
      message: error?.message || String(error || ''),
      stack: error?.stack || ''
    })
  })

  mainWindow.webContents.on('console-message', (details) => {
    const level = details?.level || 'info'
    if (level === 'warning' || level === 'error') {
      logInfo('renderer.console', {
        level,
        message: details?.message || '',
        line: details?.lineNumber ?? null,
        sourceId: details?.sourceId || '',
        frameRoutingId: details?.frame?.routingId ?? null
      })
    }
  })

  if (isDev) {
    logInfo('loadURL', DEV_URL)
    mainWindow.loadURL(DEV_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    if (fs.existsSync(rendererEntryPath)) {
      logInfo('loadFile', rendererEntryPath)
      mainWindow.loadFile(rendererEntryPath)
    } else {
      logError('renderer entry missing', rendererEntryPath)
      mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(buildMissingRendererHtml(rendererEntryPath))}`)
    }
  }

  mainWindow.on('closed', () => {
    logInfo('window closed')
    mainWindow = null
  })
}

app.on('browser-window-created', () => {
  logInfo('browser-window-created')
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('destroyed', () => {
    logInfo('webContents destroyed')
  })
})

app.on('render-process-gone', (_event, _webContents, details) => {
  logError('app.render-process-gone', details)
})

app.on('child-process-gone', (_event, details) => {
  logError('app.child-process-gone', details)
})

app.on('window-all-closed', () => {
  logInfo('window-all-closed')
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  logInfo('will-quit')
  db.close()
})

app.on('quit', (_event, exitCode) => {
  logInfo('quit', { exitCode })
})

process.on('uncaughtException', (error) => {
  logError('uncaughtException', error?.stack || error?.message || String(error || ''))
})

process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason?.stack || reason?.message || String(reason || ''))
})

app.whenReady().then(async () => {
  logInfo('whenReady')
  // 初始化 SQLite 数据库（sql.js WASM 模块需异步加载）
  await db.init(path.join(app.getPath('userData'), 'aitools.db'))
  logInfo('db initialized')
  registerIpcHandlers()
  logInfo('ipc handlers registered')
  createMainWindow()

  // macOS: 点击 Dock 图标时重新创建窗口
  app.on('activate', () => {
    logInfo('activate')
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
}).catch((error) => {
  logError('whenReady failed', error?.stack || error?.message || String(error || ''))
})

/** 注册所有 IPC 通信通道 */
function registerIpcHandlers() {
  // === 应用信息（异步） ===
  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('app:getPath', (_e, name) => app.getPath(name))

  // 同步获取路径（供 preload 初始化时使用，此时不支持异步 invoke）
  ipcMain.on('app:getPathSync', (event, name) => {
    event.returnValue = app.getPath(name)
  })

  // === 文件对话框 ===
  ipcMain.handle('dialog:showOpen', async (_e, options) => {
    const win = BrowserWindow.getFocusedWindow()
    return dialog.showOpenDialog(win, options || {})
  })

  ipcMain.handle('dialog:showSave', async (_e, options) => {
    const win = BrowserWindow.getFocusedWindow()
    return dialog.showSaveDialog(win, options || {})
  })

  // === 系统 Shell ===
  ipcMain.handle('shell:openPath', async (_e, p) => shell.openPath(p))
  ipcMain.handle('shell:openExternal', async (_e, url) => shell.openExternal(url))

  // === 文件系统操作（供 preload fileOperations 模块使用） ===
  ipcMain.handle('fs:readFile', async (_e, filePath, encoding = 'utf8') => {
    return fs.promises.readFile(filePath, encoding)
  })
  ipcMain.handle('fs:writeFile', async (_e, filePath, data, encoding = 'utf8') => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, data, encoding)
    return true
  })
  ipcMain.handle('fs:exists', async (_e, p) => fs.existsSync(p))

  // === SQLite 键值存储（同步，替代 utools.dbCryptoStorage） ===
  ipcMain.on('db:getItem', (event, key) => {
    try { event.returnValue = db.getItem(key) }
    catch (e) { event.returnValue = null }
  })

  ipcMain.on('db:setItem', (event, key, value) => {
    try { event.returnValue = db.setItem(key, value) }
    catch (e) { event.returnValue = false }
  })

  ipcMain.on('db:removeItem', (event, key) => {
    try { event.returnValue = db.removeItem(key) }
    catch (e) { event.returnValue = false }
  })

  ipcMain.on('user:getCurrentId', (event) => {
    try { event.returnValue = db.getCurrentUserId() }
    catch (e) { event.returnValue = 'local-default' }
  })

  ipcMain.on('user:getCurrent', (event) => {
    try { event.returnValue = db.getCurrentUser() }
    catch (e) { event.returnValue = null }
  })

  ipcMain.on('user:list', (event) => {
    try { event.returnValue = db.listUsers() }
    catch (e) { event.returnValue = [] }
  })

  ipcMain.on('user:save', (event, user, options = {}) => {
    try { event.returnValue = db.saveUser(user, options) }
    catch (e) { event.returnValue = null }
  })

  ipcMain.on('user:switch', (event, id) => {
    try { event.returnValue = db.switchUser(id) }
    catch (e) { event.returnValue = null }
  })

  ipcMain.on('user:delete', (event, id) => {
    try { event.returnValue = db.deleteUser(id) }
    catch (e) { event.returnValue = [] }
  })

  // === 会话管理（异步，替代文件系统 JSON 存储） ===
  ipcMain.handle('session:listTree', () => db.sessionListTree())
  ipcMain.handle('session:get', (_e, id) => db.sessionGet(id))
  ipcMain.handle('session:getByPath', (_e, fp) => db.sessionGetByPath(fp))
  ipcMain.handle('session:listByFolder', (_e, folder) => db.sessionListByFolder(folder))
  ipcMain.handle('session:create', (_e, data) => db.sessionCreate(data))
  ipcMain.handle('session:update', (_e, id, patch) => db.sessionUpdate(id, patch))
  ipcMain.handle('session:delete', (_e, id) => db.sessionDelete(id))

  // === 配置变更事件中继（preload → renderer） ===
  // global-config.js 在 preload 中派发 globalConfigChanged 事件，
  // 但 contextIsolation 隔离了 preload 和 renderer 的 window，需要中继
  ipcMain.on('config:changed', (_event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config:changed', data)
    }
  })

  // === MCP 工具审批事件中继（preload ↔ renderer 通过主进程中转） ===
  // 在 Electron 中，preload 和 renderer 有各自隔离的 window 对象，
  // 无法直接通过 CustomEvent 通信，因此通过主进程 IPC 中继。

  // 审批请求：preload → 主进程 → renderer
  ipcMain.on('agent:toolApprovalRequest', (_event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent:toolApprovalRequest', data)
    }
  })

  // 审批响应：renderer → 主进程 → preload
  ipcMain.on('agent:toolApprovalResponse', (_event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent:toolApprovalResponse', data)
    }
  })
}
