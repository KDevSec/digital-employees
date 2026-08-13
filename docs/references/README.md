# 参考引用来源

本项目的架构设计和技术调研参考了以下开源仓库：

| 来源 | 仓库 URL | 参考内容 |
|------|---------|---------|
| 数字员工 1.0 版本 | [KDevSec/agents-team](https://github.com/KDevSec/agents-team) | 编排引擎 R1/R2/R3、工程记忆制度、员工包结构、四底座适配 |
| TencentDB Agent Memory | [TencentCloud/tencentdb-agent-memory](https://github.com/TencentCloud/tencentdb-agent-memory) | L0-L3 记忆蒸馏管线、MemoryProxy（API 劫持注入）、Skill 提取、OTLP 原生支持 |
| MemOS | [MemTensor/MemOS](https://github.com/MemTensor/MemOS) | 优先级衰减公式、R_human 三轴评分、gain 评估、skill 结晶化验证器、feedback 修正 |
| Orkas | [Orkas-AI/Orkas](https://github.com/Orkas-AI/Orkas) | visibility slicing、context budget 算术派生、多信号反思触发、LocalBackend 单一 run 入口 |

> 以上仓库的源码已 clone 到本地 `references/` 目录（gitignored），用于深度分析。详见 [TencentDB vs MemOS 深度对比](../research/TencentDB-vs-MemOS深度对比-源码级-2026-08-13.md)。