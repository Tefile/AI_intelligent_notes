// Notebook 运行时：负责执行、流式输出和前后端桥接。
﻿function getNotebookRuntimeApi() {
  return globalThis?.notebookRuntime
}

function rejectNotInjected(methodName) {
  return Promise.reject(
    new Error(`notebookRuntime.${methodName} 未注入，请检查 Electron preload 是否已加载。`)
  )
}

function callNotebookRuntime(methodName, ...args) {
  const api = getNotebookRuntimeApi()
  const fn = api?.[methodName]
  // 没有注入 runtime 时，直接返回一个统一的拒绝 Promise，调用方就不用区分同步/异步了。
  if (typeof fn !== 'function') return rejectNotInjected(methodName)

  try {
    const result = fn.apply(api, args)
    // preload 的方法有些是同步值，有些是 Promise，这里统一包装成 Promise 方便上层 await。
    if (result && typeof result.then === 'function') return result
    return Promise.resolve(result)
  } catch (err) {
    return Promise.reject(err)
  }
}

export function createNotebookSession(options) {
  return callNotebookRuntime('createSession', options)
}

export function executeNotebookCell(sessionId, options) {
  return callNotebookRuntime('executeCell', sessionId, options)
}

export function provideNotebookCellInput(sessionId, options) {
  return callNotebookRuntime('provideInputReply', sessionId, options)
}

export function executeNotebookMagicSpecs(options) {
  return callNotebookRuntime('executeMagicSpecs', options)
}

export function interruptNotebookMagicExecution(executionId) {
  return callNotebookRuntime('interruptMagicExecution', executionId)
}

export function interruptNotebookSession(sessionId) {
  return callNotebookRuntime('interruptSession', sessionId)
}

export function restartNotebookSession(sessionId) {
  return callNotebookRuntime('restartSession', sessionId)
}

export function forceRestartNotebookSession(sessionId, options) {
  return callNotebookRuntime('forceRestartSession', sessionId, options)
}

export function shutdownNotebookSession(sessionId) {
  return callNotebookRuntime('shutdownSession', sessionId)
}

export function detectNotebookPython() {
  return callNotebookRuntime('detectPython')
}

export function installNotebookDependencies(options) {
  return callNotebookRuntime('installDependencies', options)
}

export function listNotebookPythonModules(options) {
  return callNotebookRuntime('listPythonModules', options)
}

export function checkNotebookPythonLsp(options) {
  return callNotebookRuntime('checkPythonLsp', options)
}

export function invalidateNotebookRuntimeCaches(options) {
  return callNotebookRuntime('invalidateCaches', options)
}

export function getNotebookPythonCompletions(options) {
  return callNotebookRuntime('getPythonCompletions', options)
}

export function getNotebookPythonHover(options) {
  return callNotebookRuntime('getPythonHover', options)
}

export function getNotebookPythonDefinition(options) {
  return callNotebookRuntime('getPythonDefinition', options)
}

export function getNotebookPythonSignatureHelp(options) {
  return callNotebookRuntime('getPythonSignatureHelp', options)
}

export function listManagedNotebookVenvs() {
  return callNotebookRuntime('listManagedVenvs')
}

export function createManagedNotebookVenv(options) {
  return callNotebookRuntime('createManagedVenv', options)
}
