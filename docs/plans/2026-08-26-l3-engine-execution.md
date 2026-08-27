# L3 编排引擎线执行记录（I1 · 2026-08-26/27 通宵 · 十任务全交付）

> 计划：[2026-08-26-l3-engine.md](2026-08-26-l3-engine.md)（状态随本文转 ✅）｜设计：[协同编排设计 🟢](2026-08-26-协同编排-design.md)
> 执行方式变更（已报备授权）：subagent 通道自 T4 修复起连续 3 次工具注入故障（Read/Write/Edit/Bash/Glob/Grep 均未随会话加载，实现/只读审查均不可执行）——T4 修复起全部任务主会话 inline 执行（真红绿 TDD 纪律不变，测试数据全绿实证）
> 基线 → 终态：engine 0 → **112 绿**（108 + 独立复审修复批 4）；service 126 → **150 绿**；web 224 回归不动；全部分包 vitest 口径（根 bun test 扫非 workspace 目录的 163 固有失败与改动无关——T1 时 stash 实测基线即如此）

---

## 1. 一夜执行摘要（对照十任务）

| # | 任务 | 提交 | 测试 | 状态 |
|---|------|------|------|------|
| T1 | 契约真源（I0-4：node-table/events schema + demo 表） | bfb796d | +26 | ✅ 单审双 PASS |
| T2 | R2 节点机（adjacency/guard/bounded reflow） | 6bc246f+eaa8bb2 | +21 | ✅ 单审双 PASS（含 T1 流转顺手项） |
| T3 | R3 三类 gate（两套溢出语义） | 961e5fd+31d3bcb | +17 | ✅ 单审 9/9+Quality PASS |
| T4 | R1 账本（单级 task+事件流+归档） | 2823352 | +12 | ✅ 实现 → 单审拦 🟡1 布局偏离 D-045 |
| T4r | 修复：布局回归+索引+占用兜底+三收口 | c6c4d62 | +8（12→20——独立复审 ⚪1 更正计数） | ✅ inline 闭环 + **独立复审通过**（[2026-08-27-T4修复独立复审.md](2026-08-27-T4修复独立复审.md)：🟡1~5 处置见修复批提交） |
| T5 | 引擎门面（11 操作+emitter，E1~E7+fixture） | 8c2cb68 | +12 | ✅ inline（含 2 处实现缺陷自纠） |
| T6 | HTTP API（12 端点+zod+Ctx.query 扩展+main 装配 ensure 表） | 3f2326d | +6 | ✅ inline |
| T7 | SSE（帧/重放/心跳/过滤+Res.stream/Ctx.headers 扩展） | c947467+6e62480 | +6 | ✅ inline（id 复合形式修订） |
| T8 | MCP 挂载（/mcp 例外口+11 工具，spike 同版本依赖） | d36ad84 | +4 | ✅ inline |
| T9 | 驱动器+spawn runner（mock launcher 全自动闭环） | edb2654 | +8 | ✅ inline（U3/U4/U5 进程内形态） |
| T10 | secretgate TS 移植（22 规则+12 豁免+PEM） | 2eb4bbb | +11 | ✅ inline（g 标志移植坑自纠） |
| 冒烟修复 | toHonoApp 组装顺序（404 bug） | acc71d9 | — | ✅ dev 冒烟实锤 |

**dev 冒烟（19984，临时 WORKBENCH_HOME，测毕清理）**：healthz ✓ → flows（ensure demo 表落位 ✓）→ createTask(solo) → advance → events 拉取（完整载荷）→ MCP initialize（serverInfo devzero-engine）→ tools/list **11 工具全名** ✓。

**交付物合计**：@devzero/engine 纯库（schema/R1/R2/R3/门面/secretgate，108 测试）+ service 编排域（HTTP 12 端点 + SSE + MCP /mcp + 驱动器 + spawn runner mock，150 测试）+ 契约真源三件（demo 表/schema/events 类型）+ **L5 fixture**（`workbench-engine/test/fixtures/demo-run-events.jsonl`——五阶段全链 30 事件含一次 FAIL 回流）+ full-14 兼容表 fixture。

## 2. 执行期裁决清单（占位号，待白天统一编真号入决策记录——现到 D-048）

| 占位 | 裁决 | 一句话理由 |
|------|------|-----------|
| **D-049** | SSE 事件 id 采用复合形式 `<task_id>:<seq>`（设计 §8 字面 `id:<seq>` 的修订） | seq 为 per-task 计数，多任务订阅下跨任务不可比——EventSource 重放需复合 id 解析；单任务语义不变。**影响面：看板 fixture 不受影响**（events.jsonl 本体不变，仅 SSE 帧的 id 行）；L5 消费 SSE 时重放解析按复合格式 |
| **D-050** | spawn 失败挂起语义 = 驱动器侧停派（suspendedTasks 可观测），任务状态保持 in_progress 停在节点 | 引擎 11 操作无 setBlocked（契约未列）；挂起不做引擎级状态污染——L0 人接管或无状态重启天然重试；若需引擎级 blocked 留契约演进 |
| **D-051** | T4 账本布局回归 D-045 的工作区形态 + 新增 `tasks-index.json` 轻量索引件 | T4 首版实现误用 dataDir 布局（任务书错误指令），reviewer 依「架构裁决不可静默推翻」拦截；索引是工作区布局下的必要补充（活动任务分散各 workspace 的定位/列表之源）。**索引 schema 已随实现测试锁定，设计 §7.1 补充说明待白天回写** |

## 3. 跳过项与待办

| 项 | 原因 | 归宿 |
|----|------|------|
| spawn runner 真机 launcher | 授权纪律：夜里不做真实 LLM 派单；且依赖 L2 adapter `launch()`（I2 交付） | I2（Launcher 接口已就位——`LaunchRequest` 契约 + mock 已验全流程） |
| T4 修复独立复审 | subagent 通道故障，inline 自审局限 | 建议 subagent 恢复后补一轮（或人工抽看 c6c4d62） |
| MCP 多客户端 per-session transport | spike 未压测（Q5）；当前单 transport（@hono/mcp README 形态） | I2 真机多员工并发时验证（CB/Qoder 多会话同连 /mcp） |
| OR-04 团队装配（7 员工 EmployeeSpec 物化） | 依赖 L1 员工域契约（E-01~03/shared-protocol——I0-3 评审中未定稿），授权「勿自创员工包格式」 | 骨架见 §5；L1 契约冻结后物化（素材全部在手） |
| U7 Windows 进程管理真机形态（超时 kill/孤儿回收） | 同真机 launcher——mock 层已实现超时语义（Promise.race）与失败重试/挂起 | I2 |
| 设计文档 §7.1 补 tasks-index.json 说明 + §8 id 复合形式修订注记 | 契约修订落档纪律（本记录 §2 已记） | 白天随 D-049~051 入决策记录时一并回写设计文档 |

## 4. 契约三件套状态（L5 看板线对齐用）

| 契约 | 状态 | 修订 |
|------|------|------|
| node-table schema | ✅ 冻结基线（T1）+ model_tier/emp/prompt/stage 四新字段随表锁定 | 无修订 |
| events 账本 | ✅ 六类事件+span 基因；**fixture 已产出**（demo-run-events.jsonl） | 无修订（本体不变） |
| SSE 通道 | ✅ T7 实现 | **id 复合形式**（D-049）——L5 EventSource 重放解析注意 `task:seq` 格式；心跳/帧格式/重放语义与设计 §8 一致 |

## 5. OR-04 团队装配骨架（素材就绪，待 L1 契约物化）

七员工素材（persona 按设计 §4.1 + S4 授权措辞模板；skill 素材位置已核）：

| id | persona 要点（≤100 字格式） | skill 素材 |
|----|------------------------------|-----------|
| req-clarifier | 需求结构化：把零散诉求收敛成核验文档，澄清边界与验收口径 | E-11 模板拆分（L1） |
| sys-engineer | 总体设计与技术选型：基于需求产出系统设计 | 同上 |
| dev-engineer | TDD 红绿循环落码，交付可回归验证的提交 | E-11 同源 |
| reviewer-expert | 被 gate 发函的结构化评审（评分表+verdict） | 1.0 reviewer 语义（V0.2 dispatch-table 演进） |
| sec-compliance | 准入/准出安全合规检查：secretgate 扫描输入与交付产物 | **已移植**：`@devzero/engine` security/secretgate.ts |
| sec-design | 设计文档安全审核（12 模块 133 规则语义评审） | zip：`reference-projects/安全skill/sec-scan-design-*.zip`（开箱即用） |
| sec-code | 代码安全扫描（OWASP Top 10 引擎+语义验证） | zip：`sec-scan-code-*.zip`（.venv 40MB 装 home 不进包——install 脚本细节 I2 验证） |

装配动作（L1 契约后）：7 EmployeeSpec 落 `~/.devzero/employees/` → adapt() 落位 digital-staff → registry。demo-flow 表已随 service 首启自动落位（T6 ensure）——发起任务即可引用（当前 emp 引用未装时 createTask 成功、spawn 前置校验报「员工 X 未安装」——I2 联调）。

## 6. 过程坑（新人必读）

1. **bun run typecheck | tail 管道吃非零退出码**——T7 一次 typecheck 红 slipped 提交（自纠 6e62480）；后续全部 `; echo tc=$?` 显式验
2. **toHonoApp 在 registerAllRoutes 前 = 全 404**（routes 数组快照遍历）——单测全绿测不出（测试 buildApp 顺序正确），**dev 冒烟实锤**——收尾冒烟不可省的实证
3. **JS 正则移植 py finditer 必须 g 标志**——否则 exec 死循环（T10 超时实锤，withGlobal 单点收口）
4. python 盲替换字符串易不命中/误吃行（本夜 3 次）——关键文件用 Edit 精修
