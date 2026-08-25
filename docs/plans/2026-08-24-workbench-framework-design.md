# 工作台框架增量设计（服务骨架 + Web 壳 + 托盘壳）

> 日期：2026-08-24
> 状态：🟢 已定稿（用户授权自主决策：头脑风暴过程由 AI 自行决定，2026-08-24 用户指令）
> 输入：[服务本体详细设计](../design/详细设计/工作台服务本体详细设计-v0.1.md) · [托盘壳详细设计](../design/详细设计/托盘壳详细设计-v0.1.md) · [功能点清单](../design/概要设计/套件工作台V0.1功能点清单-2026-08-23.md) · Spike 矩阵（M0/S1/S2/S3 报告）· agents-team feat/demo-4stage-flow HUD 源码（业务填充参考）
> 产出物：本设计 → 实施计划（writing-plans）→ TDD 实现（subagent-driven）→ 验证（verification-before-completion）

---

## 1 增量定位

**把 spike 验证过的形态工程化为可用框架**：工作台服务骨架（单体二进制 + CLI + 契约文件 + 单实例 + 日志）+ 最小 Web 壳（Vue 骨架 + 占位页内嵌）+ 托盘壳全量（四态 + 菜单 + 自启）。三者端到端闭环：**托盘左键打开真页面、右键启停真服务、杀壳服务活**。

业务填充（E/F/B/A 系列）后续增量做，参考 1.0 HUD 的模式（datasource 文件→model、/model.json + /events SSE、client-render shell、坏数据降级铁律——见 agents-team `pyieidev/ieidev_hud/server.py` 的通道③设计）。

## 2 自主决策记录（原澄清问题 → 决策 + 依据）

| # | 问题 | 决策 | 依据 |
|---|------|------|------|
| D-1 | 本增量范围 | 服务骨架核心（S-01/02/04/06/07 简版/08/12/13 核心/14）+ Web 最小壳 + 托盘全量（TR-01~09）| 用户口径「先把框架搭起来：托盘程序和 web 服务」；路径 A（先骨架后托盘）已确认 |
| D-2 | 出栈项 | 守护注册 guard/（涉提权交互须用户终端在场，S2 发现）、更新检查 U 系列、存储 sqlite/版本门/孤儿回收/磁盘 GC、认证 A 系列、全部员工业务 E/F/B | 提权交互用户不在场无法验证；YAGNI——业务增量再进 |
| D-3 | monorepo 落位 | 仓根建 `workbench/`（workspace 根）：`workbench-service` + `workbench-web` + `workbench-tray`（Go module，pnpm/bun 不感知）；旧 auth demo 改名 `workbench-demo/` 保留（**2026-08-25 用户裁决改名**，原 D-3 为 `packages/` + 旧 demo 占 `workbench/` 名） | 白皮书 §10.3 仓库结构；platform/iam 留仓根（现实混居，不迁移） |
| D-4 | 品牌占位 | 品牌相关值**集中常量**：TS `src/brand.ts`、Go `internal/brand/brand.go`；占位值 npm scope `@workbench/*`、profile 目录 `~/.workbench/`、app 标识 `workbench`、VersionInfo CompanyName `Placeholder` | 品牌词待选（in 系候选）；集中常量使换牌成本 = 改两处文件 + sweep 文档 |
| D-5 | 包管理与运行时 | `pnpm` workspaces 管依赖；`bun` 仅作 build（--compile）与运行时 | 设计 §7.1 技术栈基线；M0 已证 bun build 可行 |
| D-6 | Web 壳深度 | Vite+Vue3+router+Pinia 骨架级：一个占位页（版本/健康状态/横幅），dev 代理 19980，build 产物以 `import ... with { type: "text" }` 嵌入单体 | M0 T5 已证嵌入形态（+2.2MB/1MB 资产）；「web 服务」名实相符但不做业务页面 |
| D-7 | TDD 边界 | 纯逻辑全 TDD（TS：config/契约文件/单实例判定/Host 白名单/route-registry/启动退出序列；Go：statemachine/probe/contract/autostart 判定）；交互层（菜单/图标/浏览器打开）走脚本化冒烟 | 用户要求 TDD；GUI 无头不可单测，冒烟复用 M0 验证手法 |
| D-8 | TR-07 优雅停服 | `workbench activity` 实现为硬值 `{conversationTasks:0, triggerTasks:0}` + 完整 CLI/HTTP 链路；托盘停止前调用链路成型（非零弹确认的分支 TDD 判定逻辑） | 无业务任务在飞；接口先通（S-02 设计口径） |
| D-9 | 图标资产 | 四态 .ico 由代码生成（BMP-in-ICO 构造器，M0 spike 已踩通），正式多尺寸资产后续替换 | 设计 TR-02 的正式资产要求留待视觉定稿；先保证机制 |

## 3 方案对比

| | 方案一（选定）：骨架+Web壳+托盘三件套 | 方案二：服务最小+托盘（无 Web 壳） | 方案三：服务全量（含 guard/存储/更新）再托盘 |
|--|--|--|--|
| 端到端演示 | ✅ 托盘打开真页面 | ⚠️ 只能看 healthz JSON | ✅ |
| 增量大小 | 中（~2-3 天 TDD） | 小 | 大（含无法当场验证的提权交互） |
| 返工风险 | 低（契约全冻结） | 中（Web 宿主能力后补联调） | 低 |
| 依据 | 闭环完整、可验证性最强 | — | guard/ 提权须用户在场（S2），出栈 |

## 4 选定方案设计

### 4.1 组件与目录

```
digital-employees/
├── workbench/            （workspace 根，2026-08-25 由 packages/ 改名）
│   ├── workbench-service/          TS + Hono（Bun 编译单体）
│   │   ├── src/
│   │   │   ├── brand.ts            品牌常量（D-4）
│   │   │   ├── cli/                命令解析与分发（S-02）
│   │   │   ├── server/             route-registry adapter（Hono 唯一出现点）+ 静态嵌入
│   │   │   ├── runtime/            启动序列状态机/单实例/优雅退出（S-13/S-06/S-14）
│   │   │   ├── config/             两层配置 + zod（S-07 简版）
│   │   │   ├── logging/            双日志 + 横幅 + 轮转（S-08 简版）
│   │   │   └── main.ts             组装
│   │   ├── test/                   vitest（契约文件/单实例判定/config/白名单/序列）
│   │   └── scripts/                build.ps1（bun compile）+ smoke.ps1
│   ├── workbench-web/              Vite + Vue3 骨架（D-6）
│   │   └── src/（占位页 + 路由 + healthz 状态展示）
│   └── workbench-tray/             Go module（设计 §2 结构）
│       ├── main.go
│       ├── internal/{statemachine,probe,contract,menu,actions,autostart,logging,brand}/
│       └── internal/*_test.go      go test（四态/端口发现链/service.json 解析/哨兵判定）
├── pnpm-workspace.yaml
└── package.json（根，workspace 脚本）
```

### 4.2 关键行为（验收口径）

**服务**：
1. `workbench start` -> 进程守护前台形态（本增量无守护注册，`--foreground` 语义即默认）-> `/healthz` 200 返回 C-4 全字段（app=brand.app、version、pid、uptime、dataDir）
2. 重复 `start` -> 幂等（探测到自家 uid+healthz -> 调 portal 开浏览器，退出 0）
3. 端口被第三方占 -> 退码 78 + 打印占用进程名
4. `stop` -> cleanStop=true + 关 HTTP + 删 run/ + 端口释放验证
5. kill -9 后重启 -> lifecycle.log 记「上次异常退出」
6. `status` JSON 全字段；`activity` 返回零值结构；`__health-wait` 供托盘用
7. Host 白名单：非 localhost Host 头 -> 403
8. `/` 返回嵌入的 Web 壳页面（显示版本 + 健康状态）
9. `/api/events` -> 204 占位（SSE 骨架，V0.2 激活）

**Web 壳**：build 产物嵌入单体；占位页轮询 /healthz 显示状态徽章 + 版本 + 「业务填充中」文案

**托盘**：
1. 四态流转（绿/黄/灰/红）实测语义同 M0 T4b（黄态 skip、红态双条件+单次拉起）
2. 左键 = `__health-wait 15s` 就绪后 ShellExecute 开浏览器
3. 右键菜单全项：状态项（端口跟随 config）/打开/复制地址/停止·启动·重启（互斥）/数据目录/日志/检查更新（占位气泡）/关于（双版本线）/退出（仅壳）
4. 杀壳 -> 服务活（W-2）；杀服务 -> 43s 内重复触发模型之外的托盘探活红态拉起（本增量无守护注册，托盘红态拉起是唯一自动恢复路径——**临时单点，guard/ 增量落地后恢复双层**，此临时态写进文档）
5. HKCU Run 自启 + 哨兵文件（用户关自启后不重开）
6. VersionInfo 四字段非空（CompanyName=Placeholder 待品牌）

### 4.3 数据流

```
托盘（Go） --GET /healthz 5s--> 服务（TS/Bun 单体）
       --读 run/service.json + config.json--> 端口发现链
       --exec workbench start/stop/activity--> CLI 面
浏览器 <---嵌入的 Vue 壳 + /healthz 轮询--- 服务
```

### 4.4 测试策略（TDD）

- **TS vitest**：brand 常量单一来源、config 两层解析（覆盖项/默认值/sample 一致性）、service.json/reliability.json 读写与崩溃检测、单实例三场景判定（纯函数：输入 service.json+healthz 结果 -> 幂等/78/接管）、Host 白名单、route-registry 注册面、启动序列步序、退出序列
- **Go test**：statemachine 状态转移表（含黄态 skip/红态双条件/恢复清零）、probe 的 healthz 判定与端口发现链（三级 fallback）、contract 的 service.json 解析、autostart 的哨兵判定（注册/跳过/用户关闭）
- **冒烟脚本**（scripts/smoke.ps1）：编译 -> start -> healthz -> 重复 start 幂等 -> stop 释放 -> kill-9 崩溃记录 -> 托盘配对四态 + W-2 —— 全自动断言

### 4.5 风险

| 风险 | 缓解 |
|------|------|
| pnpm+bun 混装依赖冲突 | 依赖一律 pnpm install；bun 只做 build（M0 形态） |
| Vue 产物 text import 的路径/构建时序 | web 先 build 产物落 service 的嵌入源目录，再 bun compile（脚本固化顺序） |
| Go systray 无头环境跑不了 GUI | 冒烟在用户桌面会话跑；纯逻辑全单测不依赖 GUI |
| 临时单点（无守护注册，托盘是唯一恢复路径） | 文档显式标注「guard/ 增量落地前的已知临时态」；guard/ 与提权交互排在用户在场时做 |
| 品牌占位漂移 | D-4 集中常量 + 设计文档记录 sweep 清单 |
