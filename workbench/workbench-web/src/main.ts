// 全局设计 token 最先引入（I0-5 T7：:root 变量 + body 基调，原型 workbench.html 同源）
import './styles/tokens.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'

createApp(App).use(createPinia()).use(router).mount('#app')
