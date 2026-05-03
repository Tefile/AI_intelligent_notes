// 路由入口：把页面挂载到主布局，并设置默认落点。
import { createRouter, createWebHashHistory } from 'vue-router'
import Layout from '@/views/layout/Layout.vue'
import { routers } from './routes'

const routes = [
  {
    path: '/',
    name: 'layout',
    component: Layout,
    redirect: { name: 'chat' },
    children: routers
  }
]

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes
})

export default router
