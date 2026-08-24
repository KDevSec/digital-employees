import { defineConfig } from 'vitest/config'

// 与 vite.config.ts 分离：单测只跑纯逻辑（无 .vue / 无 singlefile 插件参与）
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
