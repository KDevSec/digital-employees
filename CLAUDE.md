# 数字员工套件 2.0 —— 项目指引

> 本文件是本仓库的顶层约束根文档。

## §1 项目定位

数字员工套件 2.0 = **工作台（独立应用）+ 员工包 + 管控平台（远端 Web）** 三层分离的全新架构。

| 层 | 在哪 | 形态 | 职责 |
|----|------|------|------|
| 工作台 | `workbench/` | **独立应用**（exe/CLI 安装，启动本地 Web 服务，浏览器访问） | 编排引擎/员工注册/多底座适配/工程记忆/合规监督 + 交互前端 |
| 员工包 | 独立交付单元 | 文件包（安装到智能体底座） | AGENTS.md + skills + hooks + mcp.json + orchestration |
| 管控平台 | `platform/` | 远端 Web 服务 | 员工市场/运营驾驶舱/成本/审计 |

**关键区分**：
- **工作台 ≠ 安装到底座**。工作台是独立的管理端（类似 QoderWaker），通过 Web UI 管理员工
- **员工包 = 安装到底座**。员工包文件通过四层适配器落位到各智能体底座（CC/CB/Qoder 等），底座加载后成为该员工

## §2 核心架构决策（不可推翻，除非走 Q 决策流程）

1. **单 Agent + 多 Skill** 形态——不再有多 Agent 主从结构
2. **四层正交适配**——MCP（工具）+ CC Hooks（hook）+ AGENTS.md（指令）+ MemoryProxy（记忆注入）
3. **工作台是独立应用**——exe/CLI 安装，启动本地 Web 服务，参照 QoderWaker 的 UI 形态
4. **员工包必须安装到底座**——安装 = 文件位置映射，不安装底座不知道"我是谁"
5. **编排引擎是通用底座**——不感知具体员工，支持编排对象无关性
6. **工程记忆跨员工共享**——记忆是运行层能力，文件基底（markdown + JSONL）

## §3 设计文档

文档总入口与导航索引：`docs/README.md`。`docs/design/` **按设计深度划分**（概要设计/ + 详细设计/，跨阶段过程记录留根目录）；调研与评估报告在 `docs/research/`（只增不改）。对架构做任何改动前，MUST 先读架构白皮书。文档出新版本时旧版本移入 `docs/archive/`（当前版本留在分类目录）。

## §4 参考来源

- 1.0 版本：https://github.com/KDevSec/agents-team
- QoderWaker：UI 功能参照（截图见 `docs/references/QoderWaker/`）
- TencentDB Agent Memory：https://github.com/TencentCloud/tencentdb-agent-memory
- MemOS：https://github.com/MemTensor/MemOS
- Orkas：https://github.com/Orkas-AI/Orkas