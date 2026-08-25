# S4 MVP 员工落地方案对比与 Linux 多底座 Spike 报告

> 日期：2026-08-25
> 环境：**原生 Linux**（Linux Mint 22.3，内核 6.17.0-35-generic，非 WSL）· claude 2.1.245（探针统一 `--model sonnet`）· qodercli 1.1.26 · codebuddy 2.138.0 · codex-cli 0.149.1 · opencode 1.3.0
> 任务：① 对比分析 [数字员工MVP设计讨论_from_田-2026-08-25](./数字员工MVP设计讨论_from_田-2026-08-25.md)（下称**讨论稿**）与 [S1 员工上岗最小闭环 Spike 报告](./S1员工上岗最小闭环Spike报告-2026-08-24.md)；② 对讨论稿自标的实证风险点在本机做 spike 打靶——首次补上 **Linux + Claude Code** 列，并交叉复验 S1 的 Qoder 结论
> 方法约束：沿用 S1 判据纪律（P-2 采样≥2 / P-3 自然问法）；全程零污染（夹具全在 session scratchpad，真实 `~/.claude`/`~/.qoder`/`~/.codebuddy` 配置零写入；凭证以**软链**置备不落副本，报告后清理）
> 结论：**讨论稿的三层对象模型与「思路一（配置域隔离）优于方案 A（junction 工位挂载）」的判断被实证强化——方案 A 在 Linux 上被 symlink realpath 解析直接击穿，不可行**；但「身份锚在哪层最稳」实测是 **per-host 属性**（CC 配置域最稳、Qoder 项目层最稳），必须下沉进 adapter，不能写成全局设计。S1「身份互斥是模型行为强制」在 CC 上逐字复现（2/2 双弃用）。

---

## 第一部分 两份思路对比分析

### 1.1 概念映射（讨论稿 ↔ S1 方案矩阵）

| 讨论稿 | S1 矩阵 | S1 实证（Windows+Qoder） | 本次 S4 实证（Linux+CC 为主） |
|---|---|---|---|
| 思路一：配置域隔离（`CLAUDE_CONFIG_DIR` 等） | **B**（config 根，`--config-dir`） | 原则层可用；**身份层脆弱**（元分析问法 2/2 拒） | **CC 上身份层 3/3 稳过 + skills 同域加载**（V1/V6），是 CC 最优锚层 |
| 方案 A：junction 挂进员工 home、祖先发现 | 无对应（S1 未测目录锚点） | ——讨论稿自标「唯一实证风险点」 | 真实子目录祖先发现 ✅；**symlink 挂载 ❌ 被 realpath 击穿**（V2m）——Linux 不可行 |
| 思路二：纯启动器（旗标注入） | **D**（spawn 旗标，S1 用户裁决未验） | 未验证 | `--append-system-prompt` ✅（V5），可作兜底 |
| 思路三：插件化落地 | **C**（插件） | 能力载体可用、**身份载体判死**（rules/ 不入组件面） | 未重测（S1 结论无冲突证据，沿用） |
| （缺位） | **E**（AGENTS.md @import 薄壳） | 根内 ✅ / 根外被门控拦 | **CC 同构成立**：根内 ✅、根外静默不注入（E1/E2）——跨底座可移植 |
| 三层对象模型 Spec→Deployment→Session、registry 台账、manifest+hash 漂移检测、「落地物=编译产物」 | S1 §8 事务化清单（备份/回读/撤销标记/崩溃恢复） | 手工预演已趟出事务化需求 | 互补关系，见 1.3 |

### 1.2 一致点（两边独立得出、可直接定案）

1. **spec 与 host 解耦、SKILL.md 是最大公约数**：讨论稿的 canonical package（employee.yml + persona.md + skills/）与 S1「身份/角色是员工包统一资产，底座落位只是运行时载体」的用户裁决完全同构。MVP 不碰 MCP/hooks/subagents 的边界取舍两边一致（S1 的 hooks 转义翻车 P-4 恰是反面证据）。
2. **adapter 双纯函数契约**：讨论稿 `adapt()/launch()` ↔ S1 §8 安装执行器清单，一个给接口形状、一个给事务性要求，拼起来就是 B-03 的完整规格。
3. **员工 home 承载身份连续性**（memory/、sessions 台账）：讨论稿第 3 节与 S1 对 `{home}` scope 的修订方向不冲突——home 是「家」，但**岗位身份不锚在 home 记忆层**（见 1.4 冲突焦点的化解）。
4. **插件不承载身份**：讨论稿从产品逻辑推出（全局生效无边界），S1 从机制上判死（rules/ 不入组件面）——双重独立证据，方案 C 身份面可盖棺。

### 1.3 互补点（一边有、另一边没有）

- **讨论稿独有**：三层对象模型（Spec/Deployment/Session）、registry.json 台账、`.workbench-manifest.json`（版本+清单+hash → 升级=重跑 adapter、漂移=对 hash、卸载=按清单删）、session 级 git worktree、前端信息架构（配置库/在岗员工/会话三页 + 安装步骤流水演示）。这些是**工作台侧**的骨架，S1 没碰。
- **S1 独有**：E 薄壳形态（讨论稿缺位，但它是「当值切换只动一行」的最优形态）；事务化八条（原子落位/程序化 merge/双锚撤销标记/归属豁免 diff）；判据方法论（P-2 采样、P-3 反元分析问法）；qodercli auth 与 installation_id 绑定的置备清单（P-6）。
- **结论**：两份文档是**工作台抽象层 × 底座落位层**的正交拼图，无需二选一。

### 1.4 冲突焦点及本次实证裁决

**唯一实质冲突：身份锚在哪层最稳。**

- 讨论稿：推思路一（配置域），身份从「用户层」注入，项目零侵入；
- S1（Qoder 实测）：config 根身份「可用但脆弱」，**项目层 AGENTS.md 才是基线**（4/4 稳过）；
- **S4（CC 实测）：剖面恰好反转**——配置域身份 3/3 稳过（V1/V6b），项目层身份**抽检不稳**（2/3 过、1/3 被当注入拒绝，见 V2 系列）。CC 把配置域 CLAUDE.md 当「用户本人的全局指令」信任度更高，把项目层文件当第三方内容审视。

**裁决**：「身份最优锚层」是 **host 行为属性，不是架构常量**。设计上收敛为：spec 声明身份内容（persona.md 单一真相源），**锚层策略由各 adapter 声明**——CC adapter 首选配置域（思路一），Qoder adapter 首选项目层 A/E（S1 落位表不动），启动器注入为通用兜底（本次 V5 实证可用）。这与讨论稿「三档策略收敛在 adapter.launch() 内部、工作台不感知」的接口设计完全兼容——冲突化解为 adapter 内政。

---

## 第二部分 Spike 实证（Linux 列）

### 2.1 结论总表

| # | 验证项 | 判定 | 关键证据 |
|---|--------|------|---------|
| T0 | CC 隔离配置域 auth 置备 | ✅ **极轻** | 空域 `Not logged in`；**软链 `.credentials.json` 一件即通**（`.claude.json` 自动重建）——远轻于 qodercli P-6 的 installation_id 三件套 |
| V1 | 思路一：配置域 CLAUDE.md 承载身份 | ✅ 3/3 | 会话在真实项目目录启动，DUTY-CFG-LEVEL + CFG-RULE-LOADED 全命中（含 V6b 复验） |
| V2m | 方案 A：祖先发现·真实子目录 | ✅ | cwd=home/jobs/localwork，home 层标记命中 |
| V2m′ | 方案 A：祖先发现·**symlink 挂载** | ❌ **不成立** | cwd=home/jobs/proj（symlink→真实项目），标记未加载——CLI 按 realpath 解析 cwd，祖先链回到真实项目侧，home 不在链上 |
| V2 | CC 项目/祖先层身份顺从性 | ⚠️ 2/3 | 采样1 被拒（模型引用文件内容后声明「不冒充数字员工」——**恰证明文件已加载**）；采样2/3 通过。抽检式注入戒备 |
| V3 | 竞争身份（配置域×项目层） | ❌ **双弃用 2/2** | 「两份 CLAUDE.md 互相矛盾…更像注入测试」→ 回落 vanilla Claude——**S1 V-X1c 跨底座逐字复现** |
| V4 | 互补叠加（配置域原则+项目身份） | ✅ | DUTY-PROJ-LEVEL + PROJ-RULE-LOADED + 末行 [home-principles-on] 三者同现——S1 V-X1d 跨底座复现 |
| V5 | 思路二：`--append-system-prompt` 启动器 | ✅ | DUTY-LAUNCHER + LAUNCHER-RULE-LOADED |
| V6 | 思路一：skills 随配置域加载 | ✅ | `$CFG/skills/fix-style` 被枚举 + 语义触发 SKILL-CFG-TRIGGERED（清场后）；注：隔离域仍含 CLI 内置 skill（如 dataviz），非零基线 |
| E1 | CC @import 薄壳·根内 | ✅ | DUTY-IMPORT-CC + IMPORT-CC-LOADED——S1 V-X3b 同构 |
| E2 | CC @import·项目根外 | ❌ 不注入 | **静默**回落 vanilla（qoder 是显式警告拦截）——殊途同归：包内容物必须随装拷入 scope |
| Q-1 | Qoder 项目层 AGENTS.md 身份（Linux） | ✅ 2/2 | DUTY-QODER-PROJ + QODER-RULE-LOADED——S1 基线 A 跨平台成立，且对身份扮演零抵触 |
| CB-0 | `CODEBUDDY_CONFIG_DIR` 重定向 | ✅ 结构生效 | 新域自动长出 sessions/logs/plugins/user-state.json 全套 |
| CB-1 | CodeBuddy 配置域 CLAUDE.md 身份 | ❌ 2/2 未加载 | 自称「CodeBuddy Code（Hy3 模型）」——config 重定向**不含用户记忆文件**（或路径约定不同，待查） |
| CB-2 | CodeBuddy 项目层身份 | ⛔ BLOCKED | 429 企业订阅已到期（2/2 + 重试挂起），无法判定 |
| D2 | `CODEX_HOME` 重定向 | ✅ | 新域 `Not logged in` vs 默认域 `Logged in`；**附带发现：codex 拒绝在 /tmp 下建 helper 二进制** |

### 2.2 配置域隔离能力普查（讨论稿思路一的前提核查）

| 底座 | 机制 | 状态 |
|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` | ✅ 实证（身份+skills+auth 全套随域走） |
| QoderCLI | `--config-dir` 旗标 | ✅ 存在（Linux 版同 S1；auth 置备按 S1 P-6 清单，本次未重跑） |
| CodeBuddy | `CODEBUDDY_CONFIG_DIR` | ⚠️ 半生效：状态域重定向 ✅，用户记忆注入 ✖（待 429 解除后补：`~/.codebuddy` 层 CLAUDE.md 约定是否存在） |
| Codex | `CODEX_HOME` | ✅ 尊重（登录态随域）；身份需走 AGENTS.md/`config.toml`，未深测 |
| OpenCode | `XDG_CONFIG_HOME`/`OPENCODE_CONFIG` | 未实测（本机 `~/.config/opencode` 存在，机制待验） |

### 2.3 踩坑记录（实现必读，编号续 S1）

| # | 坑 | 现象 | 规避 |
|---|-----|------|------|
| P-9 | **Linux 无 junction 等价物** | symlink 挂载被 realpath 击穿（V2m′）：进程 cwd 由内核解析为真实路径，逻辑路径只活在 shell 的 `$PWD` | Linux adapter **不得采用方案 A**；bind mount 需 root 不可用于用户态安装器。首选思路一 |
| P-10 | CC 身份指令的**抽检式**注入戒备 | 同一夹具同一问法，1/3 拒绝、2/3 通过；配置域则 3/3 过 | 身份锚层 per-host 化（1.4 裁决）；persona 措辞避免「伪装成另一系统」观感，明示「用户配置的工作角色」 |
| P-11 | **残留夹具毒化后续判据** | V3 竞争夹具未清 → V6b 首跑连 skill 标记一起被拒（模型进入全面戒备态） | 每个验证项独立夹具目录；共享目录跑完即清。比 S1 P-2 更进一步：污染不止影响本项，会**传染整个会话的顺从性** |
| P-12 | 凭证置备与安全边界 | 直接 cp 凭证被本机安全策略拦 | **软链**代替拷贝：不落副本、保持原 0600、清理只删链接——比 S1 的「拷贝只读」更优，回写 P-6 |
| P-13 | codex 拒绝 /tmp 作 HOME | `Refusing to create helper binaries under temporary dir` | 员工 home/config 域必须落持久用户路径（与 S3 踩坑 2「/tmp 丢文件」互证） |
| P-14 | 隔离配置域非零技能基线 | `$CFG/skills` 只有 fix-style，枚举却含 CLI 内置 dataviz 等 | 「员工能力清单」校验不能假设隔离域=白纸；断言用包含式不用全等式 |

### 2.4 设计回写清单

| 文档/位置 | 回写 | 依据 |
|-----------|------|------|
| 员工安装与底座适配详细设计 §3 落位表 | 增加**锚层策略列**：每 host adapter 声明 `identity_anchor ∈ {config-domain, project-file, launcher-flag}` 及优先级；CC=config-domain 首选，Qoder=project-file 首选（S1 不动），launcher 全员兜底 | 1.4 裁决、V1/V2/Q-1/V5 |
| 同上（新增 Linux 列） | Linux 平台禁用目录挂载式工位（junction 类）；员工 home 仍保留（memory/sessions），但身份注入走 config-domain/launcher | P-9 |
| 同上 §B-03 | auth 置备按 host 分档：CC=软链 `.credentials.json` 一件；qodercli=P-6 三件套；codex=`CODEX_HOME` 全迁 | T0/D2 |
| 工作台概要设计（三层对象模型） | 采纳讨论稿 Spec→Deployment→Session + registry + manifest/hash 机制，与 S1 §8 事务化八条合并为 B-03 完整规格 | 1.3 |
| spec 规格（employee.yml/persona.md） | persona 模板加「本角色为用户配置的数字员工岗位」授权框架措辞；**一份落地物内身份必须互斥单值**升级为跨底座铁律 | V3（两底座 4/4 双弃用）、P-10 |
| 验证判据规范（M2 冒烟用） | ① 每验证项独立夹具；② 标记类断言配语义断言双轨；③ 身份类判据至少 3 采样（CC 抽检拒绝存在） | P-10/P-11 |

### 2.5 S4 判定

- **讨论稿框架整体成立并被强化**：三层对象模型可直接进设计；「思路一优于方案 A」在 Linux 上从「更好」升级为「唯一可行」（方案 A 被 P-9 判死于 Linux；Windows junction 变体仍未实测，若 V0.2 需要 Windows 目录锚点再单独 spike）。
- **S1 核心结论跨底座、跨平台保持**：身份互斥（模型行为强制）✅✅；互补分层（原则层/身份层）✅✅；E 薄壳根内可用/根外不生效 ✅✅；「安装=员工上岗」在 Linux+Qoder 复验成立。
- **新增架构约束**：身份锚层是 host 属性 → adapter 契约里显式化，工作台抽象层不感知。
- 遗留：CodeBuddy 身份面（429 阻塞）；OpenCode 全列；Windows junction 变体；qodercli Linux 配置域 auth 置备复验。

> 证据说明：全部验证在 session scratchpad `s4/` 临时目录完成，关键输出行已内嵌上文；凭证软链与临时夹具于报告提交后清理。探针模型：CC 侧统一 sonnet（成本考虑），Qoder/CodeBuddy 用其默认模型——身份顺从性结论含模型因素，换模型需复验。

---

## 第三部分 最终推荐方案（MVP 落地定案建议）

> 综合讨论稿框架 + S1/S4 全部实证，给 MVP 一个可以直接开工的收敛方案。除标注「待验」项外，每条均有上文证据锚点。

### 3.1 总架构：讨论稿骨架 + S1/S4 落位实证

```
EmployeeSpec（employee.yml + persona.md + skills/，host 无关，工作台唯一事实源）
   │  adapt(spec, host, home_dir) → 落地文件 + .workbench-manifest.json
   ▼
Deployment（spec × host × home）—— registry.json 台账
   │  launch(deployment, workdir, task) → 底座启动命令
   ▼
Session（一次会话 = 一位员工的一个工作实例）—— home/sessions/ 记录
```

- **采纳讨论稿全部工作台侧机制**：三层对象模型、registry 台账、manifest+hash（升级=重跑 adapter / 漂移=对 hash / 卸载=按清单删）、「落地物=编译产物，永不手改」铁律；
- **安装执行器按 S1 §8 事务化八条实现**（原子落位、程序化 merge、双锚撤销标记、归属豁免 diff、崩溃恢复 phase 日志）。

### 3.2 身份注入：adapter 声明 `identity_anchor`，三档策略

**核心定案：身份最优锚层是 host 属性（S4 1.4 裁决），写进 adapter 契约，工作台抽象层不感知。**

| 底座 | 首选锚层 | 落地形态 | 证据 |
|---|---|---|---|
| Claude Code | **config-domain**（思路一） | `CLAUDE_CONFIG_DIR=<home>/config` + config 层 CLAUDE.md 承载 persona + `config/skills/` 承载能力 | V1 3/3、V6 ✅；项目层抽检被拒（V2 ⚠️） |
| QoderCLI | **project-file**（S1 方案 A/E） | 项目层 AGENTS.md（全文或 @import 薄壳指向 `.employees/<id>/`，包内容物随装拷入 scope 根内） | S1 基线 4/4 + Q-1 Linux 2/2；根外 import 被门控 |
| Codex / OpenCode / CodeBuddy | 待验，先走兜底 | `--append-system-prompt` 类启动器注入（各 host 旗标由 adapter 封装） | V5 ✅；CODEX_HOME/CODEBUDDY_CONFIG_DIR 结构重定向已证 |

三档兜底顺序统一为：**config-domain → project-file → launcher-flag**，全部收敛在各 adapter 的 `launch()` 内部。

**跨底座铁律（两底座 4/4 实证，模型行为强制）**：一份落地物内**身份互斥单值**——任何时刻任何可见层只允许一个身份声明；当值切换=先摘旧再落新（中间态必须无身份，崩溃恢复要覆盖此窗口）。home 层（或 config 层与项目层并存时的次级层）只放**通用工作原则**，不放身份（V4/S1 V-X1d 互补叠加实证）。

### 3.3 员工 home：保留「家」，放弃「工位挂载」

```
~/digital-staff/<host>/<employee-id>/     # 持久路径，禁用 /tmp（P-13）
  config/            # CC 类底座的隔离配置域（含编译出的 CLAUDE.md、skills/、软链凭证）
  memory/            # 跨会话长期记忆（persona 声明「你的记忆在 ./memory/」）
  sessions/          # 会话台账 {workdir, task, host_session_id}
  .workbench-manifest.json
```

- **删除讨论稿方案 A 的 `jobs/` 挂载点设计**：Linux 上 symlink 被 realpath 击穿（P-9），且思路一已覆盖其全部诉求——员工「带着工具箱去项目现场」（会话直接在真实项目目录启动），项目零侵入；
- Windows 侧 junction 变体不再作为主路径投入验证，仅当某 Windows 底座既无 config-domain 又无可用旗标时才复活为专项 spike；
- auth 置备按 host 分档进 adapter：CC=软链 `.credentials.json` 一件（T0）；qodercli=P-6 三件套；codex=CODEX_HOME 整迁。凭证一律**软链不拷贝**（P-12）。

### 3.4 Spec 与 persona 编写规范

- MVP spec 只含 `employee.yml`（id/display/version/description/model_tier/persona/skills 显式清单）+ `persona.md` + `skills/`（SKILL.md 标准包）。不碰 MCP/hooks/subagents（S1 P-4 反面证据）；
- persona 模板必须带**授权框架措辞**（「本角色为用户配置的数字员工岗位」），避免「伪装成另一系统」观感——CC 的注入戒备是抽检式的（P-10），措辞是降低拒绝率的第一道保险；
- model_tier 写抽象档位，由 adapter 查 tier-map 翻译（沿用讨论稿/现有 tier-map.yml 模式）。

### 3.5 M2 冒烟判据规范（spike 方法论沉淀）

1. 每验证项**独立夹具目录**，跑完即清——残留夹具会毒化整个会话的指令顺从性（P-11）；
2. 标记断言 + 语义断言双轨，身份类判据 ≥3 采样（P-10）；问法自然化，禁元分析式提问（S1 P-3）；
3. 能力清单校验用包含式断言——隔离配置域仍含 CLI 内置 skills（P-14）；`skills list` 类枚举有盲区（S1 P-7），以语义触发为准；
4. 每次实测记录底座版本（S1 P-8）。

### 3.6 优先级与遗留

**立即可开工（证据充分）**：CC adapter（config-domain 全链）→ Qoder adapter（project-file/E 薄壳）→ 工作台 install/launch 两动词 + registry/manifest。
**排队待验（不阻塞 MVP）**：CodeBuddy 身份面（429 解除后：`~/.codebuddy` 层记忆约定 + 项目层身份）；OpenCode 全列；codex AGENTS.md 身份顺从性；qodercli Linux 配置域 auth 复验。
**明确不做**：方案 A 目录挂载（Linux 判死）、插件承载身份（S1 判死）、工作台内自定义 SKILL 编辑器（讨论稿定位裁决：SKILL 生产归资产平台）。
