# 数字员工套件 2.0 —— 项目指引

> 本文件是本仓库的顶层约束根文档。

## §1 项目定位

数字员工套件 2.0 = **工作台（本地客户端）+ 员工包 + 管控平台（远端 Web）** 三层分离的全新架构。

| 层 | 在哪 | 职责 |
|----|------|------|
| 工作台 | `workbench/` | 编排引擎/员工注册/多底座适配/工程记忆/合规监督 + 交互前端 |
| 员工包 | 独立交付单元 | AGENTS.md + skills + hooks + mcp.json + orchestration |
| 管控平台 | `platform/` | 员工市场/运营驾驶舱/成本/审计 |

## §2 核心架构决策（不可推翻，除非走 Q 决策流程）

1. **单 Agent + 多 Skill** 形态——不再有多 Agent 主从结构
2. **四层正交适配**——MCP（工具）+ CC Hooks（hook）+ AGENTS.md（指令）+ MemoryProxy（记忆注入）
3. **员工包必须安装到底座**——安装 = 文件位置映射，不安装底座不知道"我是谁"
4. **编排引擎是通用底座**——不感知具体员工，支持编排对象无关性
5. **工程记忆跨员工共享**——记忆是运行层能力，文件基底（markdown + JSONL）

## §3 设计文档

所有设计文档在 `docs/design/`，调研文档在 `docs/research/`。对架构做任何改动前，MUST 先读架构白皮书。

## §4 参考来源

- 1.0 版本：https://github.com/KDevSec/agents-team
- TencentDB Agent Memory：https://github.com/TencentCloud/tencentdb-agent-memory
- MemOS：https://github.com/MemTensor/MemOS
- Orkas：https://github.com/Orkas-AI/Orkas