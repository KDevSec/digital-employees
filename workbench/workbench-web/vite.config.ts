import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// D-6：构建产物必须是单个 index.html（全 JS/CSS 内联）——service 侧以
// `import ... with { type: 'text' }` 嵌入单体（Task 11）。dev 代理转发到本机服务。
//
// 代理目标（D-9，I0-5 T6）：默认 main 产品端口 19980；worktree 线以环境变量改指本线端口
// （路线图 §4.3 端口纪律——本线 i0-webshell 用 19982，起法：
//   `VITE_PROXY_TARGET=http://127.0.0.1:19982 bun run --cwd workbench/workbench-web dev`）。
// /auth 键随 F-03 登录跳转链路需要（OIDC /auth/login、/auth/callback 经代理转发到后端）。
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:19980'

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  server: {
    proxy: {
      '/healthz': proxyTarget,
      '/api': proxyTarget,
      '/auth': proxyTarget,
    },
  },
})
