import { createApp } from 'vue'
import App from '@/App.vue'
import configListener from '@/utils/configListener'
import { initTimedTaskRunner } from '@/utils/timedTaskRunner'
import router from './router'
import 'vfonts/Lato.css'
import 'vfonts/FiraCode.css'

// Electron 桌面应用中不需要 uTools PluginEnter 监听，配置监听已足够
// utoolsListener 在 Electron 环境下 init() 为空操作
configListener.init()

// Electron 桌面应用始终启用定时任务运行器
initTimedTaskRunner()

const app = createApp(App)
app.use(router)
app.mount('#app')
