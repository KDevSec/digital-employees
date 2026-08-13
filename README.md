# 数字员工套件 2.0

> 工作台（独立应用）+ 员工包 + 管控平台（远端 Web）—— 三层分离的全新架构

## 仓库结构

```
├── docs/
│   ├── design/         设计文档（架构白皮书、UPP协议、扩展配置、交接提示词）
│   ├── research/       调研文档（深度调研报告、技术对比、MVP规划）
│   ├── references/     参考引用来源 + QoderWaker UI 参照截图
│   └── prototype/      原型图
├── workbench/          工作台（独立应用，exe/CLI 安装，Web 访问）
└── platform/           管控平台（远端 Web）
```

## 架构概览

详见 [架构白皮书 v0.7](docs/design/数字员工套件2.0架构白皮书-v0.7.md)

### 三层架构

- **工作台（独立应用）**：exe/CLI 安装，启动本地 Web 服务，浏览器访问 `localhost:19820`。提供编排引擎 + 交互前端 + 多底座适配 + 工程记忆 + 合规监督。**参照 QoderWaker 的 UI 形态**
- **员工包**：AGENTS.md + skills/ + hooks/ + mcp.json + orchestration/，可独立安装/卸载/升级。**员工包安装到智能体底座**（CC/CB/Qoder 等），底座加载后成为该员工
- **管控平台（远端）**：员工市场 + 运营驾驶舱 + 成本/审计 + 跨开发者运行可见

### 核心决策

- 员工形态：**单 Agent + 多 Skill**
- 多底座：**四层正交适配**（MCP + CC Hooks + AGENTS.md + MemoryProxy）
- 工作台：**独立应用**（exe/CLI → Web 服务），不是安装到底座
- 员工包：**必须安装到底座**（安装 = 文件位置映射）

## 文档

- [架构白皮书 v0.7](docs/design/数字员工套件2.0架构白皮书-v0.7.md)
- [UPP 协议规范 v0.2](docs/design/UPP通用插件协议规范-v0.2-开放标准薄封装.md)
- [MVP 规划](docs/research/新仓MVP规划+技术调研结论-2026-08-12.md)
- [交接提示词 - 待调研难点](docs/design/交接提示词-深度调研待办-2026-08-13.md)