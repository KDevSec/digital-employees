# 数字员工套件 2.0

> 工作台（独立应用）+ 员工包 + 管控平台（远端 Web）—— 三层分离的全新架构

## 仓库结构

```
├── docs/
│   ├── design/         设计文档（架构白皮书、UPP协议、扩展配置、交接提示词）
│   ├── context/        当前实现状态与 Agent 交接上下文
│   ├── research/       调研文档（深度调研报告、技术对比、MVP规划）
│   ├── references/     参考引用来源 + QoderWaker UI 参照截图
│   └── prototype/      原型图
├── iam/                Keycloak Realm 与 PostgreSQL 初始化
├── platform/           管控平台（远端 Web）
├── specs/              Spec Coding 规格、决策、计划与任务
├── tools/              构建、启动、部署与真实 E2E 工具
└── workbench/          工作台（独立应用，exe/CLI 安装，Web 访问）
```

## 架构概览

详见 [架构白皮书 v0.7](docs/design/数字员工套件2.0架构白皮书-v0.7.md)

### 三层架构

- **工作台（独立应用）**：exe/CLI 安装，启动本地 Web 服务，浏览器通过部署配置的 `PUBLIC_HOST:19820` 访问。提供编排引擎 + 交互前端 + 多底座适配 + 工程记忆 + 合规监督。**参照 QoderWaker 的 UI 形态**
- **员工包**：AGENTS.md + skills/ + hooks/ + mcp.json + orchestration/，可独立安装/卸载/升级。**员工包安装到智能体底座**（CC/CB/Qoder 等），底座加载后成为该员工
- **管控平台（远端）**：员工市场 + 运营驾驶舱 + 成本/审计 + 跨开发者运行可见

### 核心决策

- 员工形态：**单 Agent + 多 Skill**
- 多底座：**四层正交适配**（MCP + CC Hooks + AGENTS.md + MemoryProxy）
- 工作台：**独立应用**（exe/CLI → Web 服务），不是安装到底座
- 员工包：**必须安装到底座**（安装 = 文件位置映射）

## 文档

### 架构与协议

- [架构白皮书 v0.7](docs/design/数字员工套件2.0架构白皮书-v0.7.md)
- [UPP 协议规范 v0.2](docs/design/UPP通用插件协议规范-v0.2-开放标准薄封装.md)
- [扩展配置具体内容 v0.1](docs/design/数字员工扩展配置具体内容-v0.1.md)
- [MVP 规划](docs/research/新仓MVP规划+技术调研结论-2026-08-12.md)
- [交接提示词 - 待调研难点](docs/design/交接提示词-深度调研待办-2026-08-13.md)

### §4 设计阶段产出（2026-08-13）

按交接文档 §4 完成的四份设计文档（统一九章骨架，可并行评审/开发）：

- [员工新建设计 v0.1](docs/design/员工新建设计-v0.1.md) —— 创建向导五步 / 员工包生成规则 / 内置角色模板库
- [员工安装与底座适配设计 v0.1](docs/design/员工安装与底座适配设计-v0.1.md) —— 四层适配落位（CB/Qoder/CC 写透）/ 能力协商 / 安装报告 / 卸载 / AgentHub 契约
- [员工运行与展示设计 v0.1](docs/design/员工运行与展示设计-v0.1.md) —— 列表页 / 详情页十 tab / 对话界面 / 状态机与任务看板
- [登录与认证设计 v0.1](docs/design/登录与认证设计-v0.1.md) —— 邮箱登录 / JWT 双 token / 治理分级 L1-L4 权限对齐

配套过程记录：

- [设计决策记录（ADR）](docs/design/设计决策记录-2026-08-13.md) —— D-001~D-014 横切决策
- [待讨论问题清单](docs/design/待讨论问题-2026-08-13.md) —— Q-001~Q-014 待拍板事项

### 管理平台 V0.1

- [功能规格](specs/001-management-platform-v0-1/spec.md)
- [部署与外部访问设计](docs/design/管理平台V0.1部署与外部访问设计.md)
- [开发交接上下文](docs/context/管理平台V0.1开发交接-2026-08-16.md)

启动验收环境：

```bash
PUBLIC_HOST=<虚拟机IP或DNS名> ./tools/up.sh
```

也可复制 `tools/.env.example` 为 `tools/.env`。启动脚本会统一配置管理平台、Keycloak、工作台、OIDC issuer 和回调地址，并输出最终访问 URL。
