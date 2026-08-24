# 工作台框架（服务骨架 + Web 壳 + 托盘壳）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 spike 验证过的形态工程化为可用框架——workbench-service 单体骨架（healthz/CLI/契约文件/单实例/日志/优雅退出）+ 内嵌 Vue Web 壳 + workbench-tray 托盘全量，三者端到端闭环。

**Architecture:** TS/Hono 服务经框架无关 route-registry 组装（Bun `--compile` 单体，前端产物 text-import 嵌入）；Go/fyne-systray 托盘只经契约（HTTP /healthz + run/service.json + CLI 子命令）遥控服务；全部路径经依赖注入可测试。设计依据：[框架增量设计](2026-08-24-workbench-framework-design.md) + [服务本体详细设计](../design/详细设计/工作台服务本体详细设计-v0.1.md) + [托盘壳详细设计](../design/详细设计/托盘壳详细设计-v0.1.md)。

**Tech Stack:** Bun 1.3.9（workspace + build + 运行时）· TypeScript strict · Hono · zod · commander · vitest · Vue3+Vite（vite-plugin-singlefile 单文件产物）· Go 1.26 + fyne.io/systray + golang.org/x/sys/registry

**环境事实（勿重新调研）:** Bun/Node/Go 已装；Go 需要 `go env -w GOPROXY=https://goproxy.cn,direct`；npm registry 可达；Windows git-bash 执行命令；**不用 pnpm**（未验证安装）——用 Bun workspaces（package.json `workspaces` 字段，与 pnpm 同格式，零锁定）；品牌词未定 → 全部品牌值集中占位（Task 2 的 brand.ts / Task 13 的 brand.go），换牌只改两文件。

**目录总览（最终态）:**

```
packages/workbench-service/   src/{brand,cli,server,runtime,config,logging}/ main.ts  test/  scripts/{build.sh,smoke.sh}
packages/workbench-web/       src/{App.vue,main.ts,router/,views/,components/}  vite.config.ts
packages/workbench-tray/      main.go  internal/{brand,statemachine,probe,contract,actions,menu,autostart,icons,logging}/
pnpm-workspace 无需（用根 package.json workspaces）
```

**TDD 铁律:** 每个 Task 先写失败测试 -> 跑红 -> 最小实现 -> 跑绿 -> commit。所有测试用例已给出断言要点；实现代码骨架已给出核心逻辑，允许按仓库风格微调但**不得改契约**（schema/函数签名/JSON 形状）。

---

### Task 1: Monorepo 脚手架 + 首个测试跑通

**Files:** Create: `package.json`（根）、`packages/workbench-service/package.json`、`packages/workbench-service/tsconfig.json`、`packages/workbench-service/vitest.config.ts`、`packages/workbench-service/test/smoke.test.ts`、`.gitignore` 追加

**Step 1:** 根 `package.json`：
```json
{ "name": "digital-employees", "private": true, "workspaces": ["packages/*"] }
```

**Step 2:** `packages/workbench-service/package.json`：
```json
{ "name": "@workbench/service", "version": "0.1.0", "private": true, "type": "module",
  "scripts": { "test": "vitest run", "build": "bash scripts/build.sh" },
  "dependencies": { "hono": "^4", "zod": "^3", "commander": "^12" },
  "devDependencies": { "typescript": "^5", "vitest": "^2", "@types/bun": "latest" } }
```

**Step 3:** `tsconfig.json`（strict + bundler resolution）；`vitest.config.ts`（`test: { include: ['test/**/*.test.ts'] }`）。

**Step 4:** `test/smoke.test.ts`：`import { describe, it, expect } from 'vitest'; describe('workspace', () => { it('vitest 就绪', () => expect(1).toBe(1)) })`

**Step 5:** `cd packages/workbench-service && bun install`（根 workspaces 生效）→ `bun run test` → 预期 1 passed。

**Step 6:** `.gitignore` 追加 `node_modules/`、`dist/`、`*.exe`、`web-dist/`。Commit: `chore: monorepo 脚手架（bun workspaces + service 包 + vitest）`

### Task 2: brand 常量 + config 两层（S-07 简版）

**Files:** Create: `src/brand.ts`、`src/config/schema.ts`、`src/config/load.ts`、`test/config.test.ts`

**Step 1 失败测试** `test/config.test.ts` 断言：
- `brand.app === 'workbench'`、`brand.defaultPort === 19980`、`brand.profileName` 非空
- `loadConfig(dir)`：目录无文件 → 全默认（port 19980 / host 127.0.0.1）；只写 `{"network":{"port":1234}}` → port 1234 且其余默认；非法字段（port: "abc"）→ 抛 ZodError；未知键 → 抛错（strict）
- `writeSample(dir)` 生成 `config.sample.json`（含 `_comment`），再 `loadConfig` 读 sample 文件本身 → 校验通过

**Step 2 实现**：
```ts
// src/brand.ts —— 品牌唯一来源（换牌只改此文件）
export const brand = {
  app: 'workbench',            // service.json/healthz 的 app 标识
  displayName: '数字员工工作台',
  version: '0.1.0',
  defaultPort: 19980,
  profileName: '.workbench',   // 用户目录下的 profile 目录名（品牌定后换）
  homepagePath: '/',
} as const
```
```ts
// src/config/schema.ts
import { z } from 'zod'
export const configSchema = z.object({
  network: z.object({ port: z.number().int().min(1).max(65535) }).strict().default({}),
}).strict()
export type WorkbenchConfig = z.infer<typeof configSchema>
export const defaultConfig: WorkbenchConfig = { network: { port: 19980 } }
```
`load.ts`：`loadConfig(profileDir)` 读 `<dir>/config.json`（不存在→default；存在→JSON.parse→schema.parse）；`writeSample(profileDir)` 写 `{ "_comment": "...", ...defaultConfig }`。所有模块**只 import brand/config，不得硬编码端口与目录名**。

**Step 3-5:** 跑红→实现→跑绿→Commit `feat: brand 常量 + config 两层（zod strict + sample）`

### Task 3: 契约文件（S-04）

**Files:** Create: `src/runtime/contracts.ts`、`test/contracts.test.ts`

**Step 1 失败测试** 断言：
- `writeServiceHandle(runDir, {pid:123, port:19980, ...})` 写 `run/service.json`（schemaVersion 1 / app='workbench' / uid 稳定 / instanceId UUID / startedAt ISO）+ 单值兼容层 `service.pid`（内容 "123\n"）与 `service.port`
- `readServiceHandle(runDir)` 往返一致；文件不存在 → null
- `writeReliability(runDir, {runId, cleanStop:false})` / `readReliability` 往返；`markCleanStop(runDir)` 置 true
- `readReliability` 返回 cleanStop:false → `detectCrash()` 为 true（上次异常退出）

**Step 2 实现核心**（接口与字段名**严格对齐**设计 §6：`schemaVersion/app/pid/port/host/version/buildCommitId/uid/instanceId/startedAt`；reliability：`schemaVersion/runId/startedAt/cleanStop`）。uid 从 `<profile>/installation-id` 文件读（无则生成 UUID 写入，稳定）；写入一律「临时文件+rename」原子写。

**Step 3-5:** 红→绿→Commit `feat: run/ 契约文件（service.json + reliability.json + 单值兼容层）`

### Task 4: 单实例判定纯函数（S-06）

**Files:** Create: `src/runtime/instance.ts`、`test/instance.test.ts`

**Step 1 失败测试** 断言 `decideInstanceAction(handle, health)`：
| 输入 | 输出 kind |
|------|----------|
| handle=null | `fresh`（起服务） |
| handle.healthOk=true && handle.app 匹配 && uid===自家 uid | `idempotent`（开浏览器退出 0） |
| handle.healthOk=true 但 app/uid 不符 | `conflict`（78 + 占用方信息） |
| handle 存在、pid 活、healthOk=false、连续失败≥3 且超 30s 预算 | `takeover`（清 run/ 接管） |
| handle 存在、pid 活、healthOk=false、未达双条件 | `starting`（别人正在启动，静默退出） |

health 参数形状 `{reachable, app?, status?, elapsedMs, consecutiveFails}`（由调用方探测后传入——**纯函数不做 IO**）。

**Step 2 实现**：上述五分支纯函数 + `describeAction` 文案函数（含 78 场景的占用进程名拼接）。

**Step 3-5:** 红→绿→Commit `feat: 单实例五分支判定（幂等/冲突/接管/启动中/新建）`

### Task 5: route-registry + Host 白名单 + 端点（healthz/events 占位/activity）

**Files:** Create: `src/server/registry.ts`、`src/server/hono-adapter.ts`、`src/server/guard.ts`、`src/server/endpoints.ts`、`test/server.test.ts`

**Step 1 失败测试** 断言：
- `createRegistry()` 注册 `GET /healthz` 后经 `toHonoApp(registry)` 用 `app.request('/healthz')` 得 200 JSON `{app:'workbench',status:'ok',version,pid,uptime,dataDir}`（dataDir 为 profile 路径字符串）
- Host 白名单：`app.request('/', {headers:{Host:'evil.com'}})` → 403；`Host:'localhost:19980'` 与 `'127.0.0.1:19980'` → 放行
- `GET /api/events` → 204；`GET /api/activity` → `{conversationTasks:0, triggerTasks:0}`（硬值，D-8）
- registry 上注册未声明路由 → 类型层不可（ts strict）；Hono 符号**只出现在 hono-adapter.ts**（grep 断言：`grep -L "from 'hono'" src/server/registry.ts src/server/endpoints.ts` 无输出——即这两个文件不 import hono）

**Step 2 实现核心**：
```ts
// registry.ts —— 框架无关（不得 import hono）
export interface Ctx { method: 'GET'|'POST'; path: string; host: string; body?: unknown }
export interface Res { status: number; json?: unknown; text?: string }
export type Handler = (ctx: Ctx) => Res | Promise<Res>
export interface RouteRegistry { get(p: string, h: Handler): void; post(p: string, h: Handler): void }
export function createRegistry(): { routes: {method,path,handler}[]; get; post }
```
`hono-adapter.ts`：把 routes 挂到 Hono（唯一 hono import 点）；`guard.ts`：`isLocalHost(host)`（允许 localhost/127.0.0.1 带/不带端口）。`endpoints.ts`：healthz/activity/events 三个 handler（注入 `{version, pid, dataDir, uptime}` 依赖）。

**Step 3-5:** 红→绿→Commit `feat: route-registry（框架无关）+ Host 白名单 + 三个端点`

### Task 6: 日志双轨 + 横幅（S-08 简版）

**Files:** Create: `src/logging/logger.ts`、`test/logging.test.ts`

**Step 1 失败测试** 断言：
- `createLogger(logsDir)` 写 workbench.log（`{ts,event,...}` JSONL）与 lifecycle.log 分离；lifecycle 只收 `lifecycle()` 调用的事件
- `banner(info)` 在 lifecycle.log 落一行含 version/buildCommitId/runtime/os/port/instanceId 的 `started` 事件
- 轮转：写超过 `maxBytes`（测试注入 200 字节）→ 文件 rename 为 `.1`，新文件继续写
- 全部写入 UTF-8 无 BOM

**Step 2 实现**：追加式 writer + size 轮转（rename .1，只保留 1 份——简版）；`createLogger` 返回 `{log(event,payload), lifecycle(event,payload), banner(info), close()}`。

**Step 3-5:** 红→绿→Commit `feat: 双轨日志 + 启动横幅 + 大小轮转`

### Task 7: 启动序列 + 优雅退出编排（S-13/S-14）

**Files:** Create: `src/runtime/lifecycle.ts`、`test/lifecycle.test.ts`

**Step 1 失败测试**（伪依赖注入，断言调用序与产物）：
- `runStartup(deps)` 依次调用：loadConfig → readReliability(crash 检测并 lifecycle 记 `crash_detected`) → decideInstanceAction（idempotent→deps.openBrowser 且不 startServer；conflict→抛 ExitError(78)；fresh/takeover→清 run 后 startServer）→ writeServiceHandle+writeReliability → banner → 首启哨兵：`sentinels/first-run-browser-opened` 不存在→openBrowser+写哨兵，存在→跳过
- `runShutdown(deps)` 依次：markCleanStop → serverStop → 删 run/ 契约文件 → `verifyPortReleased`（注入的探测返回 false 时抛错）
- deps 全部可替换（记录调用数组断言顺序）

**Step 2 实现**：编排函数（不直接 IO，全经 deps）；`ExitError` 带 code 字段（78）。healthz 就绪判据：deps.startServer 返回的 promise resolve 后再注入 probe 一次（简版：startServer 内部等 listen 回调）。

**Step 3-5:** 红→绿→Commit `feat: 启动/退出序列编排（依赖注入可测）`

### Task 8: CLI 面 + main 组装（S-02）

**Files:** Create: `src/cli/index.ts`、`src/main.ts`、`test/cli.test.ts`

**Step 1 失败测试** 断言（commander 程序对象可注入执行）：
- `buildProgram(deps)` 解析：`start`（默认）/ `start --foreground` / `start --no-keepalive` / `stop` / `status` / `portal` / `activity` / `__daemon` / `__health-wait [ms]`（隐藏命令不在 help 输出）
- `start` 分支调用 deps.runStartup；`stop` 调用 deps.runShutdown；`status` 调用 deps.status 输出 JSON `{pid,port,version,uptime,health,pendingUpdate:null}`
- `__health-wait 15000` 轮询 deps.probeHealthz 直至 ok 或超时（测试注入立即 ok / 永远 fail 两种）

**Step 2 实现**：commander 程序 + deps 接口（组合 Task 2-7 的真实实现于 `main.ts`：profile 目录解析 `~/.workbench`（env `WORKBENCH_HOME` 可覆盖——**测试与冒烟用**）、logs/run 目录创建、Bun.serve 实例化挂 hono adapter）。main.ts 分发：无子命令或 `__daemon` → daemon 路径。

**Step 3-5:** 红→绿→Commit `feat: CLI 面 + main 组装（start/stop/status/portal/activity/__daemon/__health-wait）`

### Task 9: 服务冒烟（bun 直跑，未编译）

**Files:** Create: `packages/workbench-service/scripts/smoke.sh`

**Step 1** 冒烟脚本（git-bash）顺序断言，任一步失败 set -e 退出：
1. `WORKBENCH_HOME=$(mktemp -d) bun run src/main.ts start &` → sleep 2 → `curl -s localhost:19980/healthz` 含 `"app":"workbench"`
2. 重复 `start`（同 HOME）→ 退出码 0 且进程数仍 1（幂等）
3. `curl -H 'Host: evil.com' localhost:19980/healthz` → 403
4. `bun run src/main.ts status` 输出 JSON 含 port
5. `stop` → healthz 拒连 + `run/service.json` 不存在 + reliability cleanStop=true
6. 重启后 `lifecycle.log` 无 crash；kill -9 后再启 → lifecycle.log 含 `crash_detected`
7. 端口占用：起 `python -m http.server 19980`（或 busybox）后再 `start` → 退出码 78

**Step 2:** 跑通脚本（记录输出到 `smoke.log`）。**Step 3:** Commit `test: 服务冒烟脚本（幂等/白名单/停止/崩溃/78 七场景）`

### Task 10: Web 壳（Vue 骨架 + 占位页）

**Files:** Create: `packages/workbench-web/{package.json,vite.config.ts,index.html,src/main.ts,src/App.vue,src/views/Home.vue,src/router/index.ts,src/api/health.ts}`、`packages/workbench-web/test/health.test.ts`

**Step 1** `package.json`：vue@3 / vue-router@4 / pinia@2 / vite@5 / @vitejs/plugin-vue / vite-plugin-singlefile / vitest；scripts：`dev`（代理 127.0.0.1:19980）、`build`（singlefile 输出**单个** `dist/index.html`）、`test`。

**Step 2 失败测试**（vitest，无 DOM 依赖的纯逻辑）：`health.ts` 的 `interpretHealth(json)` → `{ok:true,badge:'运行中'}` / `{ok:false,badge:'不可用'}`；`versionLine(health)` → `v${version} · 端口 ${port}`。

**Step 3 实现**：`Home.vue` 占位页——标题（brand.displayName 文案写死「数字员工工作台」）+ 健康徽章（2s 轮询 `/healthz`，失败显示「服务不可用」红徽章）+ 版本行 + 一句「业务填充中（V0.1 框架增量）」；路由仅 `/`。

**Step 4:** `bun install && bun run build` → dist/index.html 单文件（断言无 `<script src=`）。**Step 5:** Commit `feat: web 壳（Vue 骨架 + 健康占位页，singlefile 构建）`

### Task 11: 嵌入 + 单体编译 + 全量冒烟

**Files:** Modify: `packages/workbench-service/src/server/endpoints.ts`、Create: `packages/workbench-service/web-dist/`（构建产物，**提交进仓**——S-01 嵌入需要）、`packages/workbench-service/scripts/build.sh`、Modify: `scripts/smoke.sh`

**Step 1** build.sh：`cd ../workbench-web && bun run build` → 拷 `dist/index.html` 到 service 的 `web-dist/index.html` → `bun build --compile src/main.ts --outfile dist/workbench.exe`。
**Step 2** endpoints.ts 增 `GET /`：`import indexHtml from "../../web-dist/index.html" with { type: "text" }` 返回 HTML（测试：toHonoApp 后 `app.request('/')` 200 且含「数字员工工作台」）。
**Step 3** smoke.sh 增：`./dist/workbench.exe start` 全链（在**未装 Bun 的语义**下由 exe 独立完成 healthz/幂等/stop；再跑 `curl /` 返回 HTML）。
**Step 4** 跑 build + smoke 全绿。**Step 5:** Commit `feat: 前端嵌入 + 单体编译 + 全量冒烟（框架服务侧完成）`

### Task 12: Go module + statemachine（TR-02/05）

**Files:** Create: `packages/workbench-tray/{go.mod,internal/brand/brand.go,internal/statemachine/statemachine.go,internal/statemachine/statemachine_test.go}`

**Step 1 失败测试** `statemachine_test.go` 表驱动断言 `Next(state, event)`：
- `GREEN + probeFail` → YELLOW；`YELLOW + probeFail`(fails<3 或 elapsed<30s) → YELLOW（**skip 不重启**）
- `YELLOW + probeFail`(fails>=3 && elapsed>=30s) → RED
- `YELLOW + probeOk` → GREEN（fails 清零）；`RED + probeOk` → GREEN
- `RED` 进入时输出 `ShouldRecover=true`（恰好一次：`RED + probeFail` 保持 RED 但 ShouldRecover=false）
- `GRAY`（用户主动停止）+ probeFail → GRAY（不自动恢复）；`GRAY + probeOk` → GREEN
- 初始态 `starting`（探活前）+ probeOk → GREEN；+ probeFail → YELLOW

**Step 2 实现**：`type State uint8`（Starting/Green/Yellow/Gray/Red）+ `Event`（ProbeOk/ProbeFail{}带 fails/elapsedMs/UserStop/UserStart）+ `Transition{State, ShouldRecover}` 纯函数。brand.go：`const AppName = "workbench"; DisplayName = "数字员工工作台"; DefaultPort = 19980; RunKeyName = "WorkbenchTray"; CompanyName = "Placeholder"`。

**Step 3-5:** `go test ./...` 红→绿→Commit `feat(tray): 四态状态机纯逻辑（黄态 skip/红态双条件单次恢复）`

### Task 13: probe + contract（TR-04/05）

**Files:** Create: `internal/probe/probe.go`、`internal/probe/probe_test.go`、`internal/contract/contract.go`、`internal/contract/contract_test.go`

**Step 1 失败测试**：
- probe：注入 fake http client——`/healthz` 200 且 `{"app":"workbench"}` → `{Ok:true, Own:true}`；200 但 app 不符 → `{Ok:false, Own:true}`（冲突态）；连接失败 → `{Ok:false, Own:false}`
- 端口发现链 `DiscoverPort(profileDir)`：`run/service.json` 有 port → 用之；无 → `<dir>/config.json` 的 `network.port`；再无 → 19980（三层，tmpdir 造文件驱动）
- contract：`ParseServiceHandle(json)` 解析 TS 侧 schemaVersion 1 全字段；坏 JSON → error 不 panic

**Step 2 实现**：probe 用 `net/http` + 2s 超时；contract 用 `encoding/json` 直映 struct。

**Step 3-5:** 红→绿→Commit `feat(tray): health 探测（含端口发现链）+ service.json 契约解析`

### Task 14: actions + menu（TR-03）

**Files:** Create: `internal/actions/actions.go`、`internal/actions/actions_test.go`、`internal/menu/menu.go`、`internal/menu/menu_test.go`

**Step 1 失败测试**：
- actions：`BuildCliArgs(action)` 纯函数——`Stop`→`["stop"]`、`Start`→`["start"]`、`Restart`→`["stop","start"]`、`HealthWait(15000)`→`["__health-wait","15000"]`；`OpenBrowserURL(port)` → `http://127.0.0.1:<port>`；`DataDirPath(profile)`/`LogsDirPath(profile)` 路径拼接
- menu：`MenuModelFor(state, port, hasPendingUpdate)` 纯函数——GREEN 时 stop/restart 可见、start 隐藏；GRAY 反之；YELLOW 全禁用（防抖）；RED 显示重启+查看日志；状态项文本 `运行中 · 127.0.0.1:<port>`；pending 项仅在 hasPendingUpdate 时出现

**Step 2 实现**：纯函数 + 薄执行层（exec.Command(exe, args...)、explorer 打开目录——执行层不单测，冒烟覆盖）。

**Step 3-5:** 红→绿→Commit `feat(tray): CLI 动作构造 + 菜单状态模型（纯函数）`

### Task 15: autostart + ICO 生成器（TR-06/TR-02 资产）

**Files:** Create: `internal/autostart/autostart.go`、`internal/autostart/autostart_test.go`、`internal/icons/icons.go`、`internal/icons/icons_test.go`

**Step 1 失败测试**：
- autostart 判定纯函数 `ShouldRegister(sentinelExists, userSetting)`：sentinel 无+setting true→注册；sentinel 有+setting false→**跳过**（用户关过，升级不重开）；sentinel 有+setting true→幂等注册；`SentinelPath(profile)` 拼接
- icons：`IcoBytes(rgb)` 生成的字节——偏移 0-5 为 `{0,0,1,0,1,0}`（ICONDIR）、第 6 字节=16（宽）、BITMAPINFOHEADER biSize=40、biHeight=32（翻倍）、总长=22+40+1024+32

**Step 2 实现**：sentinel 判定纯逻辑 + 注册执行层（`golang.org/x/sys/registry` 写 HKCU Run，冒烟验证）；ICO 构造器移植 M0 spike 的 makeIco（含 24 字节尾部补零修正）。

**Step 3-5:** 红→绿→Commit `feat(tray): 自启哨兵判定 + 四态 ICO 生成器`

### Task 16: 托盘组装 + 配真服务冒烟（TR-01/03/04/07/08/09）

**Files:** Create: `packages/workbench-tray/main.go`、`internal/logging/traylog.go`、`packages/workbench-tray/versioninfo/versioninfo.json`、`scripts/tray-smoke.sh`；Modify: 根 `.gitignore`

**Step 1** main.go 组装（沿 M0 spike main.go 骨架，换用 internal/* 纯模块）：5s 探活循环 → statemachine → SetIcon 四态 + 菜单联动 + RED 时 `exec workbench start`（ShouldRecover 单次）+ 左键 `__health-wait 15s` 后 `rundll32 url.dll,FileProtocolHandler <url>` 开浏览器 + 退出项仅退壳；traylog 落 `<profile>/logs/tray.log`（JSONL，与 M0 同构）。
**Step 2** versioninfo.json：四字段非空（CompanyName=Placeholder、ProductName=数字员工工作台、FileVersion=0.1.0）；`go build -ldflags "-H windowsgui -s -w" -o dist/workbench-tray.exe`（CI 校验四字段留 guard 脚本注释）。
**Step 3 冒烟脚本**（配 Task 11 的真 exe）断言：
1. 起 service + tray → tray.log 出现 GREEN probe
2. `taskkill /F workbench.exe` → tray.log YELLOW×3 → RED + `recover` → GREEN
3. 再杀 service 后杀 tray → service 由 tray 死前拉起的那次仍在跑（W-2：杀 tray 时 service 活）——修正断言：**杀 tray → curl healthz 仍 200**
4. 托盘体积 < 8MB（D-026 放宽后）
**Step 4:** 跑通冒烟（记录 tray.log 到 `docs/` 外的临时档，结论写 commit message）。**Step 5:** Commit `feat(tray): 组装 + 配真服务冒烟（四态/自愈/W-2/体量）`

### Task 17: verification-before-completion 收尾

**REQUIRED SUB-SKILL:** superpowers:verification-before-completion。清单：
1. `cd packages/workbench-service && bun run test` 全绿；`go test ./...`（tray）全绿
2. 两份冒烟脚本全绿（服务七场景 + 托盘四态/W-2/体量）
3. 交叉核对设计：healthz 字段=C-4、CLI 面=S-02 表、service.json 字段=设计 §6、状态机=托盘设计 §3（逐项 grep/读码核对，差异记录）
4. grep 断言架构纪律：`hono` 只在 hono-adapter.ts；`bun:` 只在 runtime/logging 允许目录；品牌值只出现在 brand.ts/brand.go
5. 更新功能点清单变更记录（框架增量落地）+ 提交

---

## 执行注意（给 executing subagent）

- 命令一律 git-bash 语法；`taskkill //F //IM xxx.exe`（双斜杠）；路径含空格用引号
- 测试隔离：所有 profile 路径来自 `WORKBENCH_HOME` env 或注入的 tmpdir，**绝不写真实 `~/.workbench`**（冒烟脚本必须用 mktemp -d）
- 每个 Task 结束 commit（消息前缀按 Task 给定）；失败时先修测试再前进，禁止跳步
- Windows 下 vitest/go test 都直接可跑（无需 WSL）
