import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'

// V0.1 仅 `/` → Home（占位页，D-6：路由骨架不做业务页面）
export const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: Home }],
})
