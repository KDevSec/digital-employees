# S3 Linux 侧 Spike 报告（WSL）

> 日期：2026-08-24
> 环境：Windows 11 Home China（10.0.26200.9168）· 非提权用户会话 · WSL 2.7.11.0（Store 版，内核 6.18.33.2-2）· Ubuntu 26.04 LTS · systemd 259.5 · Bun 1.4.0 · hono 4.13.4
> 任务来源：[M0 技术验证 Spike 报告](M0技术验证Spike报告-2026-08-24.md)「未覆盖」项——Linux systemd 侧（T1/T2/T4a-Linux，本机当时未用 WSL）
> 结论：**三项验证全部通过**。M0 三平台矩阵的 Linux 列（以 WSL2 为代表）补齐；M0 留下的 **T4a kill-restart / 78 熔断运行时语义缺口在 Linux 侧拿到完整实证**（含变量隔离对照组）。无设计修正。
> 范围声明：**WSL2 ≠ 原生 Linux**（microsoft-standard 内核 + Ubuntu 26.04 glibc + systemd 259），结论适用边界见 §6。

---

## 结论总表

| 任务 | 判定 | 关键数据 |
|------|------|---------|
| T1-Linux 单体二进制 | ✅ 通过 | **78.75 MB**（比 Windows 108.8 MB 小 27.6%）；healthz 200（WSL 内 + Windows 宿主侧 localhost 转发，同 pid 验证） |
| T2-Linux sqlite-vec 外挂 | ✅ 通过 | vec0.so **0.15 MB**；`db.loadExtension(绝对路径)` 直接可用（与 Windows 用法一致）；KNN `[0, 1.0954]` 与 M0 验收口径完全一致 |
| T4a-Linux systemd --user 守护 | ✅ 通过 | kill -9 → **5.24s 自动拉回**；**78 熔断生效**（NRestarts=0，对照组 2+）；exit 0 = success 不算失败；VM 冷启动后 5s 服务自动拉起 |

未覆盖（环境限制，非阻塞）：macOS 全项（无设备，维持 M0 状态，见 §7）；原生 Linux 发行版实机（以 WSL2 为代表，见 §6 范围声明）；Windows 侧 T4a 运行时语义仍留 M1 首日提权环境补测（M0 修正①测试资产已备好）。

---

## 1 环境记录（从零搭建）

本机此前**无任何 WSL 发行版**（`wsl -l -v` 显示"没有已安装的分发"，默认版本 1），本次从零搭建：

| 项 | 值 | 备注 |
|---|---|---|
| 宿主 | Windows 11 Home China 10.0.26200.9168 | 非提权会话（与 M0 同机） |
| WSL | Store 版 2.7.11.0（内核 6.18.33.2-2） | `vmcompute` RUNNING——**装发行版全程免提权** |
| 发行版 | Ubuntu 26.04 LTS（Resolute Raccoon） | `wsl --install -d Ubuntu --no-launch` 一次成功 |
| systemd | 259（259.5-0ubuntu3），PID 1 | Ubuntu WSL 默认 `[boot] systemd=true`，**无需手工启用**（任务书预案未用上） |
| 内核 | 6.18.33.2-microsoft-standard-WSL2 | `uname -r` |
| Bun | 1.4.0 | 官方脚本安装至 ~/.bun；GitHub 直连可用（Windows M0 侧为 1.3.9） |
| 网络 | NAT 模式 | Mirrored 实测失败，见踩坑 1 |
| 测试用户 | spike（uid 1000） | 专用于本次 spike（`-u root` 绕过 OOBE 创建）；systemd --user 语义按普通用户验证；测后 linger 已还原 |

## 2 T1-Linux 单体二进制 ✅

**方法**：按任务书规格源码（Hono + `/healthz` 返回 `{app,status,pid,uptime}`，监听 127.0.0.1:19980）→ `bun add hono` → `bun build --compile src/index.ts --outfile wb-linux --target=bun-linux-x64` → 裸跑 + curl。

**结果**：
- 编译 0.34s（bundle 28 模块 21ms + compile 307ms；Windows 侧 0.6s）
- **78.75 MB**（82,580,680 字节）——比 Windows 108.8 MB **小 30.05 MB（-27.6%）**：Bun Linux 运行时显著小于 Windows 运行时
- 产物形态：ELF 64-bit x86-64，**动态链接 glibc**（interpreter `/lib64/ld-linux-x86-64.so.2`，标注 for GNU/Linux 3.2.0，not stripped）——见 §6 glibc 兼容性边界
- 裸跑 healthz 200（WSL 内）；启动日志 JSON 行 `{"event":"started","port":19980}` ✓
- **Windows 宿主侧 `curl 127.0.0.1:19980` → 200**：WSL2 localhost 自动转发（NAT 模式）实测成立，响应与 WSL 内同 pid（459）——跨边界访问无差异
- 运行内存 ~82 MB RSS（systemd status Memory 行）

## 3 T2-Linux sqlite-vec 外挂 ✅

**方法**：官方 [sqlite-vec v0.1.9](https://github.com/asg017/sqlite-vec) linux-x86_64 tarball（GitHub 直连下载 61,507 B）→ 解出 `vec0.so`（159,816 B ≈ **0.15 MB**，约为 Windows vec0.dll 0.3 MB 的一半）→ `bun:sqlite` **`db.loadExtension(绝对路径)`**（不用 allowExtension 构造选项——沿用 M0 Windows 实测结论）→ 建 vec0 虚拟表 → 插 2 条 4 维向量 → KNN。

**结果**：
- `loadExtension` 直接成功——**与 Windows 侧踩坑结论跨平台统一：一律不用构造选项，直接 `db.loadExtension(绝对路径)`**
- `vec_version()` = "v0.1.9" ✓
- KNN：`[{"rowid":1,"distance":0},{"rowid":2,"distance":1.095445156097412}]`——向量 A=`[0.1,0.2,0.3,0.4]`、B=3×A，查询 A 时 L2 距离 √1.2 ≈ 1.0954，**与 M0 Windows 验收口径 [0, ~1.095] 完全一致**
- 结论：外挂模式（主二进制零原生依赖 + 资源目录平铺 `.so` + 运行时加载）在 Linux 成立

## 4 T4a-Linux systemd --user 守护 ✅（重点）

unit 严格按任务书字段：`Restart=always / RestartSec=5 / RestartPreventExitStatus=78 / SuccessExitStatus=0 143 / KillMode=control-group / WantedBy=default.target`；唯一适配是 ExecStart 用持久路径 `/home/spike/s3-spike/wb-linux`（/tmp 不可靠，见踩坑 2）。

### 4.1 基础守护 ✅

- `daemon-reload + enable --now` → active (running)，healthz 200（WSL 内 + 宿主侧，同 pid）
- **kill -9 主进程 → 5.2375s 自动拉回**（RestartSec=5 + 进程启动/探活开销 ~0.24s）：新 pid、NRestarts=1、healthz 200 双侧恢复
- `loginctl enable-linger`：会话结束后 user manager 存续；**开机自启实测**——WSL VM 冷启动（17:59:00）后 5s（ActiveEnterTimestamp 17:59:05）服务自动 active，期间无任何会话触碰——enable + linger 的完整语义链拿到运行时证据

### 4.2 78 熔断 ✅（M0 T4a 运行时缺口在此补齐）

- 第二个 unit：`ExecStart=bun -e "process.exit(78)"`，其余字段同主 unit（Restart=always + RestartPreventExitStatus=78）
- **结果（12s 观察窗）**：`ActiveState=failed / Result=exit-code / ExecMainStatus=78 / NRestarts=0`——**零重启**，systemctl status 显示 failed ✓（任务书验收口径 inactive/failed）
- journal：`Main process exited, code=exited, status=78/CONFIG`——systemd 对 78 的助记符恰为 **EX_CONFIG**（配置错误），与「配置级熔断：环境不对别再拉我」的选型语义互为旁证
- **对照组**（同退码、仅去掉 RestartPreventExitStatus 一行）：`NRestarts=2` 且 `SubState=auto-restart` 无限循环（5s 一轮）——**变量隔离干净，证明熔断生效确因该字段而非其他配置**
- **exit 0 不算失败**（第三个 unit，Restart=on-failure）：exit 0 → `inactive (dead) / Result=success / ExecMainStatus=0 / NRestarts=0`——正常退出归类成功、不触发重启；与 78（失败+不重启）、kill -9（失败+重启）三种语义相互正交，全部实测

### 4.3 WSL 特有发现（环境层，不改变产品结论）

- **WSL 发行版空闲即整体硬终止**：会话结束且无会话派生进程时 ~26s 内即发生（实测 25.86s 间隔即触发）；**systemd 服务不作为 WSL 的存活依据**（服务 active 仍被终止）；疑似硬杀（journal 无 shutdown 痕迹、未刷新条目丢失）
- 冷启动后 enable+linger 自动恢复（4.1 实测）——WSL 语境下「保活」上界是 VM 生命周期本身，任何发行版内机制都无法突破
- **对产品的含义**：Linux 桌面目标（原生 systemd）守护语义完整成立；用户在 WSL 里跑工作台属非支持场景（服务随 VM 空闲周期性消失、虽自愈但体验差）——记录在案，不纳入 0.1 目标

## 5 踩坑记录（环境层，实现期避雷）

1. **`.wslconfig` networkingMode=Mirrored 注册即失败**：`RegisterDistro/CreateVm/ConfigureNetworking/0x8007054f` → 回退 networkingMode=None（=发行版内无网络，T1/T2 直接卡死）。该配置 5 月设置以来从未真正生效过（当时无发行版）。已改 `networkingMode=NAT`（原值以注释保留在 .wslconfig，可随时恢复）。**这是本次对 Windows 侧文件的唯一改动**（属 WSL VM 配置，非用户数据）
2. **/tmp 为 tmpfs 且跨调用丢文件**：构建产物写入 /tmp 后在下一次调用消失（当时 journal 显示无重启，机制未查明）；且 /tmp 不跨发行版冷启动存活。spike 资产改放 `~/s3-spike`（ext4，全程稳定）——任务书「临时文件用 /tmp」据此偏差，理由如上
3. **`pkill -f` 自匹配自杀**：脚本命令行含目标字符串（如 wb-linux）时，`pkill -f` 连执行脚本的 bash 一起杀（本 spike 实际踩中，症状是脚本无声截断、疑似环境诡异）。守护/清理逻辑应 `pkill -x`（精确进程名）或按 cgroup 定位
4. **`date +%s%3N` 输出 19 位**（秒 + 完整纳秒，`%3N` 未按预期截断）：超出 bash 64 位算术范围发生回绕，但同模差值仍精确（纳秒计时有效）——计时脚本留意，或改用 `$EPOCHREALTIME`
5. **无发行版起点装机路径**（复用价值）：`wsl --install -d Ubuntu --no-launch` 免提权一次成功（前提 vmcompute 已运行）→ `wsl -d Ubuntu -u root` 绕过交互式 OOBE → `/etc/wsl.conf` 写 `[user] default=` 设默认用户——全程无交互、无重启

## 6 与 Windows 侧数据对比（体积/行为差异）

| 项 | Windows（M0） | Linux/WSL（本报告） | 差异解读 |
|---|---|---|---|
| Bun 版本 | 1.3.9 | 1.4.0 | 小版本差（各自当时最新） |
| T1 单体体积 | 108.8 MB | **78.75 MB** | **Linux 小 27.6%**——Linux 用户下载负担更小 |
| T1 编译耗时 | 0.6s | 0.34s | 同量级 |
| T1 宿主访问 | 本机直连 | WSL2 localhost 自动转发（NAT）实测 200 | 转发层透明 |
| T2 扩展体积 | vec0.dll 0.3 MB | vec0.so 0.15 MB | Linux 约一半 |
| loadExtension 用法 | 直接调用（allowExtension 报 MISUSE） | 相同 | **跨平台统一：不用构造选项、用绝对路径** |
| KNN 验收 | [0, ~1.095] | [0, 1.095445] | 一致 |
| T4 守护 | 计划任务：注册被 UAC 拦（M0 修正①），运行时语义未测 | systemd --user：**无 UAC 概念，全语义实测** | Linux 安装器不需要提权故事 |
| 78 熔断 | 未测（留 M1 提权环境） | **实测生效**（含对照组） | 三平台熔断语义设计统一（计划任务 RestartOnFailure Count=3 ↔ systemd RestartPreventExitStatus=78） |

**范围声明（结论适用边界）**：本报告 Linux 列以 WSL2 为代表（microsoft-standard 内核 + Ubuntu 26.04 glibc + systemd 259），外推到原生 Linux 时：
- T1/T2 结论基本可外推；唯产物 **ELF 动态链接 glibc**——在更低版本 glibc 的老发行版上可运行性未测，Linux 支持矩阵需约束「目标 glibc ≥ 构建机 glibc」，或后续评估 musl 静态目标（未测）
- T4a 语义在 systemd 259 验证；RestartPreventExitStatus / SuccessExitStatus / linger 均为老特性（systemd ≥ 233 时代），主流发行版无虞
- §4.3 的 WSL 空闲终止层为 WSL 特有，不外推

## 7 macOS 列：仍空缺

无设备，维持 M0「未覆盖（环境限制，非阻塞）」状态：T1（bun-darwin 编译）、T2（vec0.dylib）、T4a（launchd）全部未测。注意 macOS 守护不能照搬本报告字段——launchd 的 KeepAlive/ExitTimeOut 语义与 systemd 不同构，届时需单独 spike。

## 8 遗留与建议

- **无设计修正**：本 spike 全部为确认性结论（M0 的 Linux 列假设全部成立），服务本体详细设计 §7 的守护小节可直接引用 §4 的 unit 字段实证；loadExtension 用法踩坑与 M0 §12.1 记录合并为跨平台统一结论
- **M0 三平台矩阵现状**：Windows 5/6 + **Linux 3/3** + macOS 0（无设备）——核心路线三平台中两平台全实证，唯一残留是 Windows T4a 运行时语义（M1 首日提权补测，资产已备）
- **spike 后环境状态**（如实披露）：Ubuntu 26.04 发行版保留（spike 用户 + `~/s3-spike` 资产 + `~/.bun`）；全部 unit 已删、linger 已还原 no、端口已释放；如需彻底清除：`wsl --unregister Ubuntu`（并按需恢复 .wslconfig 的 Mirrored 注释行）
- Linux 安装器设计输入：免提权（对照 Windows 修正①）、unit 模板字段实证（§4）、glibc 约束待支持矩阵裁决时定
