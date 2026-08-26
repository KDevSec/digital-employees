import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// 与 vite.config.ts 分离：单测不参与 singlefile 构建；include 只收 test/**/*.test.ts 不变（D-10）。
// 需挂 @vitejs/plugin-vue 的缘由：组件测试文件（// @vitest-environment jsdom 分流）直接 import .vue SFC，
// 无该插件时 vite:import-analysis 报「Failed to parse source … Install @vitejs/plugin-vue to handle .vue files」
// （已实证）。devDeps 本就有该插件（vite.config.ts 构建用），此处仅让测试管线获得同样的 SFC 编译能力，
// 不影响构建产物。纯函数测试（node 环境默认）不 import .vue，不受插件影响。
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['test/**/*.test.ts'],
  },
})
