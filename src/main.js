import { createApp } from 'vue'
import App from '@/App.vue'
import configListener from '@/utils/configListener'
import { initTimedTaskRunner } from '@/utils/timedTaskRunner'
import router from './router'
import 'vfonts/Lato.css'
import 'vfonts/FiraCode.css'

const runtimeUserAgent = String(globalThis?.navigator?.userAgent || '')
const hasElectronRuntime = /\bElectron\/\d+/i.test(runtimeUserAgent) || !!globalThis?.electronAPI

if (!hasElectronRuntime) {
  console.warn('[runtime] 当前页面没有检测到 Electron preload。若要使用笔记、会话、本地文件等功能，请使用 `npm start` 启动桌面应用。')
}

// Electron 桌面应用不需要额外的 PluginEnter 监听，配置监听已足够
configListener.init()

// Electron 桌面应用始终启用定时任务运行器
initTimedTaskRunner()

const app = createApp(App)
app.use(router)
app.mount('#app')
