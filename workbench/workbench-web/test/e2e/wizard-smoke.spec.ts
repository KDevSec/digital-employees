/**
 * 向导 e2e 冒烟（L1 收口 Task 22 / D6 / Step 2）。
 *
 * 验收锚「向导全链可跑通」的可执行证明：
 *   起 service（隔离 WORKBENCH_HOME）+ web dev（VITE_PROXY_TARGET 指 service）
 *   → 访问 /employees/new → 选 dev-engineer 模板卡
 *   → 在 step 2 改 id 避冲突（seed 已物化 dev-engineer）→ 一路「下一步」×5 到 step 7
 *   → 点「生成员工包」→ 断言完成态出现（文件清单文本）
 *   → 跳 /employees 断言 8 卡（7 预置 + 1 新建）
 *
 * env-gate：未设 E2E 环境变量时 skip（避免 CI 误跑双进程；本地手动 `E2E=1 bunx playwright test`）。
 *
 * 注意：service 启动后 seedBuiltinEmployees 会物化 7 个员工（含 dev-engineer）。
 *   向导选 dev-engineer 模板时 id 自动填 dev-engineer → 与 seed 冲突（ID_CONFLICT）。
 *   解决：step 2 改 id 为 'e2e-wizard-test'（与单测 routes-employees.test.ts 同手法：opts.id 覆盖）。
 *
 * 鉴权注记：service 无 /api/state 端点 → 前端 session.fetchState() 归一 null → authenticated=false
 *   → 守卫会把非 '/' 路径重定向到 '/'。Playwright 用 page.route mock /api/state 返回 authenticated=true
 *   绕过守卫（仅 e2e 测试用，生产环境 /api/state 由后续批补）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'

const E2E = process.env.E2E === '1' || process.env.E2E === 'true'

const SERVICE_PORT = 19982
const WEB_PORT = 5177
const SERVICE_URL = `http://127.0.0.1:${SERVICE_PORT}`
// vite dev 在 Windows 上绑 localhost（解析到 [::1]），用 localhost 而非 127.0.0.1 探测/访问
const WEB_URL = `http://localhost:${WEB_PORT}`

const WORKBENCH_HOME = mkdtempSync(join(tmpdir(), 'wb-e2e-wizard-'))
const SERVICE_CWD = 'D:/Works/AI Coding/digital-employees/.worktrees/l1-create/workbench/workbench-service'
const WEB_CWD = 'D:/Works/AI Coding/digital-employees/.worktrees/l1-create/workbench/workbench-web'

let serviceProc: ChildProcess | null = null
let webProc: ChildProcess | null = null

/** 轮询 URL 直至 2xx/3xx 可达，超时抛错 */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 400) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`waitForHttp 超时：${url} 在 ${timeoutMs}ms 内不可达`)
}

test.beforeAll(async () => {
  if (!E2E) return
  // 写 config.json 指定 service 端口（默认 19980 已被用户在跑的实例占用）
  mkdirSync(WORKBENCH_HOME, { recursive: true })
  writeFileSync(
    join(WORKBENCH_HOME, 'config.json'),
    JSON.stringify({ network: { port: SERVICE_PORT } }),
    'utf8',
  )

  // 起 service（隔离 WORKBENCH_HOME，不开浏览器）
  serviceProc = spawn('bun', ['run', 'src/main.ts'], {
    cwd: SERVICE_CWD,
    env: {
      ...process.env,
      WORKBENCH_HOME,
      WORKBENCH_NO_BROWSER: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  // 调试：service stdout/stderr 落 tmp 文件便于排查启动失败
  const fs = await import('node:fs')
  const logFile = fs.createWriteStream(join(WORKBENCH_HOME, 'service.log'))
  serviceProc.stdout?.pipe(logFile)
  serviceProc.stderr?.pipe(logFile)
  serviceProc.on('error', (err) => {
    console.error('[e2e] service spawn error:', err)
  })
  serviceProc.on('exit', (code, signal) => {
    console.error(`[e2e] service exited: code=${code} signal=${signal}`)
  })

  // 等待 service 就绪（healthz 可达）
  await waitForHttp(`${SERVICE_URL}/healthz`, 20_000)

  // 起 web dev（VITE_PROXY_TARGET 指 service 端口）
  webProc = spawn('bun', ['run', 'dev', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: WEB_CWD,
    env: {
      ...process.env,
      VITE_PROXY_TARGET: SERVICE_URL,
    },
    stdio: 'pipe',
  })
  webProc.stdout?.on('data', () => { /* 静默 */ })
  webProc.stderr?.on('data', () => { /* 静默 */ })

  // 等待 vite dev server 就绪
  await waitForHttp(WEB_URL, 25_000)
})

test.afterAll(() => {
  if (serviceProc) {
    try { serviceProc.kill('SIGTERM') } catch { /* already dead */ }
    serviceProc = null
  }
  if (webProc) {
    try { webProc.kill('SIGTERM') } catch { /* already dead */ }
    webProc = null
  }
})

test.describe(E2E ? '向导 e2e 冒烟（E2E=1）' : '向导 e2e 冒烟（skip：未设 E2E=1）', () => {
  test.skip(!E2E, '未设 E2E=1，跳过（双进程重负担，本地手动跑：E2E=1 bunx playwright test）')

  test('/employees/new → dev-engineer → 改 id → 6×下一步 → 生成 → 完成态 → /employees 8卡', async ({ page }) => {
    // Mock /api/state 绕过鉴权守卫（service 无此端点 → 前端归一未认证 → 守卫重定向 '/'）
    await page.route('**/api/state', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          installationId: 'e2e-test',
          status: 'ACTIVE',
          authenticated: true,
          user: { name: 'E2E Test' },
        }),
      })
    })

    // 访问 /employees/new
    await page.goto(`${WEB_URL}/employees/new`)

    // 等待模板卡渲染（store.loadMeta 拉 /api/templates）
    await page.waitForSelector('.tpl-card', { timeout: 10_000 })

    // 选 dev-engineer 模板卡（按 display 文案「开发工程师」定位）
    await page.getByText('开发工程师', { exact: false }).first().click()

    // step 1 → 2
    await page.getByRole('button', { name: '下一步' }).click()

    // step 2：改 id 避冲突（seed 已物化 dev-engineer）+ 补 identity/usage_modes（schema 必填）
    //   注：selectTemplate 仅预填 display/id/avatar/kind/level/brief/skills，
    //   identity/usage_modes 留空（emptyDraft 默认值），生成时 schema 会拒（identity min 10、usage_modes min 1）。
    const idInput = page.locator('input[data-field="id"]').first()
    await idInput.fill('e2e-wizard-test')

    const identityInput = page.locator('textarea[data-field="identity"]').first()
    await identityInput.fill('e2e 测试员工：负责验证向导全链可跑通的冒烟 fixture')

    // 勾选「裸用」usage_mode（check-grid 内首项）
    await page.locator('.check-item', { hasText: '裸用' }).first().click()

    // step 2 → 3 → 4 → 5 → 6 → 7（5 次 下一步）
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: '下一步' }).click()
      // 等待步骤切换（store.next() 同步，但组件挂载需一帧）
      await page.waitForTimeout(150)
    }

    // 点「生成员工包」（step 7 底部按钮）
    await page.getByRole('button', { name: '生成员工包' }).click()

    // 断言完成态出现（CompletionPanel data-role="completion"）
    await expect(page.locator('[data-role="completion"]')).toBeVisible({ timeout: 10_000 })
    // 文件清单文本在位（至少含 manifest.yml）
    await expect(page.locator('[data-role="completion"]')).toContainText('manifest.yml')

    // 点「完成离开」跳 /employees
    await page.getByRole('button', { name: '完成离开' }).click()

    // 断言 /employees 上 8 张卡（7 预置 + 1 新建）
    await page.waitForSelector('.emp-card', { timeout: 10_000 })
    const cardCount = await page.locator('.emp-card').count()
    expect(cardCount).toBe(8)

    // 断言新建卡在位（id=e2e-wizard-test）
    await expect(page.locator('.emp-card', { hasText: 'e2e-wizard-test' })).toBeVisible()
  })
})
