# QoderWake 二进制内嵌源码结构拆解 —— 对 0.1 版本开发的可借鉴点

> 日期：2026-08-20
> 状态：🟢 已完成（Linux 侧源码拆解 + Windows 侧运行时实证）
> 触发：用户"你可以把 JS 源码撸下来，看看对我们的 0.1 版本开发有无帮助" → 追加"补充 Windows 下的排查"
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

> **Windows 侧实证补注（2026-08-20）**：同一渠道的 Windows 包里 `resources/build-info` 记录 `bun_version = 1.3.12`，比 Linux 侧低两个补丁号 —— 即**同一发布版本的不同平台产物用了不同的 Bun 构建**。同一文件里 `commit_id = 51b2ab6b…-dirty`，带 `-dirty` 后缀发布，说明构建机工作区不干净。两条都是我们要避免的：**同一 release 的三平台产物必须锁同一运行时版本，且 CI 拒绝 dirty 构建**。详见 §8.1。

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

### 5.3 Windows Task Scheduler XML（源码侧读出）

> ⚠️ **2026-08-20 Windows 实证修正**：本节是从 Linux 侧读 `win32/schtasks-xml.ts` 源码得到的推断，字段与语义正确，但**它不是 Windows 的默认 keepalive 路径**。本机实测：Task Scheduler 里没有任何 QoderWake 任务，Windows 真正的常驻靠「托盘看门狗 + 可选 WinSW 服务」。详见 §8.2 / §8.3。本节保留，因为四条反直觉默认值一旦我们真的走计划任务路线仍然成立。

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

> ✅ **2026-08-20 Windows 实证确认**：交接脚本**真的在跑**，本机留有完整交接日志，锁 TTL 实测正好 120 秒，一次自更新的服务中断约 17 秒。实测时间线与新发现的悬挂问题见 §8.5。

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

## 8. Windows 侧运行时实证（2026-08-20 补）

### 8.0 排查方法与环境

本节不是读源码，是在**一台真实安装并长期使用过 QoderWake 的 Windows 25H2 机器**上做运行时取证。取证面：

| 面 | 手段 |
|----|------|
| 计划任务 / 服务 | `Get-ScheduledTask`、`Get-Service` 过滤 qoder/wake |
| 自启注册 | HKCU/HKLM `\Software\Microsoft\Windows\CurrentVersion\Run`、Startup 文件夹 |
| 安装器 | HKLM `Uninstall` 项、安装目录文件清单 |
| 运行时状态 | `%USERPROFILE%\.qoderwake\{run,bin,config,data,logs}` 全目录树 + 逐个小文件 |
| 进程与端口 | `Get-NetTCPConnection`、`daemon.info.json` |
| 二进制身份 | `(Get-Item).VersionInfo`（FileVersion / ProductName / CompanyName）|
| 日志 | 托盘日志、重启交接日志、主日志、生命周期日志 |
| 浏览器通道 | HKCU `\Software\Google\Chrome\NativeMessagingHosts` |

全程**只读**，未修改任何系统状态；不记录任何个人数据与凭据内容（§0.2 的 IP 与隐私边界在本节同样适用）。

### 8.1 形态：三套件、三条独立版本线

Windows 侧不是"一个二进制"，而是**三个独立升级的件**：

| 件 | 版本源 | 实测版本 | 位置 |
|----|--------|---------|------|
| 安装器（installer）| HKLM Uninstall `QoderWake_is1` | **0.1.33** | `C:\Software\QoderWake\` |
| daemon | `bin\.installed-version` | **0.2.3** | `%USERPROFILE%\.qoderwake\bin\` |
| 托盘壳（tray）| `run\native-shell-version` | **0.0.20** | `installer\qoderwake-tray.exe` |

**三条版本线完全错开。** 直接后果：Windows「应用和功能」里显示的是 **0.1.33**（安装器版本），而用户心里的"QoderWake 版本"是 0.2.3。用户报障时说的版本号与研发看的版本号不是同一个东西。

主要二进制清单（实测字节数）：

| 文件 | 大小 | ProductName / 备注 |
|------|------|------------------|
| `bin\qoderwake.exe` | 178,702,832 | ProductName **"Bun"**、FileVersion 1.3.12 —— 即二进制元数据没改，直接暴露构建工具 |
| `bin\qoderwakew.exe` | 116,292,080 | **"QoderWake Background Helper"** —— `w` 后缀 = 无控制台窗口的变体（同 javaw.exe 惯例）|
| `installer\qoderwake-bootstrapper.exe` | 116,059,120 | "QoderWake Bootstrapper" |
| `installer\payload\qoderwake.exe` | 173,371,888 | 随安装包分发的 daemon 初始版 |
| `bin\qodercli-wake.exe` | 160,642,032 | **底座 CLI 本体随包分发**（见 §8.8）|
| `installer\qoderwake-tray.exe` | **89,072** | 原生托盘壳，87 KB（见 §8.6）|
| `installer\qoderwake-service.exe` | — | **WinSW 3.0.0.0**（Windows Service Wrapper，Kohsuke Kawaguchi）|

对我们的三条动作：

1. **三件统一报一个用户可见版本**。安装器版本可以不同，但写入 Uninstall 项的 `DisplayVersion` 必须是服务版本，否则取证时会走两小时弯路。
2. **发布物的 VersionInfo 必须重写**。`ProductName = "Bun"` 这类泄露构建工具的元数据在企业环境里会直接引发合规质询。
3. **CI 拒绝 `-dirty` 与跳版本运行时**（§2 补注）。

### 8.2 keepalive 实证：三条路径都在盒子里，本机只有托盘看门狗生效

这是本次实证**推翻了 §5.3 推断**的一节。

| 探查项 | 结果 |
|--------|------|
| `Get-ScheduledTask` 过滤 qoder/wake | **无任何 QoderWake 任务**（只命中 Windows 自带的 WakeUpAndScanForUpdates 等，均 Disabled）|
| `Get-Service` 过滤 qoder | **无 QoderWake 服务注册** |
| HKCU / HKLM `Run` 键 | **无 QoderWake 项** |
| Startup 文件夹 | **无 QoderWake 快捷方式** |
| `settings.json` 里 `system.launchAtLogin` | **`false`** |
| `run\windows-tray-launch-at-login-defaulted` | 存在，内容为时间戳 `2026-07-31T07:27:40Z` |
| `run\windows-tray-path` | `C:\Software\QoderWake\installer\qoderwake-tray.exe` |
| daemon 实际启动命令（托盘日志）| `qoderwake.exe __daemon --host 127.0.0.1 --port 19820`，以及 `start --no-keepalive` |

结论：**Windows 侧把三种 keepalive 路径全部预置在包里（WinSW 服务 / 计划任务 / 托盘看门狗），但本机实际生效的只有托盘看门狗，且 daemon 是以 `--no-keepalive` 被拉起的。** 也就是说它把"保活"的责任从 OS 上移到了自己的托盘进程里。

**为什么这么选（推测但有证据支撑）**：计划任务与服务都需要一次注册动作（服务还需管理员），而托盘进程自己就能完成"探活 + 拉起 + 去重"，且能给用户一个可见入口。代价是：**托盘进程被杀则全链断**，没有 OS 级兼底。

**对 0.1 的修正后口径**：

1. Windows 的 keepalive **不以计划任务为默认路径**，而是"托盘看门狗为默认 + 服务为可选升级"。计划任务当第三条备选。
2. 既然默认路径是托盘，那么**托盘自身的存活就是单点**。必须在 T4 验收里加一条：手动结束托盘进程后，服务能不能恢复？如果不能，必须开 launchAtLogin 或服务兼底。
3. §5.3 的四条反直觉默认值（`PT0S` / 电源 / 空闲）**仍然成立且仍要拄**，只是适用于我们选择计划任务路径时。

### 8.3 WinSW 服务包装：`service.xml` 字段实证

安装目录里有一对 `qoderwake-service.exe`（= WinSW 3.0.0.0）+ `qoderwake-service.xml`。虽未注册，但 xml 是完整的，相当于拿到了它的"服务路径设计答案"：

| 字段 | 值 | 为什么重要 |
|------|-----|-----------|
| `<id>` | `QoderWakeDaemon` | 服务名与日志目录同根 |
| `<startmode>` | `Automatic` | 开机自启 |
| `<executable>` | `%BASE%\qoderwake-bootstrapper.exe` | **服务拉的是 bootstrapper 而不是 daemon** —— 这样自更新才能换 daemon 而不动服务注册 |
| `<arguments>` | `--service-supervisor` | 服务模式下 bootstrapper 当监工 |
| `<env>` | `QODERWAKE_MANIFEST_URL=…/channels/manifest.json` | **更新渠道写在服务定义里**，不依赖用户环境变量 |
| `<logpath>` | `%ProgramData%\QoderWakeDaemon\logs` | 服务路径的日志落 ProgramData（无用户上下文）|
| `<log mode="roll-by-size">` | `sizeThreshold=10485760`（10 MB）/ `keepFiles=8` | **日志轮转在这条路径上配了** —— 而默认路径没配（§8.9）|
| `<onfailure>` ×3 | restart 10s → restart 30s → none | **退避式重试且有上限**，不无限重启 |
| `<resetfailure>` | `1 hour` | 一小时内无故障则清零计数器 |

**三条直接可択**：

1. **服务指向 bootstrapper，不指向业务二进制**。这是自更新与服务注册解耦的关键 —— 否则每次升级都要重注册服务（需管理员）。
2. **`onfailure` 三步退避后停手**。systemd 那边我们已用 `StartLimitBurst=5`，Windows 服务路径要用多段 `onfailure` 达到同效。
3. **`roll-by-size` + `keepFiles` 必须两条路径都配**。它只在服务路径配了，结果默认路径累到 14.4 MB 单文件（§8.9）—— **日志轮转属于日志子系统，不属于 keepalive 子系统**。

### 8.4 安装器：Inno Setup + bootstrapper/payload，per-machine

| 实证 | 结论 |
|------|------|
| `unins000.exe` / `unins000.dat`、注册项后缀 `_is1`、`i18n\*.properties` | 安装器是 **Inno Setup** |
| 注册位置 | **HKLM**（`\Software\Microsoft\Windows\CurrentVersion\Uninstall\QoderWake_is1`）→ **per-machine 安装，需 UAC** |
| InstallLocation | `C:\Software\QoderWake\` —— **不在 Program Files** |
| 层次 | `installer\qoderwake-bootstrapper.exe` + `installer\payload\`（内含完整 daemon + resources + 底座 CLI）|
| `installer\payload-manifest.json` | 18,288 B —— payload 清单（校验与展开依据）|
| `installer\qoderwake-cleanup.ps1` | 10,087 B —— **卸载/修复的清理逻辑是一份独立 PS 脚本**，不写在 Inno 脚本里 |

对我们的四条：

1. **安装器只负责落盘 bootstrapper + payload，不负责理解业务**。升级时只换 payload，安装器本身可以很久不动（实测安装器 0.1.33 vs daemon 0.2.3 就是这个模型的后果）。
2. **清理逻辑抽成独立脚本**。好处是能被"修复安装"、"卸载"、"手动排障"三个场景复用，而不是卸载时才能跑。我们应照做。
3. **per-machine vs per-user 要早定**。它选了 per-machine（开局就得 UAC）但服务却没注册、自启也走托盘 —— **花了 UAC 的价钱，没享到 per-machine 的好处**。我们 0.1 的默认应是 **per-user 安装、免 UAC**，企业批量部署另出 per-machine 变体。
4. **不要装到 `C:\Software\`** 这类非标准位置。per-user 用 `%LOCALAPPDATA%\Programs\`，per-machine 用 `%ProgramFiles%`。

### 8.5 自更新重启交接：实测时间线与一个悬挂的坑

§5.5 从源码推测的交接机制 **真的在跑**。`bin\qoderwake-restart-handoff.log` 留下完整时间线：

| 时间 | 事件 |
|------|------|
| 13:43:47.67 | `.cmd` wrapper started |
| 13:43:49.18 | `powershell exit 0 for detached …-handoff.ps1 relaunch` —— **wrapper 拉起 detached PS 后自己立即退出** |
| 13:43:49.872 | handoff lock created `expires=13:45:49` —— **TTL 实测正好 120 秒**，与 §5.5 推测一致 |
| 13:43:49.881 | waiting for pid=47388 |
| 13:43:49.896 | pending update found at `bin\.pending-update` |
| 13:43:50.748 | **pending update applied version=0.2.3**（替文件耗时 ≈ 0.85s）|
| 13:43:53.237 | launching daemon: `qoderwake.exe start --no-keepalive --host 127.0.0.1 --port 19820` |
| 13:43:53.645 | launched daemon starter pid=65044 |
| 13:44:04.510 | **daemon start command completed successfully**（daemon 自身启动耗时 ≈ 11s）|
| 13:44:04.520 | handoff lock removed |

**三个可量化结论**：

1. **一次自更新的服务中断 ≈ 17 秒**（从 wrapper 启动到 daemon 就绪）。其中 **11 秒是 daemon 自身冷启动**，替文件只花 0.85 秒 —— 优化重启时长要优化启动，不是优化交接。
2. **端口是固定继承的**（`--port 19820` 写进交接命令）。好处是客户端不需重新发现，代价是一旦端口被孤儿子进程占着（§5.5 那个坑）就卡死。**两者必须配套：固定端口 + 强制验证端口释放**。
3. **wrapper 日志是乱码**。`qoderwake-restart-handoff-wrapper.log` 内容为 GBK/ANSI（cmd 本地代码页），而 PS 写的主交接日志是 UTF-8。→ **所有日志统一 UTF-8**，`.cmd` 里先 `chcp 65001`。

#### 新发现：`.pending-update` 悬挂 15 天，占 327 MB

| 实证 | 值 |
|------|-----|
| `bin\.pending-update\.pending-version` | **0.2.4** |
| 该目录落盘时间 | 2026-08-05 09:44 |
| `bin\.installed-version` | 仍为 **0.2.3** |
| `.pending-update` 占盘 | **327.2 MB** |
| `.qoderwake` 总占盘 | **785.8 MB** |

即：**0.2.4 已下载完毕并暂存了 15 天，从未被应用。** 因为应用时机挂在"下一次重启交接"上，而这 15 天里没发生过重启交接。用户侧的感知是"我一直在最新版"，实际落后一个版本并多占 327 MB。

**对 0.1 的三条硬要求**：

1. **pending update 必须有过期与兼底应用时机**。不能只依赖"下次重启"。至少要有：空闲窗口主动应用 / 超过 N 天未应用则丢弃重下。
2. **pending 状态必须对用户可见**。托盘菜单要能看到"0.2.4 已就绪，重启后生效"并提供一个立即重启按钮。
3. **磁盘预算要有上限与清理**。785 MB 的 profile 里 327 MB 是一份没用上的更新包 —— 我们要在启动时做一次"陈旧 pending / 旧版备份 / 日志"的 GC。

### 8.6 托盘壳：87 KB 原生看门狗

| 实证 | 值 |
|------|-----|
| `qoderwake-tray.exe` | **89,072 字节（87 KB）原生 exe** —— 不是 Electron，不是 Tauri |
| FileVersion | 0.0.20.0 |
| CompanyName / FileDescription | **空** ⚠️ |
| 版本源 | `run\native-shell-version` —— 与 daemon 完全独立 |
| 日志 | `logs\qoderwake-tray.log` —— 与 daemon 日志完全独立 |

**87 KB 这个数字直接回答了主报告 C-4（壳与服务独立）的技术选型问题**：托盘壳不需要任何 UI 框框。它只做四件事（从日志反推）：托盘图标与菜单、探活 daemon、拉起 daemon、开浏览器。任何带 webview 的方案（Electron 100+ MB、Tauri 3–10 MB）在这个职责下都是过度设计。

托盘日志里读出的看门狗语义（直接可択）：

```
run: qoderwake-bootstrapper.exe
healthy daemon resolved on port 19820
run: qoderwake.exe __daemon --host 127.0.0.1 --port 19820
run: qoderwake.exe stop --no-keepalive
runtime activity resolved: conversationTasks=0 triggerTasks=0 preciseConversationTasks=True
daemon process exists but health is not ready; skipping duplicate watchdog start   ← 8/1–8/14 出现 ≈19 次
```

**四条直接択的设计**：

1. **探活不是"进程在不在"，而是"health 就不就绪"**。`daemon process exists but health is not ready` 这行出现 19 次，说明真实世界里"进程活着但不能服务"是**常态而非异常**。只看 PID 的看门狗等于没看门狗。
2. **探活到"进程在但不健康"时选择 skip 而不是重启**。这是对的 —— daemon 可能正在做漫长的启动（实测 11 秒）或迁移，盲重启会造成重启风暴。
3. **托盘不直接拉 daemon，而是先拉 bootstrapper**。与 §8.3 服务路径一致 —— **所有拉起路径都经过 bootstrapper**，只有一个地方知道怎么选版本。
4. **停服前先查运行中活动**（`runtime activity resolved: conversationTasks=0 triggerTasks=0`）。即 **优雅停服需要一个"当前有无在飞任务"的查询接口**，不能拿到 stop 就 kill。我们的 daemon 必须提供这个接口。

**一条风险警示**：托盘 exe 的 `CompanyName` 与 `FileDescription` **都是空的**。一个 87 KB、无发行信息、干的事是"开机常驻 + 拉子进程 + 开本地端口"的原生 exe，在 EDR 与国内比如比特类护航软件眼里是典型可疑样本。**我们的托盘壳必须：完整 VersionInfo + 代码签名。** 这条要进主报告 §11 风险清单。

### 8.7 第二个本地端口：浏览器中继 + Chrome Native Messaging

本机实测存在**两个本地监听端口**：

| 端口 | 来源 | 用途 |
|------|------|------|
| **19820** | `run\daemon.info.json` / `daemon.port` | daemon 主 HTTP 口 |
| **16789** | `run\browser-relay-port.json` | 浏览器中继 |

并且有一条完整的 **Chrome 原生消息通道**：

| 环节 | 实证 |
|------|------|
| manifest | `run\com.qoder.work.connector.json`：`type: stdio`、4 个 `chrome-extension://` allowed_origins |
| 注册 | **HKCU** `\Software\Google\Chrome\NativeMessagingHosts\com.qoder.work.connector`（**Edge 未注册**）|
| 入口 | `run\browser-native-messaging-host.bat` —— 设 `QODERWAKE_HOME` / `QODERWAKE_BUILD_REGION` 后调 `qoderwake.exe "__browser_native_host"` |
| 自带扩展 | `resources\browser-connector\chrome-extension\`（未打包扩展目录，随安装包分发）|

**四条启示**：

1. **我们确认不要双端口（§6.3 已列），但要理解他为何需要第二个**：浏览器中继的安全域与 daemon 不同（前者要接受来自页面上下文的连接）。如果我们未来真要做浏览器集成，分端口比在同一端口上做路径级鲉鱼更安全。**双端口不是随意，是安全域隔离。**
2. **Native Messaging Host 是个很巧的免端口方案**：stdio 通道、由 Chrome 拉起、`allowed_origins` 白名单靠浏览器强制 —— 比自己开 HTTP 端口再验 Origin 安全得多。如果我们做浏览器侧能力，优先这条路。
3. **只注册了 Chrome 没注册 Edge** 是个现成的教训：国内企业 Windows 环境 Edge 占比很高，这直接意味着功能对一部分用户默默失效。**注册要覆盖 Chrome + Edge + 国产 Chromium 系**。
4. **`__` 前缀的隐藏子命令是个好约定**：`__daemon`、`__browser_native_host` —— 与用户面 `start` / `stop` 区分开，不进 `--help`。我们的 CLI 可以直接用这个约定。

### 8.8 底座随包分发、影子 skill 与插件清单 schema（对 UPP 最有价值的一节）

#### 8.8.1 底座 CLI 随包分发

`bin\qodercli-wake.exe` = **160,642,032 字节的底座 CLI 本体**，并且 `installer\payload\qodercli\qodercli-wake.exe` 说明它是**随安装包一起分发**的，不是"用户自己装好 CLI 我去调"。

这与 Multica 的选择正好相反（后者明确声明"Multica drives them; it doesn't ship them"）。两种模式的权衡：

| | 随包分发（QoderWake）| 依赖已装（Multica）|
|--|--------------------|-------------------|
| 安装体积 | +160 MB | 0 |
| 版本确定性 | ✅ 完全可控 | ❌ 用户装的任意版本 |
| 凭据复用 | ❌ 自己一套登录 | ✅ 复用用户已登录的 CLI |
| 多底座 | ❌ 只能自家 | ✅ 23 个 |

**我们的口径（写进 UPP 设计）**：0.1 走"依赖已装 + 严格版本探测与下限断言"，因为我们的定位是**多底座适配**，随包分发在多底座下体积不可接受（N × 160 MB）。但要把"探测到的 CLI 版本不在支持区间"当一类一等错误，而不是跑到一半才报奇怪错。

#### 8.8.2 影子 skill 注入

`resources\shadow-skills\.agents\skills\skill-creator\SKILL.md`（2,910 B）。

路径里的 `.agents/skills/` 是**底座约定的 skill 目录**。即：它把自己的能力以"影子 skill"形式**注入到底座的约定目录**，而不是要求底座提供插件 API。

**这对 UPP 是一条关键证据**：在底座没有统一插件协议的现实下，**"向底座约定目录投递文件"是最低成本且最通用的适配面**。与 Multica 的做法不谋而合（它把 system prompt 以 `CLAUDE.md` / `AGENTS.md` / `CODEBUDDY.md` / `QWEN.md` 投递到 workdir，而不是走 CLI 参数）。两份独立证据指向同一结论：

> **UPP 的第一类适配面应当是"文件系统约定"，而不是"API 调用"。** 因为前者对每个底座都成立，后者只对愿意开放的底座成立。

#### 8.8.3 插件清单 schema（实测完整字段）

`resources\plugins\` 下两类插件：

| 类型 | 实例 | 形态 |
|------|------|------|
| `agent-loops/` | `qa-support-loop` | `src/loop.ts` + `src/management.tsx` + **`ui/management.js`（≈ 1 MB 管理界面 bundle）** + `package.json` + `qoderwake-plugin.json` |
| `trigger-event-sources/` | `aone` / `dingtalk` / `github-hook` | Python 或 TS runtime + `qoderwake-plugin.json` |

`qoderwake-plugin.json` 的字段结构（以 `github-hook` 为例）：

```
schemaVersion: "qoderwake.plugin.v1"      ← 带命名空间的 schema 版本
name / version / displayName / description
forceUpgrade: true                        ← 强制升级开关
capabilities:
  trigger:
    webhookEventSources[]:
      kind / displayName / order
      hookType / sourcetype
      identity.sourceScopeIdField          ← 多租户识别字段
      configSchema: { … }                  ← 标准 JSON Schema（含 pattern 校验）
      uiSchema:                            ← 宕主渲染表单的布局声明
        layout: [[…], […]]                  二维数组 = 行/列
        fields.<name>: { widget, label, placeholder }
      defaults: { … }
      runtime.module: "…"                  ← 入口模块
```

**这是本次实证对 UPP 设计最直接可用的一份实例。四条可択**：

1. **`schemaVersion` 带命名空间而不是裸版本号**（`qoderwake.plugin.v1` 而不是 `"1"`）。好处是一份 JSON 落在地上也能自证身份。UPP 应用 `upp.plugin.v1` 这个形式。
2. **`capabilities` 分类嵌套而不是平铺列表**（`capabilities.trigger.webhookEventSources[]`）。宕主只需读自己认识的能力分类，不认识的整块忽略 —— **能力前向兼容的关键**。
3. **`configSchema`（JSON Schema）+ `uiSchema`（布局）分开**。插件只声明"我需要哪些配置、长什么样"，**宕主负责渲染表单** —— 插件不带前端代码、不能注入 UI。这比 `agent-loops` 那种自带 1 MB `ui/management.js` bundle 安全得多。**UPP 应强制声明式 UI，禁止插件带前端 bundle。**
4. **`identity.sourceScopeIdField`**：插件声明"我的事件里哪个字段是租户/仓库身份"，宕主拿它做路由与隔离。多租户从第一天就在 schema 里，而不是后加。

另三个 `resources\` 子目录也值得记一笔：

| 目录 | 内容 | 启示 |
|------|------|------|
| `security\tool-guard-rules\dangerous_shell_commands.json` | 21,330 B | **危险命令拦截规则作为数据外置**，可随渠道更新而不需发版。我们的 tool guard 应照做 |
| `sqlite-vec\windows-x64\vec0.dll` | 304,112 B | **本地向量检索走 sqlite 扩展**而不是引入向量库 —— 与我们记忆子系统选型相关 |
| `builtin-skills\qoderwake-assistant\` | `SKILL.md` 32,510 B + `references/cli-commands.md` 30,264 B | **把自己的 CLI 用法写成 skill 给 agent 读** —— 即 agent 通过自家 CLI 反向驱动宕主（与 Multica 的 "Multica CLI skill" 同一思路）|

### 8.9 运行时状态文件、日志与磁盘

#### 状态文件分层（`run\` 目录）

| 文件 | 内容 | 作用 |
|------|------|------|
| `daemon.info.json` | pid / port / host / startedAt / version / uid / instanceId | **完整句柄**（客户端读这一份就够）|
| `daemon.pid` / `daemon.port` / `daemon.lock` | 单值 | **兼容层**：shell 脚本 / 托盘等非 JSON 读者 |
| `daemon.workers.json` | `schemaVersion: 2`；worker 条目含 sessionId / pid / pgid / agentId / startedAt / status / workerId / buildRegion / qoderwakeHome / lastSeenAt | **孤儿进程回收账本** ⭐ |
| `browser-relay-port.json` | port 16789 | 第二通道（§8.7）|
| `native-shell-version` / `windows-tray-path` / `windows-tray-first-launch` / `windows-tray-launch-at-login-defaulted` | 单值/时间戳 | **哨兵文件记录"这个一次性动作已做过"** |
| `com.qoder.work.connector.json` / `browser-native-messaging-host.bat` | — | Chrome 通道（§8.7）|

**两条直接択**：

1. **`daemon.workers.json` 这份账本是必需品**。字段里同时有 `pid` 与 **`pgid`** —— 因为杀一个 agent 会话要杀整个进程组（agent CLI 下面还有它自己拉的 shell / 编译器）。`lastSeenAt` 支持 daemon 重启后判定哪些 worker 是孤儿。**这是我们必须在 0.1 就做的，因为一旦孤儿进程积累，用户机器会被拖坠且无从排查。**
2. **哨兵文件比配置项更适合记录一次性动作**。`windows-tray-launch-at-login-defaulted` 区分了"用户选了 false"与"我们默认过一次且用户没改"—— 这两种状态在单个布尔配置项里无法表达，导致的 bug 是"用户关了自启，升级后又被打开"。

#### 降级保护

`data\.pre-upgrade-backup-state.json`：`storageSchemaVersion: 8` + `lastOpenedByVersion: 0.2.3`。

两个字段分别回答两个不同的问题：前者管"这份数据能不能被当前代码读"，后者管"用户是不是在降级"。**我们的存储层从第一天就要写这两个字段**，否则日后无法安全拒绝降级启动。

#### 日志与磁盘（两个反面教材）

| 项 | 实测 | 问题 |
|----|------|------|
| `logs\qoderwake.log` | **14,400,737 B 单文件无轮转** | 而 WinSW 那条路径反而配了 10 MB roll-by-size（§8.3）—— **轮转被当成了 keepalive 的附属能力，而不是日志子系统的能力** |
| `.pending-update` | **327.2 MB 悬挂 15 天** | §8.5 |
| `.qoderwake` 总计 | **785.8 MB** | 一个"已安装到 C:\Software"的软件在用户目录又占 785 MB |

其余日志分层是对的，可択：`qoderwake.log`（主）/ `qoderwake_lifecycle.log`（生命周期）/ `qoderwake-tray.log`（壳）/ `conversation-trace.log`（业务追踪）—— **四类日志各自成文件，因为他们的读者不同（开发 / 运维 / 支持 / 业务）**。

### 8.10 Windows 实证带来的新增与修正动作清单

| # | 动作 | 落点 | 优先级 |
|---|------|------|--------|
| W-1 | Windows keepalive 默认路径改为"托盘看门狗"，计划任务降为第三备选 | 主报告 §7.1 | P0 |
| W-2 | T4 验收加"杀掉托盘进程后服务能否恢复" | 主报告 §13 | P0 |
| W-3 | 看门狗探活必须是 health 而非 PID；"进程在但不健康"时 skip 不重启 | 主报告 §7.3 | P0 |
| W-4 | 所有拉起路径经过 bootstrapper；服务/任务指向 bootstrapper 不指向业务二进制 | 主报告 §6 | P0 |
| W-5 | pending update 需过期 + 空闲窗口兼底应用 + 用户可见且可手动触发 | 主报告 §9 | P0 |
| W-6 | 启动时做一次磁盘 GC（陈旧 pending / 旧备份 / 日志），profile 磁盘预算设上限 | 主报告 §9 | P1 |
| W-7 | 日志轮转属于日志子系统，所有启动路径一律生效（roll-by-size + keepFiles） | T10 | P0 |
| W-8 | 托盘壳用原生小二进制（参考值：87 KB 就够），不引 webview 框框 | 主报告 §6 C-4 | P0 |
| W-9 | 新增风险 R-13：无签名/无 VersionInfo 的常驻 exe 被 EDR/护航软件拦。缓解：完整 VersionInfo + 代码签名 | 主报告 §11 | P0 |
| W-10 | 安装默认 per-user 免 UAC，装到 `%LOCALAPPDATA%\Programs\`；企业 per-machine 另出变体 | 主报告 §6 | P0 |
| W-11 | 卸载/修复/排障共用一份独立清理脚本 | 主报告 §6 | P1 |
| W-12 | 三件版本统一报一个用户可见版本；Uninstall 项 `DisplayVersion` = 服务版本 | 主报告 §9 | P1 |
| W-13 | CI 拒绝 `-dirty` 构建；三平台锁同一运行时版本；发布物 VersionInfo 重写 | 主报告 §9.2 | P1 |
| W-14 | worker 账本（pid + **pgid** + lastSeenAt）与孤儿进程回收，0.1 必做 | 主报告 §7.5 | P0 |
| W-15 | 存储层写 `storageSchemaVersion` + `lastOpenedByVersion`，拒绝降级启动 | T存储 | P0 |
| W-16 | 哨兵文件记录一次性动作，与用户配置项分开 | 工作台设计 | P1 |
| W-17 | 日志统一 UTF-8，`.cmd` 先 `chcp 65001` | T10 | P1 |
| W-18 | 浏览器扩展注册要覆盖 Chrome + Edge + 国产 Chromium（若做浏览器集成） | 0.2+ | P2 |
| W-19 | UPP 插件清单采用 `upp.plugin.v1` + `capabilities` 分类嵌套 + `configSchema`/`uiSchema` 分离 + 租户识别字段；**禁止插件带前端 bundle** | UPP 规范 v0.3 | P0 |
| W-20 | UPP 第一类适配面定为"向底座约定目录投递文件"（影子 skill 模式），而不是依赖底座提供插件 API | UPP 规范 v0.3 | P0 |
| W-21 | 危险命令拦截规则作为可热更新的数据外置，不编译进二进制 | 安全设计 | P1 |
| W-22 | 0.1 底座走"依赖已装 + 严格版本探测与下限断言"，不随包分发 CLI | UPP 规范 | P0 |

其中 **W-19 / W-20 / W-22** 与同日的 Multica 调研结论交叉验证，详见 [Multica 深度调研](Multica深度调研-底座调用与协同编排-2026-08-20.md)。

---

## 9. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-20 | 初版：Linux 侧 Bun 二进制拆解（§0–§7）|
| 2026-08-20 | 补 Windows 侧运行时实证（§8）；修正 §5.3 的 keepalive 主路径推断；确认 §5.5 交接机制并量化；§2 补 Windows Bun 版本漂移 |

