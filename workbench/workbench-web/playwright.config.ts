import { defineConfig } from '@playwright/test'

/**
 * Playwright 配置（L1 收口 Task 22 / D6 / Step 2 e2e 冒烟）。
 *
 * 测试文件位于 test/e2e/ 目录（.spec.ts 后缀），与 vitest 的 test/ 根目录下
 *   .test.ts 文件天然隔离——vitest 的 include 规则只收 .test.ts，不拾取 .spec.ts。
 *
 * 启法：`E2E=1 bunx playwright test`
 *
 * env-gate：未设 E2E 环境变量时全部 skip（避免 CI 误跑双进程重负担）。
 *   testDir 限定 test/e2e/，不与 vitest 的 test/ 根混。
 *
 * 服务起法：测试 beforeAll spawn `bun run src/main.ts`（带 WORKBENCH_HOME=mkdtemp 隔离）
 *   + web dev `bun run dev`（VITE_PROXY_TARGET 指 service 端口）。
 *   端口 19982（service）/ 5173（web dev 默认）—— 与 vite.config.ts proxyTarget 配对。
 */
export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  retries: 0,
  workers: 1,
  reporter: 'list',
})
