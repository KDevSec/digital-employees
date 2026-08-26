# shared-protocol 详细设计（manifest + skill schema · 八类 v0.2）

| 项 | 值 |
|----|-----|
| 版本 | v0.2（**八类顶层重组版**） |
| 日期 | 2026-08-27 |
| 状态 | 🟡 待评审（承接 [员工模板设计](../../plans/2026-08-26-员工模板-design.md) T1~T9 定案；I0-4 契约冻结以此为准） |
| 取代 | v0.1（2026-08-23，已移入 `docs/archive/design/`） |
| 覆盖 | [功能点清单](../概要设计/套件工作台V0.1功能点清单-2026-08-23.md) E-01/E-02/E-03 |
| 输入 | [员工模板设计 T1~T9](../../plans/2026-08-26-员工模板-design.md)（结构唯一源）· [协同编排设计 §6](../../plans/2026-08-26-协同编排-design.md)（node-table 契约独立，本文不覆盖）· D-006/D-015（修订注记见 §5）/D-044/D-047 · 白皮书 v0.8 §5.2（字段经 T7/T8 治理，白皮书 I3 注记升版）· UPP v0.3 §5（骨架对齐经 T6/T7 重构，standards 段废止） |
| 消费方 | workbench-service（包构建/安装/花名册扫描/协商）、workbench-web（表单与展示）、L2 安装线 adapter（requires 推导） |
| 物料基准 | `workbench/templates/`（7 模板 manifest 已按本文结构物化并通过 YAML 校验——实现期的活样例） |

> **v0.2 相对 v0.1 的结构性变化**（详由见员工模板设计 §1 T6~T9）：顶层按**领导八件套（1+7）**重组；六大重复项清理（standards/schema_version/employee_id 落盘/persona.name/tier_map map/requires.capabilities 落盘）；`tools.deny` 新增并接 hooks 编译管线；skill 来源按 D-047 收敛为 `template | local`。

---

## 1 包结构与导出面

```
packages 位：workbench/shared-protocol/          # 注：随 workbench/ 平铺（路线图 engine 包同款），非 packages/
├── src/
│   ├── manifest.ts     # 八类 manifest schema（zod）+ 推导类型
│   ├── skill.ts        # SKILL.md frontmatter + skills[] 条目 schema
│   ├── identity.ts     # id/org 治理 + employeeId 拼装（T8）
│   ├── level.ts        # 使用深度推导（usage_modes → requires.level）
│   ├── derive.ts       # 派生字段推导（capabilities 汇总 / requires.capabilities / tools 展示集）
│   ├── errors.ts       # 结构化校验错误（字段路径）
│   └── gen/            # 生成器：sample + fields.md
├── samples/            # 生成产物（CI drift 对照）
└── test/
```

**导出面**：

```ts
export { manifestSchema, type Manifest } from './manifest.js'
export { skillFrontmatterSchema, skillEntrySchema, type SkillEntry } from './skill.js'
export { employeeId, parseOrg } from './identity.js'          // employeeId(id, org) → `${id}@${org}`
export { deriveLevel } from './level.js'
export { deriveCapabilities, deriveRequires, aggregateTools } from './derive.js'
export { validateManifest, type ValidationResult } from './errors.js'
```

零运行时依赖（除 zod）；不依赖 Bun/Node 专有 API（SEA 回退路径可 import）。

## 2 manifest schema（八类 v0.2）

### 2.1 顶层结构（三层：元数据 / 八件套 / 管理面）

```ts
export const manifestSchema = z.object({
  // ── 元数据（10 项，全部唯一职责；T7/T8 治理后）──
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),        // 唯一标识：目录名/API/表引用；编辑锁定
  display: z.string().min(1),                            // 展示名（渲染单源；persona 不存 name）
  brief: z.string().max(30),                             // 卡片超短标签（≠identity 粒度）
  avatar: z.string().default(''),                        // emoji 池 12 + 图标字兜底
  version: z.string().regex(semver),                     // 包版本（skill 升级 = 重建包 + bump）
  upp_version: z.literal('2.1'),                         // 协议版本（唯一版本号；schema_version 已删 T7）
  kind: z.enum(['flow-owner', 'callee']),                // callee = 被发函评审者，无 orchestration
  org: z.string().min(1).default('local'),               // 现实组织节点（部门粒度；生成定格，E-Q4 语义）
  operator: z.string().email(),                          // 属主邮箱（物化时取登录者；预置物化填占位）
  requires: z.object({ level: z.enum(['L0','L1','L2']) }), // 唯一落盘协商输入（capabilities/optional 推导不落盘）

  // ── 八件套（1 + 7）──
  agent: z.object({                                      // ① Agent 定义（核心的"1"）
    persona: z.object({
      role: z.string(),                                  // 岗位角色线（如 数字员工·开发岗）
      identity: z.string().min(10),                      // 首句 =「# 角色」文案 ≤100 字（卡片截首行）；AGENTS.md 渲染源
      principles: z.array(z.string()).default([]),
      usage_modes: z.array(z.enum(['裸用','+方法论','+流程','+编排'])).min(1),
      // name/capabilities/constraints 不存：display 单源；后两者 derive.ts 自动汇总
    }),
  }),
  skills: z.array(skillEntrySchema).default([]),         // ② 方法论/操作手册（可叠加）
  hooks: z.object({                                      // ③ 关键节点检查拦截
    redlines: z.array(z.object({
      rule_id: z.enum([                                  // 预置规则库（2.0 版：no-ieidev-state → no-devzero-state）
        'no-push-to-main', 'high-risk-via-gate', 'no-devzero-state',
        'no-external-request', 'no-production-access', 'no-db-schema', 'custom',
      ]),
      compiled: z.boolean().default(false),              // true → 构建时编译进 hooks.json（路径C）
    })).default([]),
  }).default({ redlines: [] }),
  tools: z.object({                                      // ④ 工具面板 + 禁用（T9）
    deny: z.array(z.string()).default([]),               // 工具名清单；编译为 PreToolUse 拦截；展示集运行时聚合
  }).default({ deny: [] }),
  commands: z.literal('commands/'),                      // ⑤ 约定路径（V0.1 预留；slash → createTask 语义）
  knowledge: z.literal('knowledge/'),                    // ⑥ 约定路径（V0.1 预留）
  connectors: z.array(z.object({                         // ⑦ MCP（url 型已实证——D-042 引擎连接器同形态）
    name: z.string(),
    type: z.enum(['stdio', 'http']),
    command: z.string().optional(),                      // stdio 型（完整命令串）
    args: z.array(z.string()).default([]),               // stdio 型参数
    url: z.string().url().optional(),                    // http 型
    env: z.record(z.string()).default({}),               // KV（凭证占位不落明文）
    access: z.enum(['read', 'read-write']).default('read-write'),
  })).default([]),
  custom: z.record(z.unknown()).default({}),             // ⑧ 按需扩展位

  // ── 管理面（3 段）──
  constraints: z.object({                                // 运行约束（红线已挪③；默认值 Q-T4 待裁决）
    tier: z.enum(['评审安全档','设计档','探索档','编码档','执行档']).default('编码档'),  // 单值五档（1.0 五档名，编排 Q7）
    token_quota: z.object({
      per_task: z.number().int().positive().optional(),
      monthly: z.number().int().positive().optional(),   // monthly（非 1.0 遗留 daily；对齐上游裁决）
    }).optional(),
  }).default({}),
  governance: z.object({
    level: z.enum(['L1','L2','L3','L4']),                // 治理分级（带前缀纪律 D-011）
    visibility: z.enum(['private','team','department','company']),
    audit: z.enum(['full','exceptions-only']).default('exceptions-only'),
  }),
  orchestration: z.object({                              // 个人流程表（T2：员工自有流程随包；团队流程在工作台库）
    node_table: z.string().regex(/^orchestration\/.+\.node-table\.yml$/),
  }).optional(),                                         // 仅 flow-owner 且 usage_modes 含 +编排（kind=callee 禁有）
}).strict()
```

### 2.2 校验语义（E-01 验收口径）

- 非法 manifest 拒绝且报错定位到字段：zod `path` → `{valid: false, issues: [{path, code, message}]}`
- **跨字段校验**（superRefine）：
  1. `usage_modes` 含 `+编排` → `requires.level === 'L2'` 且 `orchestration.node_table` 必填
  2. `kind === 'callee'` → 不得有 `orchestration`（评审者无自有流程）
  3. `skills` 数组 `name` 不重复（底座 skill 目录 = slug，重名互踩）
  4. `hooks.redlines` 任一 `compiled: true` 或 `tools.deny` 非空 → 构建产物 `hooks/hooks.json` 必须存在（安装期文件校验，schema 层只做声明一致性）
  5. connectors：`type==='stdio'` → `command` 必填；`type==='http'` → `url` 必填（互斥）
  6. `tools.deny` 的工具名不得与 connectors 中已启用 server 的注入工具冲突时静默——deny 优先，记 warning

### 2.3 派生字段（不落盘，消费侧实时推导——derive.ts）

| 派生项 | 规则 | 消费方 |
|--------|------|--------|
| `persona.capabilities` | skills 的能力短语汇总（SKILL.md description 首句） | AGENTS.md「我的能力」段 / 详情页 |
| `persona.constraints` | 红线自然语言版（规则库描述表） | AGENTS.md「我的边界」段 |
| `requires.capabilities` | 推导表（沿用员工新建设计 §4.1）：总是 agent-def+fs-access；skills 非空 +skill-def；runbook/个人表 +bash-exec+slash-command；个人表 +subagent-dispatch | L2 安装线协商输入 |
| `requires.optional` | hooks 非空 → `event:PreToolUse` 等；connectors 非空 → `mcp` | 协商降级映射 |
| `tools` 展示集 | 底座内建（per-host profile）∪ connectors 工具 ∪ 引擎 11 工具，减去 deny | 向导/详情页工具面板 |
| `employee_id` | `employeeId(id, org)` = `${id}@${org}` | 平台交互（AgentCard/上架，V0.2+） |

## 3 skill schema（E-02）

### 3.1 SKILL.md frontmatter（Agent Skills 标准）

```ts
export const skillFrontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),   // = 目录名 = slug（安装约定）
  description: z.string().min(10),                   // 触发召回依据；双引号包裹（CB 严格 YAML 教训）
}).strict()
```

### 3.2 skills[] 条目（D-047 收敛：V0.1 两支 + V0.2 预留）

```ts
export const skillEntrySchema = z.discriminatedUnion('source_type', [
  z.object({                                            // 模板内置（E-11 主路径——模板自带素材）
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    version: z.string().regex(semver),                 // 锁定版本（包自包含）
    source_type: z.literal('template'),
    template_id: z.string(),                           // 来源模板（重建/漂移检测用）
  }),
  z.object({                                            // 本地上传（D-047 V0.1 主路径：zip 解包 → 校验 → 复制进包）
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    version: z.string().regex(semver),
    source_type: z.literal('local'),
    origin: z.string().optional(),                      // 来源说明（zip 文件名等）
  }),
  // z.object({ …source_type: z.literal('agenthub')… })  // V0.2 预留（D-047 后移；字段：namespace/slug/fingerprint）
])
```

**用途**：①安装校验（skills/ 目录与清单一致）；②漂移检测（B-06）；③重建包按 source 取素材（template→templates/ 拷贝；local→提示重传）。

## 4 身份与使用深度

```ts
// identity.ts（T8 治理：employee_id 不落盘，运行时拼装）
export function employeeId(id: string, org: string): string   // → `${id}@${org}`
export function parseOrg(employeeId: string): string          // 兼容读旧包/平台回传

// level.ts（usage_modes → requires.level；被团队流程引用不算自身深度——T2）
// 裸用 → L0；+方法论|+流程 → L1；+编排 → L2（且个人表必填，校验规则 1）
```

## 5 版本与兼容

| 规则 | 内容 |
|------|------|
| 协议版本 | `upp_version: "2.1"` 唯一版本号（schema_version 已删，T7）；schema 演进 bump minor、破坏性 bump major |
| 未知字段 | `.strict()` 拒绝（manifest 是协议文件；⑧custom 是合法自由位） |
| 前向兼容 | 旧工作台读新包：`upp_version` 高于支持 → **安装期拒绝**并提示升级（对齐 S-09 语义） |
| D-015 修订注记 | 分层语义不变（本地一律纯 id；`id@org` 仅平台交互），实现从「双落盘字段」改为「id + org 拼装」——id 编辑锁定保证不漂移 |
| UPP 注记 | v0.3 standards 段在 2.0 实现版**废止**（八类字段存在性即声明，路径固定约定）；I3 给 UPP 加注记 |
| 旧包迁移 | v0.1 形态包（standards/employee_id 落盘等）→ 迁移器一次转换（V0.1 无存量包，仅测试用例覆盖） |

## 6 生成器（E-03）

```
pnpm gen  → samples/manifest.sample.yml（全量字段 + _comment）
         → samples/skill-frontmatter.sample.md
         → samples/fields.md（字段表：路径/类型/必填/默认/说明 + 八件套消歧段）
CI: pnpm gen && git diff --exit-code samples/
```

- 注释同源 `.describe()`；fields.md 顶部自动生成「八件套 ↔ 字段」导航与易混消歧（①agent vs ②skills：身份 vs 方法论；③hooks vs ④tools.deny：拦截规则声明 vs 工具开关，执行汇流于同一编译器）
- **活样例**：`workbench/templates/*/manifest.yml`（7 份）纳入 CI 校验（zod 全过 + 与 schema drift 检查）——模板即最大的 sample 集

## 7 测试与验收

| 功能点 | 验收 | 形态 |
|--------|------|------|
| E-01 版本号 | `upp_version` 字面量存在且被校验 | 单测 |
| E-01 非法定位到字段 | 缺必填/类型错/跨字段矛盾/未知字段逐个断言 issue.path（§2.2 六规则全覆盖） | 单测（表驱动） |
| E-01 八类结构 | 7 份模板物料全过 schema（活样例） | CI |
| E-02 skill 兼容 | zip 上传样本（sec-scan 两 zip）+ 模板素材过 skillEntry 校验 | 单测（fixture） |
| E-03 drift | 改 schema 不跑 gen → CI diff 失败 | CI |
| 派生字段 | deriveCapabilities/deriveRequires/aggregateTools 表驱动 | 单测 |
| T8 身份 | employeeId/parseOrg 往返；旧格式读兼容 | 单测 |

## 8 开放问题

| # | 问题 | 临时立场 |
|---|------|---------|
| P2-Q1 | `custom` 自由位的深度 schema（未来按需收紧子键） | record 自由对象；出现高频键后再升级 |
| P2-Q2 | `tools.deny` 与 CC 系原生 `permissions.deny` 的映射优先级（hooks vs permissions 双通道） | V0.1 统一走 hooks 编译；CC 系映射优化 V0.2 |
| P2-Q3 | connectors 的 stdio `command` 完整串拆分 args 的规则（手写包作者易混） | 生成器侧校验提醒；sample 示范双写法 |
| P2-Q4 | org 粒度与平台组织树（specs/002）接入后的取值 | 部门粒度；V0.1 默认 local（员工模板设计 Q-org 同源） |

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-27 | v0.2：八类顶层重组（T6）+ 六重复项清理（T7）+ id 治理（T8）+ tools.deny（T9）+ skill 来源 D-047 收敛；模板物料 7 份作活样例纳入 CI；取代 v0.1 |
