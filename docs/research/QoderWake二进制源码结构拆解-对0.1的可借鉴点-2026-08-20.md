# QoderWake 二进制内嵌源码结构拆解 —— 对 0.1 版本开发的可借鉴点

> 日期：2026-08-20
> 状态：🟢 已完成（Linux 侧）· Windows 侧待补
> 触发：用户"你可以把 JS 源码撸下来，看看对我们的 0.1 版本开发有无帮助"
> 关联：[工作台独立安装部署与托盘启动器方案调研](工作台独立安装部署与托盘启动器方案调研-2026-08-20.md)（本文是其附录 A 的深化）

---

## 0. 方法与边界声明

### 0.1 提取方法

本机 `~/.qoderwake/qoderwake` 是一个 161 MB 的 ELF 可执行文件，`not stripped`。它是 Bun `--compile` 的产物，内嵌一个 standalone module graph：

| 步骤 | 做法 |
|------|------|
| 1 | `readelf -S` 找到 `.bun` 节（offset `0x5a28000`，size `0x3ffa50e` ≈ 64 MB） |
| 2 | dump 该节 → 尾部有 Bun 的 trailer 魔数 `\n---- Bun! ----\n` 与模块表偏移 |
| 3 | 解析模块表 → 全 bundle 只有 **2 个模块**：主入口 + 1 个 worker |
| 4 | 按 contents 指针切出 `main.js`（63.8 MB / 617,065 行）与 `worker.js`（235 KB） |

**关键事实：产物未经 minify、未 strip、无 sourcemap 但保留了全部原始模块路径注释。** 也就是说这份二进制等于把 TypeScript 编译后的可读源码原样公开发布了。

### 0.2 IP 边界（本文自我约束）

- 本文记录**架构模式、模块划分、工程做法、平台踩坑**，不复制其业务算法与代码实现
- 引用少量**平台配置模板字段**（systemd unit / Task Scheduler XML / launchd plist 键名）—— 这些是操作系统的公开接口规范，不构成其独创表达
- 不把其源码文件带入本仓；提取产物只落在 `/tmp`，不入库
- 结论一律回到"我们该怎么做"，不做逐行对照

---

## 1. 一句话回答"有无帮助"

**有，且价值集中在两处**：① 一份现成的「数字员工 daemon」领域分解地图（1066 个源文件的模块划分），可直接当我们工作台的目录设计参照物；② 三平台 keepalive 与自更新重启的**血泪工程细节**，其中 Windows 那部分是我们 0.1 必踩的坑，现在可以提前绕开。

同时纠正了本报告 v2 的一处推测（HTTP 框架），并为一条风险缓解策略（不锁 Bun）提供了实证支持。

---

## 2. 形态事实

| 事实 | 数值 | 对我们的意义 |
|------|------|------------|
| 单体二进制 | 161 MB（含 Bun 运行时 + 64 MB payload） | 单文件分发可行，体积可接受；我们的 0.1 业务量远小于此 |
| bundle 模块数 | **2 个**（主入口 + image-resize worker） | 全部业务打进一个 JS 文件，只有 Worker 单独成模块（Worker 必须是独立文件） |
| 主 bundle | 63.8 MB / 617,065 行，**未 minify** | 未 minify 是刻意的（便于线上栈追踪），代价是源码等于公开 |
| 原始源文件数 | **1066 个 `src/**/*.ts`** | 保留了完整路径，模块地图可直接读出 |
| 运行时 | Bun 1.3.14（`BuildBun` 与 `Runtime` 同版本） | 编译与运行同版本，避免 ABI 漂移 |

> 我们的对应决定（已写入主报告 §9.2）：**必须 strip、可以 minify**。栈追踪问题用"发布 sourcemap 到内部、二进制里不带"解决，而不是靠不 minify。

---

## 3. 模块地图：一份现成的领域分解

`src/` 一级划分（按文件数）：

| 目录 | 文件数 | 职责 | 我们的对应物 |
|------|--------|------|------------|
| `src/daemon/` | 849 | 常驻服务全部业务 | `workbench-service` |
| `src/cli/` | 53 | 命令行入口与子命令 | 同一二进制的 CLI 面 |
| `src/core/` | 46 | 跨 daemon/cli 共享：认证、路径、版本、加密、更新渠道 | `shared-*` |
| `src/plugin-adapters/` | 20 | **把插件能力翻译成宿主 CLI 的扩展格式** | **UPP 适配层** ⭐ |
| `src/telemetry/` | 16 | 埋点 | 0.1 不做 |
| `src/feature-config/` | 9 | 特性开关 | 0.2+ |
| `src/dynamic-text/` | 4 | 文案远端下发 | 不做 |

### 3.1 `src/daemon/` 二级划分

| 目录 | 文件数 | 职责 | 0.1 是否需要 |
|------|--------|------|------------|
| `modules/` | 410 | 扁平的服务模块层（一模块一职责，见 §3.2） | 需要，但只挑十几个 |
| `teams/` | 113 | 多智能体团队：Leader/Member/Mission/Plan/Orchestrator | **不做**（我们 2.0 的"员工群组"在后续版本） |
| `channel/` | 112 | IM 渠道接入（钉钉/群问答/配对/消息队列） | **不做** |
| `session-runtime/` | 46 | 会话运行时内核：事件映射、投影、资源治理、预热、审批 | 部分需要（见 §3.3） |
| `at-waker/` | 35 | @员工 交互 | 不做 |
| `utils/` | 32 | 工具 | 需要 |
| `conversations/` | 24 | 会话记录 | 简化版需要 |
| `workflow-engine/` | 20 | 工作流引擎 | **需要**（我们的编排引擎） |
| `capabilities/` | 13 | 能力注册 | 需要（见 §5.4） |
| `storage/` | 10 | 存储后端抽象 | 需要（简化） |
| `reliability/` | 4 | 崩溃检测与可靠性标记 | **需要**（§5.5） |
| `tap/` | 4 | 埋点/上报通道 | 不做 |
| `task-trace/`, `conversation-trace/`, `profiling/` | 8 | 追踪与性能 | 0.1 只留最小日志 |

### 3.2 `modules/` 层的命名法值得抄

410 个文件全部平铺在一个目录，**没有再分子目录**，靠命名后缀表达角色：

| 后缀 | 语义 | 实例 |
|------|------|------|
| `*Store` | 持久化仓储 | `SessionStore` `TriggerStore` `SkillStore` `ProjectStore` `PermissionsStore` `VersionStore` |
| `*Manager` | 有状态的生命周期管理者 | `SessionManager` `ChannelManager` `HeartbeatManager` `ProcessManager` `FileLockManager` `SSEManager` `ConfigManager` |
| `*Service` | 无状态或弱状态的业务动作 | `KeepaliveService` `AuthRefreshService` `TriggerIngestionService` |
| `*Router` | 请求/事件分发 | `PluginRouter` `TriggerRouter` `TelemetryRouter` |
| `*Scheduler` | 定时/排队 | `TaskScheduler` `TriggerScheduler` |
| `*Coordinator` | 跨模块协调（含恢复） | `WakeRecoveryCoordinator` `MachineBridgeRecoveryCoordinator` |
| `*Policy` | 纯判定规则 | `SkillNamePolicy` `SkillReviewDecisionPolicy` `ImOutboundProviderPolicy` |
| `*Guard` | 准入拦截 | `RemoteEmployeeConfigWorkGuard` |
| `*Builder` / `*Converter` / `*Normalizer` | 纯数据变换 | `MachineCapabilityReportBuilder` `EmployeeTemplateConverter` |

**对我们的价值**：这套后缀约定可以直接抄进工作台的代码规范。它的好处是**从文件名就能判断该文件能不能有状态、能不能做 IO、能不能被单测直接调**（`*Policy` 必须是纯函数，`*Store` 必须能被内存实现替换）。我们 CLAUDE.md 的代码规范里可以加这一条。

### 3.3 一条重要的架构观察：触发器是一等子系统

`modules/` 里 `Trigger*` 有 **16 个文件**，构成一条完整流水线：

```
TriggerStore（定义持久化）
  → TriggerScheduler（定时触发）／ TriggerChannelBridge（IM 触发）／ WebhookEventDispatcher（外部事件）
  → TriggerIngestionService（入队、去重）
  → TriggerQueueConsumer（并发上限受 settings.json 控制）
  → TriggerInvokerService（真正拉起一次会话）
  → TriggerSessionWatcher（盯执行）
  → TriggerInspector / TriggerTelemetry（可观测）
  → TriggerWorktreeService（为触发准备独立 git worktree）⭐
  → TriggerFollowupConfig（后续轮次）
```

两点启示：

1. **"员工被什么唤醒"应当是独立子系统**，而不是散落在各处的定时器。我们的白皮书里"员工触发"目前描述得比较薄，这条流水线可以直接当设计参照。
2. **`TriggerWorktreeService`**：每次自动触发在**独立 git worktree** 里执行，避免并发任务互相污染工作区。这个做法对我们「数字员工在同一仓库上并发干活」的场景是直接可用的解法，值得在 0.2 的设计里写进去。

---

## 4. 纠正与佐证：三条与主报告裁决相关的实证

### 4.1 HTTP 框架实证是 Express，不是 Hono

| 标记 | 出现次数 |
|------|---------|
| `express` | **291** |
| `hono` | 1（疑似字符串巧合） |
| `fastify` | 0 |

并且有 `src/daemon/core/capability/express-route-registry.ts` 明确的路由注册层。

**这不推翻我们选 Hono 的裁决**（理由仍是"与 MemoryProxy 一致、可跑 Bun/Node/Workers"），但它给出了两个有用信息：

1. **在 Bun 上跑成熟 Node HTTP 框架是生产可行的** —— 框架选择的风险比想象的低，R-10 可以再降一档
2. 它把路由注册抽成了一个 registry 层（`express-route-registry`），**业务模块不直接碰框架 API**。这样换框架只改 registry。我们应当照做：Hono 只出现在一个 adapter 文件里，其余模块只依赖我们自己的 route 注册接口

### 4.2 `child_process` 72 次 vs `Bun.spawn` 1 次 —— "不锁 Bun"确实可行

主报告 R-10 的缓解策略是"业务代码只写标准 TS + Web 标准 API，不用 Bun 专有语法，保留回退 Node SEA"。实证显示这条**就是它本身在做的事**：

| API | 次数 | 性质 |
|-----|------|------|
| `child_process` | 72 | Node 标准 |
| `Bun.spawn` | 1 | Bun 专有 |
| `bun:sqlite` | 7 | Bun 专有（但只在存储层一处） |
| `fs/promises`, `os`, `path` | 大量 | Node 标准 |

即：**一个 63 MB 的生产 Bun 应用，对 Bun 专有 API 的依赖只集中在 SQLite 一处**。这说明"以 Bun 为运行时但不被 Bun 锁定"是可达成的工程状态，R-10 的缓解方案有实证背书。

我们的落地口径：**Bun 专有 API 只允许出现在 `storage/` 与 `runtime/` 两个目录**，其余目录 lint 禁用。

### 4.3 zod 出现 875 次 —— schema 校验是一等公民

875 次意味着几乎每个对外边界（HTTP 入参、配置文件、持久化记录、跨进程消息）都过一遍 schema。

**对 0.1 的建议**：配置文件（`config.json` / `settings.json`）与 HTTP API 入参从第一天就上 zod。理由不是"更规范"，而是很实际的两条：

- 配置项走 schema 后，`*.sample.json` 那份"全量带注释示例"可以**从 schema 自动生成**，不会与代码脱节（这正是我们主报告 §5.4 采纳的做法，但只有配上 schema 才不会腐烂）
- 单体二进制没有 Node 的 `--inspect` 便利，坏数据要在入口就被挡住，否则排查成本极高

---

## 5. 五条可直接搬进 0.1 的工程做法

### 5.1 keepalive 三平台的代码组织

```
modules/keepalive/
├── service.ts                     统一入口（对上只暴露 register / unregister / status）
├── config.ts / constants.ts / common.ts
├── linux/
│   ├── systemd.ts                 systemctl --user 调用
│   ├── systemd-unit.ts            unit 文件渲染 + 反解析
│   └── systemd-linger.ts          loginctl enable-linger（关键，见下）
├── darwin/
│   ├── launchd.ts / launchd-plist.ts
│   └── launchd-restart-handoff.ts
└── win32/
    ├── schtasks.ts / schtasks-xml.ts
    ├── native-restart-handoff.ts
    └── tray-launch-at-login.ts    ⭐ 托盘壳的自启是单独一份配置
```

三点值得直接抄：

1. **渲染 + 反解析成对出现**（`buildSystemdUnit` 与 `parseSystemdExecStart`）。有反解析才能做"检测已注册的守护配置是否与当前版本一致"，从而支持幂等重装与升级迁移。只写渲染是不够的。
2. **`systemd-linger`**：Linux 上 `--user` 服务默认在用户登出后被杀。要让它"关掉终端还活着"必须 `loginctl enable-linger $USER`。这是我们主报告 §7 漏掉的一条，**必须补**。
3. **托盘壳的登录自启与服务的 keepalive 是两份独立配置**（`tray-launch-at-login.ts`）。这佐证了主报告 C-4「壳与服务独立」的裁决 —— 连自启注册都不共用。

### 5.2 systemd unit 字段（Linux）

实证模板的完整字段（我们主报告 §7.1 已采纳大部分，此处补齐）：

```ini
[Unit]
After=network-online.target        # ← 我们漏了
Wants=network-online.target        # ← 我们漏了
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Restart=always
RestartSec=5
RestartPreventExitStatus=78        # EX_CONFIG：配置错误不徒劳重启
TimeoutStopSec=30
TimeoutStartSec=30                 # ← 我们漏了
SuccessExitStatus=0 143            # SIGTERM 视为正常
KillMode=control-group             # 连带杀子进程
EnvironmentFile=-<path>            # ← 前缀 "-" = 文件不存在不报错，我们漏了

[Install]
WantedBy=default.target
```

补三条到主报告 §7.1：`network-online.target` 依赖、`TimeoutStartSec`、`EnvironmentFile=-`（前缀减号的容错语义）。

### 5.3 Windows Task Scheduler XML（这一段最有价值）

它**不用 `schtasks /create` 的命令行参数，而是渲染完整 Task XML 再 `/XML` 导入**。原因显然：命令行参数的引号转义在含空格路径下是灾难。

关键字段与语义：

| 字段 | 值 | 为什么重要 |
|------|-----|-----------|
| `<LogonTrigger>` | enabled | **登录即启动 = 开机自启与 keepalive 是同一份配置**，直接佐证主报告 D-e 的裁决 |
| `<LogonType>` | **S4U** | Service-For-User：**不需要存用户密码**就能以该用户身份跑 |
| `<RunLevel>` | **LeastPrivilege** | **不要管理员权限** → per-user 安装免 UAC 的关键 |
| `<MultipleInstancesPolicy>` | **IgnoreNew** | **单实例由 OS 保证**，重复触发不会起第二个进程 |
| `<ExecutionTimeLimit>` | **PT0S** | 永不超时。默认值是 72 小时后杀掉 —— 长驻服务不设这条会被莫名杀死 ⚠️ |
| `<DisallowStartIfOnBatteries>` | false | 默认 true：**笔记本拔电源后任务不启动** ⚠️ |
| `<StopIfGoingOnBatteries>` | false | 默认 true：**切到电池就停服务** ⚠️ |
| `<StopOnIdleEnd>` / `<RestartOnIdle>` | false / false | 默认会因空闲策略停服务 ⚠️ |
| `<RestartOnFailure>` | Interval + Count | 崩溃重启 |

标 ⚠️ 的四条是**Windows Task Scheduler 的默认值对常驻服务全是错的**。如果我们照直觉用 `schtasks /create /sc onlogon`，会得到一个"用户拔掉电源就悄悄停掉、且 72 小时后被杀"的服务，而且这类故障极难复现和归因。**这四条是本次拆解最实用的收获。**

对应动作：主报告 §7.1 的 Windows 列从"任务触发器 + 失败重试"细化为上表，并在 T4 验收标准里加"拔电源后服务仍在跑"。

### 5.4 launchd plist（macOS）

用到的键：`KeepAlive` / `RunAtLoad` / `ThrottleInterval` / `StandardOutPath` / `StandardErrorPath` / `EnvironmentVariables` / `WorkingDirectory`。与主报告 §7.1 一致，无需修改。

### 5.5 Windows 自更新的「重启交接」与端口继承句柄坑

自更新要替换的是**正在运行的自己**，Windows 上文件被占用无法覆盖。它的解法是生成一个外部脚本接管：

```
qoderwake-restart-handoff.ps1        实际交接逻辑
qoderwake-restart-handoff.cmd        wrapper（绕开 PS 执行策略）
qoderwake-restart-handoff.log        交接过程独立日志
lock TTL = 120s                      防并发交接
```

交接脚本的等待逻辑分层升级（这部分是踩坑沉淀，直接抄语义）：

| 阶段 | 动作 |
|------|------|
| 等进程退出 | 轮询目标路径的进程，60 × 250ms ≈ 15s |
| 等端口释放 | 轮询 `Get-NetTCPConnection -State Listen`，120 × 250ms ≈ 30s |
| 第 5 秒 | 仍占端口且**进程路径属于本安装目录** → `taskkill /PID /T /F` 强杀（只杀自家的，不碰第三方） |
| 第 10 秒 | 端口 owner 进程**已退出但端口仍在 Listen** → 判定为"子进程继承了 socket 句柄的孤儿"，清理本安装目录下的全部孤儿进程 |
| 超时 | 记日志，允许 daemon 回退到其它端口 |

**第 10 秒那一条是 Windows 的著名陷阱**：父进程 spawn 子进程时若未显式禁止句柄继承，子进程会继承监听 socket；父进程退出后端口仍被子进程持有，而这个子进程可能与服务毫无关系（比如一个 CLI 子任务）。表现是"服务已停止但端口还占着"，看起来像端口泄漏。

**对 0.1 的三条动作**：

1. spawn 子进程时**显式不继承句柄**（这是根治，比事后清理便宜得多）
2. 停止流程里加一步"确认端口真的释放"，而不是进程退出就认为停好了（主报告 §7.5 已有此要求，现在有了实证依据）
3. Windows 上的自更新走"外部脚本交接 + 独立交接日志"，不要试图在进程内替换自己

---

## 6. 三分清单：0.1 抄什么、缓什么、不抄什么

### 6.1 0.1 直接抄（成本低、收益确定）

| 项 | 出处 | 落点 |
|----|------|------|
| `*Store` / `*Manager` / `*Service` / `*Policy` 命名约定 | §3.2 | 工作台代码规范 |
| keepalive 目录结构 + 渲染/反解析成对 | §5.1 | `service/keepalive/` |
| systemd unit 补齐三字段 + `enable-linger` | §5.2 | 主报告 §7.1 |
| Windows Task XML 四个反直觉默认值 | §5.3 | 主报告 §7.1 + T4 验收 |
| 子进程不继承句柄 + 停止后验证端口释放 | §5.5 | 主报告 §7.5 |
| 框架只出现在一个 route-registry adapter 里 | §4.1 | 架构约束 |
| 配置与 API 入参上 zod，sample 从 schema 生成 | §4.3 | T9 |
| Bun 专有 API 限制在两个目录 | §4.2 | lint 规则 |
| 主日志 / 生命周期日志分离 + 启动横幅 | 主报告 §5.3 | T10 |

### 6.2 0.2+ 再说（有价值但不阻塞 0.1）

| 项 | 为什么缓 |
|----|---------|
| 触发器十六件套（§3.3） | 0.1 只需"手动跑一次员工"，定时/IM/Webhook 触发是 0.2 的事 |
| `TriggerWorktreeService`（独立 worktree 隔离并发） | 等真出现并发任务再做，但设计时要留位置 |
| Windows 自更新重启交接（§5.5） | 0.1 的更新是"检查 + 引导"，不做原地替换，暂不需要交接脚本；但**句柄继承**那条现在就要做对 |
| 存储后端抽象（sqlite / file / 外部 DB） | 0.1 只要 sqlite + WAL，抽象层留一个接口即可 |
| 能力注册表（`capability/express-route-registry` + `work-poller-handler-registry`） | 0.1 模块少，直接注册；但命名和位置先占好 |

### 6.3 明确不抄

| 项 | 原因 |
|----|------|
| `teams/` 113 文件的多智能体编排 | 我们的"员工群组"在后续版本，且我们的编排引擎是自己的模型 |
| `channel/` 112 文件的 IM 接入 | 不在 2.0 范围 |
| 云端 work handler 拉取模型（`Remote*` 一大片 + `WorkPoller`） | 与我们"本地优先、可离线"的定位冲突 |
| `MachineBinding` / `MachineID` / 网关强绑 | 同上 |
| 遥测 / 动态文案远端下发 | 0.1 不做，且涉及合规 |
| 不 strip / 不 minify | 反面教材（§2） |
| 双端口监听 | 单端口更易解释、易做防护 |
| 410 文件全平铺在一个 `modules/` | 规模到了才有意义；我们初期应按子域分目录，但**保留其命名后缀约定** |

---

## 7. 已回写主报告的条目

> 状态：✅ 下列六处已回写完成，两份文档口径一致（主报告附录 A.8 反向指回本文）。

| 主报告位置 | 改动 |
|-----------|------|
| §4.5 裁决表 | Hono 一行补注：实证参照用 Express，说明成熟 Node 框架在 Bun 上生产可行；框架须收敛到单个 route-registry adapter |
| §7.1 三平台对照表 | Linux 补 `After/Wants=network-online.target`、`TimeoutStartSec`、`EnvironmentFile=-`、`loginctl enable-linger`；Windows 列换成 §5.3 的字段表 |
| §7.5 退出与清理 | 补"子进程显式不继承句柄"与"停止后主动验证端口已释放" |
| §11 风险清单 | R-10（Bun 锁定）概率下调，缓解补"专有 API 限制在两个目录"；新增 R-12「Windows 服务被电源/空闲策略静默停掉」 |
| §13 任务清单 | T4 验收加"拔电源后服务仍在跑"；T9 补"sample 从 zod schema 生成" |
| 附录 A | 增一节指向本文 |

---

## 8. Windows 侧待用户补充

本次拆解是在 Linux 上做的，源码里 win32 相关代码可读，但**运行时行为未验证**。待用户在 Windows 侧实证：

| 待验 | 具体问题 |
|------|---------|
| Task Scheduler 实际注册结果 | 任务名、所在路径、S4U 是否真的免密码、是否弹 UAC |
| nativeApp 托盘壳 | 技术栈、体积、常驻内存、与 daemon 的通信方式 |
| `tray-launch-at-login` 的实际形态 | 是注册表 Run 键、启动文件夹、还是第二个计划任务 |
| 安装器 | 类型、安装目录、是否 per-user |
| 自更新 | 交接脚本是否真的被用到、更新期间服务中断多久 |

补齐后回写本文 §5.3 / §5.5 与主报告 §6 / §9。
