# shared-protocol 详细设计（manifest + skill schema）

| 项 | 值 |
|----|-----|
| 版本 | v0.1 |
| 日期 | 2026-08-23 |
| 状态 | 🟡 草案（待评审） |
| 覆盖 | [套件工作台V0.1功能点清单](../概要设计/套件工作台V0.1功能点清单-2026-08-23.md) **E-01（manifest schema）/ E-02（skill schema）/ E-03（sample 与文档生成）**——M1 协议先行 |
| 输入 | [白皮书 v0.8](../概要设计/数字员工套件2.0架构白皮书-v0.8.md) §5.1/§5.2 · [UPP v0.3](../概要设计/UPP通用插件协议规范-v0.3-开放标准薄封装.md) §5（manifest v2 薄封装 + W-19/W-20/W-22）· 决策 D-006（向导五步映射）/ D-015（employee_id 分层）/ D-016（使用深度推导）· Keyhub skill 协议（实证，E-13） |
| 消费方 | workbench-service（包构建/安装/花名册扫描）、workbench-web（表单与展示类型）、upp（适配器读 manifest） |

> **定位**：shared-protocol 是全链路的**单一真相源**——zod schema 定义一次，TS 类型、校验、样例、字段文档全部从它派生。schema 变更 = 一次 PR 改一个文件，CI 保证样例与文档同步再生成。

---

## 1 包结构与导出面

```
packages/shared-protocol/
├── src/
│   ├── manifest.ts     # 员工包 manifest schema（zod）+ 推导类型
│   ├── skill.ts        # SKILL.md frontmatter schema + manifest.skills 条目 schema
│   ├── identity.ts     # 身份三元组解析与校验（D-015）
│   ├── level.ts        # 使用深度推导规则（D-016）
│   ├── errors.ts       # 结构化校验错误（含字段路径，E-01 验收）
│   └── gen/            # 生成器：sample（YAML 带注释）+ 字段说明表（Markdown）
├── samples/            # 生成产物，提交进仓（CI drift check 对照物）
│   ├── manifest.sample.yml
│   ├── skill-frontmatter.sample.md
│   └── fields.md       # 字段说明表（文档 A §4.3 的机器生成版）
├── test/               # schema 单测（非法输入逐字段定位）
└── package.json
```

**导出面**（消费方只 import 这些）：

```ts
export { manifestSchema, type Manifest } from './manifest.js'
export { skillFrontmatterSchema, skillEntrySchema, type SkillEntry } from './skill.js'
export { parseEmployeeId, validateIdentity } from './identity.js'
export { deriveLevel, type UsageDepthOption } from './level.js'
export { validateManifest, type ValidationResult } from './errors.js'
```

零运行时依赖（除 zod）；**不依赖 Hono/Bun/Node 专有 API**——该包要能被任何 TS 环境 import（含 SEA 回退路径）。

---

## 2 manifest schema（E-01）

### 2.1 设计原则：双上游合并，不发明第三种形状

manifest v2 = **UPP v0.3 薄封装结构**（骨架：standards/requires/task_templates）+ **白皮书 §5.2 字段**（身份三元组/能力声明）+ **D-006 向导产物段**（agent/persona/constraints/governance）。两处上游命名不同但语义不同的字段，**各归其位不重命名**：

> ⚠️ **易混字段消歧**（写进 fields.md）：
> - `capabilities.provides / capabilities.requires` = **员工能力声明**（这个员工会什么/缺什么，编排路由与花名册展示用）
> - `requires.level / requires.capabilities / requires.optional` = **底座能力需求**（安装这台员工需要底座支持什么，UPP §6 能力协商输入）
> 前者主语是员工，后者主语是底座。

### 2.2 schema 定义（zod，完整）

```ts
// manifest.ts —— upp_version 2.1（V0.1 实现版）
export const manifestSchema = z.object({
  // ── 基础 ──
  upp_version: z.literal('2.1'),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),          // 纯 id：本地层唯一键（D-015）
  display: z.string().min(1),
  version: z.string().regex(semver),                       // 包版本，独立于 skill 版本
  schema_version: z.string(),                              // 数据 schema 版本（白皮书 §5.2）
  kind: z.enum(['flow-owner', 'callee']),                  // 1.0 语义保留

  // ── 身份三元组（平台身份/AgentCard 注册用；D-015：本地层一律用纯 id）──
  employee_id: z.string().regex(/^[a-z0-9-]+@[a-z0-9-.]+$/),   // <id>@<组织节点>
  base_identity: z.string().min(1),                        // 如 "claude-code@lyadmin-mac"
  operator_id: z.string().email(),                         // 统一小写邮箱（登录 v0.1 D-Q6 立场沿袭）

  // ── 主 Agent 源数据（向导 Step2；AGENTS.md 是它的渲染产物，D-006）──
  agent: z.object({
    persona: z.object({
      name: z.string(),
      role: z.string(),
      principles: z.array(z.string()),                     // 渲染进 AGENTS.md 五段式
      usage_modes: z.array(z.string()),
      constraints: z.array(z.string()),
    }),
  }),

  // ── 员工能力声明（白皮书 §5.2；主语=员工）──
  capabilities: z.object({
    provides: z.array(z.string()).default([]),
    requires: z.array(z.string()).default([]),
  }),

  // ── open 标准文件清单（UPP v0.3 同构；shim 直接读标准文件）──
  standards: z.object({
    instruction: z.literal('AGENTS.md'),
    skills: z.literal('skills/'),
    hooks: z.string().default('hooks/hooks.json'),         // V0.1 可选（无红线规则时省略）
    mcp: z.string().default('mcp.json'),                   // 可选
  }),

  // ── 包内 skill 清单（向导 Step3；构建时生成并校验，E-02）──
  skills: z.array(skillEntrySchema).default([]),

  // ── MCP 连接器（向导 Step3；写 mcp.json，此处留声明）──
  connectors: z.array(z.object({
    name: z.string(),
    command: z.string(),
    env: z.array(z.string()).default([]),
    access: z.enum(['read', 'read-write']).default('read-write'),
  })).default([]),

  // ── 约束（向导 Step4，D-006：声明式可编译规则同时进 hooks/CQO）──
  constraints: z.object({
    redlines: z.array(z.object({                          // 红线规则（引用预置规则库条目 id）
      rule_id: z.string(),
      compiled_to_hooks: z.boolean().default(false),      // 是否编译进 hooks.json（路径C）
    })).default([]),
    tier_map: z.record(z.string()).optional(),            // 模型档位（路径B，L2 消费）
    token_quota: z.object({
      daily: z.number().int().positive().optional(),
      per_task: z.number().int().positive().optional(),
    }).optional(),
  }).default({}),

  // ── 治理（向导 Step5；运行时不生效，上架/审批/审计时平台消费，D-006）──
  governance: z.object({
    level: z.enum(['L1', 'L2', 'L3', 'L4']),              // 治理分级（带前缀纪律，D-011）
    visibility: z.enum(['private', 'team', 'department', 'company']),
    audit: z.enum(['metadata', 'full']).default('metadata'),
  }),

  // ── 底座能力需求（UPP v0.3 §5 同构；主语=底座，安装协商输入）──
  requires: z.object({
    level: z.enum(['L0', 'L1', 'L2', 'L3']),              // 使用深度（D-016 推导，见 §4）
    capabilities: z.array(z.string()).default([]),        // agent-def / skill-def / bash-exec ...
    optional: z.array(z.string()).default([]),            // event:PreToolUse 等，没有走降级
  }),

  // ── 流程档（向导 Step5：node-table 骨架；使用深度 L2 才有）──
  orchestration: z.object({
    node_table: z.string().regex(/^orchestration\/.+\.node-table\.yml$/),
  }).optional(),

  // ── 任务模板（白皮书字段保留；对话界面 V0.2 消费）──
  task_templates: z.array(z.object({
    title: z.string(),
    prompt: z.string(),
  })).default([]),
}).strict()                                                 // 未知字段拒绝（前向兼容规则见 §5）
```

### 2.3 校验语义（E-01 验收口径）

- **非法 manifest 被拒且报错定位到字段**：zod 错误带 `path`（如 `['skills', 0, 'version']`），`errors.ts` 包装为 `{ valid: false, issues: [{path, code, message}] }`——前端表单与 CLI 都能直接消费
- **跨字段校验**（superRefine）：
  - `requires.level === 'L2'` -> `orchestration.node_table` 必填（D-016：+编排 = L2）
  - `constraints.redlines[].compiled_to_hooks === true` -> `standards.hooks` 必填
  - `skills` 数组元素 `name` 不得重复（底座 skill 目录 = slug，重名互踩）
  - `employee_id` 的 `<id>` 段必须 === `id`（三元组与本地键一致性）

---

## 3 skill schema（E-02）

### 3.1 SKILL.md frontmatter（Agent Skills 标准 + Keyhub 实证一致）

```ts
export const skillFrontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),   // = 目录名 = slug（Keyhub 安装约定）
  description: z.string().min(10),                   // 触发召回的依据，必须有实质内容
}).strict()
// frontmatter 之外允许自由 Markdown body；references/ scripts/ assets/ 子目录不校验内容
```

> Keyhub 实证（E-13/D-033）：skill 包 = SKILL.md + 可选 references/ + scripts/ + assets/，**安装后目录名 = slug**。V0.1 只消费 `assetType=SKILL`。

### 3.2 manifest.skills 条目（包内清单 = 版本锁 + 来源追溯）

```ts
export const skillEntrySchema = z.discriminatedUnion('source_type', [
  z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    version: z.string().regex(semver),                  // 锁定版本（包自包含，D-006）
    source_type: z.literal('agenthub'),
    namespace: z.string(),
    slug: z.string(),                                    // = name（Keyhub 约定；校验相等）
    fingerprint: z.string(),                             // resolve 返回的指纹，重拉校验（E-13）
  }),
  z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    version: z.string().regex(semver),
    source_type: z.literal('local'),                     // 本地导入降级路径
    origin: z.string().optional(),                       // 导入来源说明（自由文本）
  }),
])
```

**用途**：①安装校验（skills/ 目录内容与清单一致）；②漂移检测（B-06 底座卡片）；③重新构建时按 source 重拉或提示本地导入。

---

## 4 身份与使用深度（D-015 / D-016 的代码化）

```ts
// identity.ts
export function parseEmployeeId(full: string): { id: string; orgNode: string }
// 'dev-engineer@team' -> { id: 'dev-engineer', orgNode: 'team' }；非法结构抛 ValidationIssue
// 工作台本地 API/文件名/花名册键一律用返回的 id（D-015）

// level.ts —— 向导「使用深度」选项 -> requires.level 推导（D-016）
export type UsageDepthOption = 'bare' | 'methodology' | 'process' | 'orchestration'
//   bare -> L0（裸 Agent）
//   methodology | process -> L1（+skill：方法论/流程档）
//   orchestration -> L2（+node-table 编排档；同时强制 orchestration 段必填）
// 使用深度 L3（跨员工接力）不由单员工包声明——goal/群组绑定 workflow 时由工作台校验
```

---

## 5 版本与兼容规则

| 规则 | 内容 |
|------|------|
| 协议版本 | `upp_version` 常量 `2.1`；schema 演进时 bump minor，破坏性变更 bump major |
| 未知字段 | `.strict()` 拒绝——manifest 是协议文件不是配置文件，宽容读会掩盖拼写错误 |
| 前向兼容 | 旧工作台读新包：`schema_version` 高于工作台支持 -> **安装期拒绝**并提示升级（对齐服务本体存储版本门 S-09 的语义，防静默读坏） |
| skill 版本 | 独立 semver；manifest.skills[].version 是**锁定值**，升级 skill = 重建包 + bump 包版本 |
| sample 再生成 | 生成器输出与 `samples/` 提交版 diff 不为空 -> CI 失败（E-03 验收） |

---

## 6 生成器（E-03）

```
pnpm gen            # 读 zod schema -> 写 samples/manifest.sample.yml（全量字段 + _comment 注释行）
                    #             -> 写 samples/skill-frontmatter.sample.md
                    #             -> 写 samples/fields.md（字段说明表：路径/类型/必填/默认/说明）
CI step: pnpm gen && git diff --exit-code samples/
```

- sample 的注释来自 zod 的 `.describe()`——**描述与 schema 同源**，字段文档永不漂移（员工新建设计 v0.1 §4.3 的字段表由 fields.md 取代手写版）
- fields.md 顶部自动生成「易混字段消歧」段（§2.1 的警示）

---

## 7 测试与验收

| 功能点 | 验收 | 测试形态 |
|--------|------|---------|
| E-01 schema 有版本号 | `upp_version` 字面量 + `schema_version` 字段存在且被校验 | 单测 |
| E-01 非法 manifest 拒绝且定位到字段 | 每类非法输入（缺必填/类型错/跨字段矛盾/未知字段）逐个断言 issue.path | 单测（表驱动，覆盖 §2.3 全部规则） |
| E-02 skill schema 与 AgentHub 契约兼容 | 用 Keyhub 实测样本（resolve/download 产物）做 fixture 过校验 | 单测（fixture 从 E-13 联调产物固化） |
| E-03 sample 再生成 drift 失败 | 改 schema 不跑 gen -> CI diff 失败；跑 gen -> 通过 | CI |
| D-015/D-016 代码化 | parseEmployeeId / deriveLevel 表驱动用例 | 单测 |

---

## 8 开放问题

| # | 问题 | 临时立场 |
|---|------|---------|
| P-Q1 | `tier_map` 的值结构（record<string,string> 过松） | L2 引擎重写时定（V0.1 只透传展示）；schema 留 `passthrough` 位并标注 |
| P-Q2 | `standards.hooks/mcp` 可省略时 manifest 与实际文件不一致的检测 | 安装器 B-03 落位计划阶段校验文件存在性，schema 层不管文件系统 |
| P-Q3 | Keyhub `namespace` 是否映射组织节点（与 employee_id 的 orgNode 同构） | 待 AgentHub 部署环境（R-20）明确后定；V0.1 按独立字符串处理 |
| P-Q4 | task_templates 的 prompt 变量 schema（`{仓库名}` 等） | V0.2 对话界面消费时定；V0.1 仅透传 |
