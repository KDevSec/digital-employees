import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// D-6：构建产物必须是单个 index.html（全 JS/CSS 内联）——service 侧以
// `import ... with { type: 'text' }` 嵌入单体（Task 11）。dev 代理转发到本机服务。
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  server: {
    proxy: {
      '/healthz': 'http://127.0.0.1:19980',
      '/api': 'http://127.0.0.1:19980',
    },
  },
})
