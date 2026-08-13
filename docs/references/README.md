# 参考引用来源

## 开源仓库

| 来源 | 仓库 URL | 参考内容 |
|------|---------|---------|
| 数字员工 1.0 版本 | [KDevSec/agents-team](https://github.com/KDevSec/agents-team) | 编排引擎 R1/R2/R3、工程记忆制度、员工包结构、四底座适配 |
| TencentDB Agent Memory | [TencentCloud/tencentdb-agent-memory](https://github.com/TencentCloud/tencentdb-agent-memory) | L0-L3 记忆蒸馏管线、MemoryProxy（API 劫持注入）、Skill 提取、OTLP 原生支持 |
| MemOS | [MemTensor/MemOS](https://github.com/MemTensor/MemOS) | 优先级衰减公式、R_human 三轴评分、gain 评估、skill 结晶化验证器、feedback 修正 |
| Orkas | [Orkas-AI/Orkas](https://github.com/Orkas-AI/Orkas) | visibility slicing、context budget 算术派生、多信号反思触发、LocalBackend 单一 run 入口 |

> 以上仓库的源码已 clone 到本地 `references/` 目录（gitignored），用于深度分析。详见 [TencentDB vs MemOS 深度对比](../research/TencentDB-vs-MemOS深度对比-源码级-2026-08-13.md)。

## UI 参照

### QoderWaker

工作台的交互前端以 QoderWaker 为 UI 功能参照。截图见 [QoderWaker/](./QoderWaker/)（7 张）：

| 截图 | 参照模块 |
|------|---------|
| `员工详情.png` | 我的员工 → 员工详情页（多 tab：首页/项目/任务/记忆/技能/知识库/连接器/权限） |
| `新建Waker.png` | 我的员工 → 员工创建向导（角色模板 → 身份 → skill 从 AgentHub 拉 → 约束 → 生成） |
| `workflow.png` | workflow 编排 → SOP 可视化编辑器（Canvas + Script 双视图） |
| `任务看板.png` | 任务看板 → List/Lanes 双视图 + Approval Workbench |
| `环境与设备.png` | 底座与环境管理 → 底座卡片 + 版本漂移矩阵 |
| `对话界面.png` | 对话界面 → 与员工/群组直接对话 + 任务建议卡片 |
| `本地运行.png` | 工作台本地运行形态（独立应用，Web 访问） |