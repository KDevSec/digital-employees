# MCP server（Bun/hono）可行性 Spike 报告

> 实测日期：2026-08-25（跨午夜，落档 2026-08-26）
> 环境：Windows 11 Home China（10.0.26200）· bun 1.3.9 · @modelcontextprotocol/sdk 1.30.0 · @hono/mcp 0.3.2 · hono ^4 · **codebuddy 2.138.0** · **qodercli 1.1.29**（较 D-034 基线 2.137.1 / 1.1.26 均有小版本升级）
> 任务：路线图 §6 头号技术风险「**MCP server（Bun/hono）技术未验证**」前拉消险（原排 I1/L3 线内 spike ≤ 0.5 天）。Spike 四问：① Bun 能否用 MCP SDK 起最小 server（stdio / HTTP 双形态）② CodeBuddy / Qoder 真机能否列工具/调工具/拿返回 ③ server 未启动时底座行为 ④ 引擎 MCP 接入形态建议。
> 任务来源：[需求路线图 v0.1](../plans/2026-08-25-requirements-roadmap.md) §3.2（D-037 模式一）+ §6 风险表；协同编排设计会话（I0-2）的直接输入。
> 代码：仓库根 `spike/`（[README](../../spike/README.md)）；基线 = workbench-service 101 + workbench-web 11 测试全绿（开工前验证）。
> **总结论：四问全部拿到实证答案，头号技术风险解除**——Bun 双形态起 server 全绿、两底座真机双形态列/调/拿返回全通、失败模式不阻塞会话；**无**「HTTP 形态不可行」或「CB 连不通」类重大发现。附带两条对设计有直接价值的新实证（Qoder 全局挂载生效面 / 底座 MCP 工具权限门）。

---

## 1 结论总表（Spike 四问）

| # | 问题 | 判定 | 关键证据 |
|---|------|------|---------|
| Q1a | Bun + @modelcontextprotocol/sdk 起 **stdio** server | ✅ | SDK client 自测：initialize → listTools(3) → callTool ×3 全 PASS（Bun 直跑 TS，无编译） |
| Q1b | **HTTP streamable** 形态挂 **hono 路由** | ✅ | `@hono/mcp` 挂 `/mcp` + `Bun.serve({ fetch: app.fetch })`——与 workbench-service [main.ts:193](../../workbench/workbench-service/src/main.ts) **完全同构**；自测 5/5 PASS |
| Q2a | CodeBuddy CLI 真机（列/调/拿返回） | ✅ | `mcp list` 双形态 ✓ Connected；`-p` 模式模型调工具拿返回 ×4（echo 双形态 + advance + record_gate 结构化参数，混合两 server 调用） |
| Q2b | Qoder CLI 真机（双位置） | ✅ 附带修正发现 | 项目 `.mcp.json`：双形态 Connected + 调用通；全局：`mcp add -s user` 后双形态 Connected + 调用通。**但手写 `~/.qoder/mcp.json` 不生效**（CLI 实际消费 `~/.qoder/settings.json` 的 `mcpServers` 键，见 §2.4） |
| Q3 | 失败模式（server 未启动） | ✅ 不阻塞、明确报错 | 死端口/坏命令/坏脚本：CB `✗ Failed to connect`、qodercli `✗ Disconnected`；**会话不阻塞**（普通问答正常）；server 中途死 → 新会话工具不注册（§3.3） |
| Q4 | 形态建议 | **HTTP streamable 主路** | 依据与降级路径见 §4 |

---

## 2 证据（Q1/Q2 逐项）

### 2.1 Q1 SDK client 自测（不依赖底座，先证 server 本身）

`bun src/smoke-client.ts` 输出（10 项断言全绿）：

```
=== Q1a stdio 形态（McpServer + StdioServerTransport，Bun 直跑 TS） ===
  [PASS] stdio: listTools 返回 3 个工具 — spike_echo, spike_advance, spike_record_gate
  [PASS] stdio: callTool spike_echo 往返 — [stdio] echo: hello-from-smoke
  [PASS] stdio: callTool spike_advance 受理 — {"ok":true,"seq":1,"mode":"stdio","run_id":"run-1","node_id":"n-dev","result":"done"}
  [PASS] stdio: callTool spike_record_gate 受理 — {"ok":true,"seq":2,...,"gate":"sec-review","verdict":"pass"}
=== Q1b http 形态（hono 挂 /mcp + Bun.serve + @hono/mcp） ===
  [PASS] http: server 起活（healthz 200）
  [PASS] http: listTools 返回 3 个工具 — …同上
  [PASS] http: callTool spike_echo 往返 — [http] echo: hello-from-smoke
  [PASS] http: callTool spike_advance 受理 — {"ok":true,"seq":1,"mode":"http",...}
  [PASS] http: callTool spike_record_gate 受理 — {"ok":true,"seq":2,...}
ALL PASS
```

要点：`@hono/mcp` 的 `StreamableHTTPTransport.handleRequest(c)` 直接吃 hono Context 返回 Web 标准 `Response`——**零 node:http 依赖**，`Bun.serve + app.fetch` 原生兼容。spike 代码 [spike/src/http-server.ts](../../spike/src/http-server.ts) 全文 30 行。

### 2.2 Q2a CodeBuddy 真机（临时工作区 `%TEMP%/cb-spike-ws`，local scope 注册，测毕已清）

连接发现（`codebuddy mcp list`）：

```
spike-stdio: bun D:/…/spike/src/stdio-server.ts - ✓ Connected
spike-http: http://127.0.0.1:29980/mcp (HTTP) - ✓ Connected
```

模型真调工具（`codebuddy -p -y`，非交互模式）：

| 提示 | 底座→模型→工具→返回（原文） |
|------|------------------------------|
| 调 `spike_echo(message='from-codebuddy')` | `[stdio] echo: from-codebuddy` |
| 调 `mcp__spike-http__spike_echo(message='cb-via-http')` | `[http] echo: cb-via-http` |
| 调 advance + record_gate（结构化参数，跨两 server 混合） | `{"ok":true,"seq":1,"mode":"http","run_id":"run-cb-1","node_id":"n1-impl","result":"done"}` + `{"ok":true,"seq":1,"mode":"stdio","run_id":"run-cb-1","gate":"sec-review","verdict":"pass"}` |

- `mcp__<server>__<tool>` 前缀命名（CC 生态同构）→ 同名工具跨 server 可区分，模型可指定。
- MCP 工具调用经底座权限门：非交互模式需 `-y` / `--permission-mode bypassPermissions` 放行（详见 §3.4）。
- 环境注记（非 MCP 结论）：本机 CB 模型端（copilot.tencent.com）直连报 self-signed 证书错，需 `HTTPS_PROXY=http://127.0.0.1:7897` + `NODE_OPTIONS="--use-system-ca"` 组合才通——机器代理环境影响，与 MCP 通道无关。

### 2.3 Q2b Qoder 真机（临时工作区 `%TEMP%/qoder-spike-ws`，全局测毕已恢复原状）

项目级 `.mcp.json`（双形态，无需批准直接生效）：

```
✓ spike-stdio: bun D:/…/spike/src/stdio-server.ts (stdio) - Connected
✓ spike-http: http://127.0.0.1:29980/mcp (http) - Connected
```

模型真调工具（`qodercli -m Lite -p --dangerously-skip-permissions`）：

| 提示 | 返回（原文） |
|------|--------------|
| 调 `spike_echo(message='from-qoder')` | `[http] echo: from-qoder` |
| 调 `mcp__spike-stdio__spike_advance(run_id='run-qoder-1',node_id='n2-review',result='done')` | `{"ok":true,"seq":1,"mode":"stdio","run_id":"run-qoder-1","node_id":"n2-review","result":"done"}` |

全局挂载（D-034 位置二）：`qodercli mcp add -s user` 注册后，无项目 `.mcp.json` 的空工作区 `mcp list` 双形态 ✓ Connected；`-p` 调用 `mcp__spike-global-stdio__spike_advance` 与 `mcp__spike-global-http__spike_echo` 均拿到正确返回。全局/项目并存时 `mcp list` 四条全 Connected。

### 2.4 附带发现一（对 D-034 的细化）：qodercli 全局挂载的生效面是 settings.json，不是 mcp.json

对照实验（同一文件内容，两种写入方式）：

| 操作 | `~/.qoder/mcp.json` | `~/.qoder/settings.json` | `qodercli mcp list` |
|------|---------------------|--------------------------|---------------------|
| 手写 mcp.json（内容与 add 产物逐字节一致） | ✅ 有 server 定义 | 无 `mcpServers` 键 | **"No MCP servers configured."（不生效）** |
| `qodercli mcp add -s user`（自动写入） | ✅ 同样内容 | ✅ 新增 `mcpServers` 键 | ✓ Connected ×2（生效） |

- `add -s user` **双写**两文件；`mcp remove -s user` 只清 settings.json 侧，**mcp.json 残留不清理**（又一处不同步）。
- 结论：**qodercli 消费的是 `~/.qoder/settings.json` 的 `mcpServers` 键**；`~/.qoder/mcp.json` 是 add 顺带维护的另一份（疑为 Qoder IDE 消费面，本次未测 IDE 侧）。D-034 的「MCP = 全局 ~/.qoder/mcp.json」表述在 **CLI 侧需按此修正/细化**——L2 安装器对 Qoder 全局挂载必须写 settings.json（或调 CLI add），仅写 mcp.json 不生效。
- 全局配置已恢复原状并验证：mcp.json 还原为空配置备份内容、settings.json `mcpServers` 键清空、`mcp list` 报 "No MCP servers configured."；备份文件已删。恢复操作全程用 `mcp remove` 对称命令 + 文件备份还原。

### 2.5 环境差异记录（两底座模型端）

| 底座 | 模型端状态 | 备注 |
|------|-----------|------|
| codebuddy 2.138.0 | 直连 502（self-signed 证书错）→ 走 7897 代理 + `--use-system-ca` 通 | 机器代理环境影响；MCP 通道本身不受影响 |
| qodercli 1.1.29 | 默认模型额度耗尽（账号订阅限制）→ `-m Lite` 可用 | 账号层限制；工具调用链路完整验证 |

---

## 3 失败模式（Q3）

### 3.1 server 未启动（HTTP 死端口 / stdio 坏命令 / stdio 坏脚本）——健康检查层

配置三种死 server（`%TEMP%/fail-ws`）：

```
# codebuddy mcp list
dead-http: http://127.0.0.1:29979/mcp (HTTP) - ✗ Failed to connect
dead-script: bun D:/nonexistent/spike-server.ts - ✗ Failed to connect
bad-cmd: totally-not-a-command-xyz - ✗ Failed to connect

# qodercli mcp list
✗ dead-http: http://127.0.0.1:29979/mcp (http) - Disconnected
✗ dead-script: bun D:/nonexistent/spike-server.ts (stdio) - Disconnected
✗ bad-cmd: totally-not-a-command-xyz (stdio) - Disconnected
```

两底座一致：**明确标记失败、不崩溃、秒级返回**。

### 3.2 会话层：死 server 挂着**不阻塞**普通会话

| 场景 | 底座 | 结果 |
|------|------|------|
| 挂 3 个死 server 跑 `-p "只回答一个词：pong"` | qodercli | ✅ 正常答 pong，14.1s |
| 同上 | codebuddy | ✅ 正常答 pong，14.7s |
| 干净目录对照（无 MCP 配置） | qodercli | ✅ pong，26.5s |

耗时差异为模型响应方差（干净目录反而更慢），**死 MCP server 不构成会话阻塞或显著启动税**。

### 3.3 server 会话中途死亡（工作台重启窗口期等价物）

强杀运行中的 spike HTTP server（29980）后开新 CB 会话调 `mcp__spike-http__spike_echo`，模型反馈原文：

```
mcp__spike-http__spike_echo — failed (tool not found; that exact name isn't registered).
Available echo tool is mcp__spike-stdio__spike_echo.
（随后模型自行改调 stdio 版成功：[stdio] echo: after-death）
```

- 行为：**该 server 的工具从会话工具列表消失（不注册、不阻塞）**；模型感知为「工具不存在」。
- ⚠️ 设计警示：模型会**自作主张降级**（本例自己挑了 stdio 版同名工具调用成功）——员工会话在引擎工具不可用时可能绕路乱调。员工包 AGENTS.md 必须写明「引擎工具不可用 = 工作台未运行 → 停止推进并上报，不得绕路」。
- 验证边界：本实验验证的是 **server 死后新开的会话**；「同一交互式会话内 server 中途掉线（工具已注册后断连）」未测（`-p` 单轮形态做不到，需交互式会话实验，留给 L4 员工运行线）。

### 3.4 附带发现二：两底座非交互模式下的 MCP 工具权限门

| 底座 | 现象 | 放行方式 |
|------|------|---------|
| codebuddy `-p` | 模型拒调：「工具 `DeferExecuteTool` 需要授权，但当前处于非交互模式，无法弹出授权确认」 | `-y` / `--permission-mode bypassPermissions` / settings `permissions.allow` |
| qodercli `-p` | 模型拒调：「因权限确认需要交互式处理而失败」 | `--dangerously-skip-permissions` / `--permission-mode` 预设 |

**设计含义**：D-037 模式一里「员工/主控会话经 MCP 工具回报推进」要求工具调用**无人值守自动放行**——员工运行设计必须回答「员工会话以什么权限模式跑」（推荐：员工包安装时预配 permissions.allow 或员工会话统一 bypass 模式 + 工具面白名单），否则每次工具回报都会卡授权。交互式 TUI 会话有弹窗批准路径，但演示/自动驱动场景绕不开这个预设。

### 3.5 其他验证边界（如实记录）

- **并发多客户端未压测**：CB 与 qodercli 是先后连接（各自会话独立），非同时。spike 用 `@hono/mcp` README 的单 transport 单 connect 形态，多客户端并发会话管理（per-session transport / sessionIdManager）是 L3 实现设计点。
- **旧 SSE transport（SSEServerTransport）未测**：两底座均以 `type:"http"`（streamable，现行规范）连接成功，旧规范不再必要。
- **stdio wrapper 转发形态未实现**：§4 的备选路径，仅论证未编码。

---

## 4 形态建议（Q4）：HTTP streamable 主路，同端口挂 workbench-service

**推荐：引擎 MCP 面以 HTTP streamable 形态挂在 workbench-service 的 hono app 上（路径如 `/mcp`，随 service 19980 端口同起同停），用 `@hono/mcp` 中间件。**

| # | 依据（全部实证锚点） |
|---|---------------------|
| 1 | **账本单点**：引擎是 service 进程内 TS 纯库（D-037 模式一），HTTP 形态让所有底座会话（主控 + 多员工）连**同一个引擎实例**——MCP 工具与 SSE 看板消费同一 events 真源，天然一致。stdio 直连会让每个底座 spawn 独立引擎进程，**账本分裂**，与「被动账本」设计直接矛盾 |
| 2 | **架构同构零改造成本**：spike 实证 `Bun.serve({ fetch: app.fetch })` + hono 路由 + `@hono/mcp` 无缝（§2.1）。唯一纪律冲突：[registry.ts](../../workbench/workbench-service/src/server/registry.ts)「禁 import hono」+ hono-adapter 单点——`/mcp` 路由需要框架原生 Context（transport 要 Web 标准 Request/Response 流），编排设计文档需为其开一个**受控例外口**（如 hono-adapter 内注册 MCP 直挂路由，业务路由表纪律不变） |
| 3 | **两底座全通**：CB / qodercli 的 `type:"http"` 实测 Connected + 调用 + 返回全绿（§2.2/§2.3） |
| 4 | **员工包 mcp.json 更稳**：url 型条目只需一个 URL 字段；stdio 型要写 command/args（含 bun/解释器绝对路径），机器漂移面大 |
| 5 | **失败降级友好**：service 未跑时不阻塞底座会话（§3.2），报错形态明确（§3.1） |
| 6 | **省一个端口分配项**：MCP 与 service 同端口不分立，路线图 §4.3 端口表不用加行 |

**不推荐**：引擎 stdio 直连（依据 1 的账本分裂 + 依据 4 的路径漂移）。

**备选（未验证，仅立项备案）**：某底座未来仅支持 stdio 时——薄 wrapper 进程（stdio transport 收到底座请求 → 转 HTTP 调 service API）。多一跳进程管理，本次不编码。

**降级路径判断（D-037 的「失败降级 = HTTP API 回报」）**：保留为**兜底**而非并列通道——底座 Bash 工具 + curl 直调引擎 HTTP API 技术上等价可行（无需新证），但失去 MCP 的 schema 校验与工具语义（模型要手拼 JSON、出错面大）。实证支持的分层是：**MCP 通道正常 → 工具回报；MCP 通道不可用（service 死）→ 按 §3.3 该停跑上报而不是降级 curl**（引擎都不在了，回报无处可去）；「HTTP API 回报」真正价值场景是**未来某底座不支持 MCP http 形态**时的替代通道。

---

## 5 对 D-037 设计的影响（协同编排设计会话输入）

| # | 影响 | 依据 | 去处 |
|---|------|------|------|
| 1 | 引擎 MCP 面定案依据：HTTP streamable 挂 service `/mcp`（同端口），`@hono/mcp` 中间件；hono-adapter 为其开受控例外口（方案由设计文档定） | §4 | 协同编排设计文档（I0-2）MCP 工具面章节 |
| 2 | 员工包 mcp.json = url 型条目（`{"type":"http","url":"http://127.0.0.1:19980/mcp"}`），CB/Qoder 同格式通用 | §2.2/§2.3 | E-12 包构建（L1）+ B-01/B-02 安装（L2） |
| 3 | **Qoder 全局挂载面修正**：CLI 消费 `~/.qoder/settings.json` 的 `mcpServers` 键；仅写 mcp.json 不生效；add/remove 双文件不同步。D-034 表述需在 L2 设计细化 | §2.4 | L2 安装线设计 + D-034 追加注记（main 决策流程） |
| 4 | 员工会话权限模式是必答题：非交互/托管场景 MCP 工具调用需预配放行（permissions.allow / bypass 模式），否则每次回报卡授权 | §3.4 | 员工运行设计（L4）+ 编排设计（主控驱动方式） |
| 5 | 员工包 AGENTS.md 健壮性指令：「引擎工具不可用 = 工作台未运行 → 停止推进并上报，不得绕路/自行降级」（实证模型会自作主张调别的工具） | §3.3 | E-12 AGENTS.md 模板（L1）+ 内置 team 预置包 |
| 6 | 运行顺序约束：工具在**会话启动时**注册——主控驱动流程必须「先确认 service healthz → 再开/派员工会话」；service 重启窗口期在跑的员工会话需引导重开 | §3.3 | 编排设计（主控驱动方式章节）+ demo 驱动脚本 |
| 7 | 多客户端并发会话管理（per-session transport）为 L3 实现设计点，spike 未压测 | §3.5 | L3 引擎线 plan |
| 8 | MCP server 不再是风险项：路线图 §6 该行可在 I3 回写时移除/标记已消险 | §1 | I3 文档回写 |

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-25（落档 08-26） | 初版：Spike 四问全部实证回答；头号技术风险解除；两条附带发现（Qoder 全局挂载生效面 / MCP 工具权限门）供设计会话采纳 |
