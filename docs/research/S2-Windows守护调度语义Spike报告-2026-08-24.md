# S2 Spike：Windows 计划任务守护调度语义实测

> 日期：2026-08-24
> 环境：Windows 11 Home China（10.0.26200）· 非提权用户会话发起，注册经用户管理员终端一次提权
> 任务来源：M0 报告 §4 遗留（T4a 运行时语义补测：kill-restart 与 78 熔断）
> 结论：**核心负结果——Task Scheduler 的 RestartOnFailure 在本机全部四组合下不生效**；**替代方案（重复触发器 + 幂等 daemon）实测成立**；78 语义在 Windows 侧退化为「低频重试」。设计需回写（D-027 Windows 落地方式修正）。

---

## 1 结论总表

| # | 验证项 | 结果 | 证据 |
|---|--------|------|------|
| R1 | RestartOnFailure：手动启动 + 进程被杀 | ❌ 不重启 | LastTaskResult=0x1（失败已判定），75s 无拉回 |
| R2 | RestartOnFailure：手动启动 + 自退 78 | ❌ 不重启 | Result=0x4E(=78)，78s 内 LastRunTime 不变 |
| R3 | RestartOnFailure：**触发器启动** + 进程被杀 | ❌ 不重启 | 一次性触发器 22:24:44 自然拉起，22:24:59 杀，110s 无恢复 |
| R4 | RestartOnFailure：**触发器启动** + 自退 78 | ❌ 不重启 | 触发器启动，Result=78，2m41s 内零重试 |
| R5 | **替代方案：重复触发器（每分钟）+ 幂等 daemon** | ✅ **成立** | 杀进程后 **43 秒**由下一次触发拉回（pid 更换，healthz 恢复 200） |
| R6 | 替代方案的 78 语义 | ⚠️ 权衡 | 退 78 的任务**每分钟被拉起一次**（LastRunTime 逐分钟推进，Result 恒 78）——非风暴但非「零重启」 |
| R7 | 配置佐证 | ✅ | 导出任务 XML 中 `<RestartOnFailure><Count>3</Count><Interval>PT1M</Interval>` 完整在场——**配置正确而行为缺失** |

**R1–R4 是同一结论的四种采样**：本机（Win11 Home China 26200）Task Scheduler 的 RestartOnFailure 对进程级失败（无论杀死还是非零自然退出、无论手动还是触发器启动）均不触发重试。调研 §7.1 表中「崩溃自动重启 = `<RestartOnFailure>`」的语义假设**不成立**。

## 2 替代方案（R5/R6）：重复触发器模型

**机制**：`LogonTrigger`（登录即起）+ `TimeTrigger` 每 N 分钟重复（`-RepetitionInterval 1min -RepetitionDuration 有限时长`）+ `MultipleInstancesPolicy=IgnoreNew`（服务活着时触发被跳过）+ **幂等 daemon**（D-020：重复 `start` 不起新进程直接退出）。

**实测**：杀进程 → 43s 后下一次分钟级触发拉回（healthz 恢复 200，新 pid）。服务持续运行期间重复触发不产生第二实例（IgnoreNew）。

**权衡（R6）**：退 78（配置错误）的进程会被**每分钟拉起一次、瞬退一次**。缓解选项：
| 选项 | 效果 | 建议 |
|------|------|------|
| 接受每分钟一次静默重试 | 日志 +1 条/分钟，非风暴 | ✅ 推荐（恢复延迟最优） |
| 拉长触发间隔至 5 分钟 | 噪音 -80%，恢复延迟 +4min | 备选（可配置项） |
| 常驻不退（healthz 报 config-error 红灯） | 改变 78 语义为「僵尸态告警」 | 不推荐（与 Unix 惯例断裂，托盘红灯语义混叠） |

Linux 侧无此问题：S3 实测 systemd `RestartPreventExitStatus=78` 语义完全正常（含对照组）。**78 的「不徒劳重启」语义只在 Linux 侧完整成立；Windows 侧记录为已知权衡。**

## 3 提权交互发现（安装器设计输入）

1. **agent 宿主上下文弹 UAC 不可靠**：`Start-Process -Verb RunAs` 的确认弹窗与宿主生命周期耦合（宿主超时被杀后弹窗成「孤儿」，点了也无效）——install.ps1 的提权必须在**用户自己的终端上下文**触发
2. 权限边界实测：注册/修改/删除任务 **需要提权**；`schtasks /run` 启动自己的任务**不需要**提权（守护运行期全程无提权）
3. PowerShell 陷阱：`Invoke-Expression` 内 `$PSScriptRoot` 为空（须用 `& script.ps1` 调用）；`[TimeSpan]::MaxValue` 作 RepetitionDuration 超出调度器 XML 范围（须用有限时长，如 2h/1d，配合每日重建触发或 LogonTrigger 重挂）
4. schtasks XML 导入需 UTF-16（M0 已记录）；用 `New-ScheduledTask*` cmdlet 编程构造则完全避开

## 4 设计回写

| 文档 | 回写 |
|------|------|
| [服务本体详细设计](../design/详细设计/工作台服务本体详细设计-v0.1.md) §7 | Windows 守护实现方式改为**重复触发器模型**（删除对 RestartOnFailure 的依赖）；78 权衡注记 |
| [设计决策记录](../design/设计决策记录-2026-08-13.md) D-027 | 状态更新：Windows 层「计划任务」的具体机制修正为重复触发器 |
| 安装器设计（服务本体 §15/调研 T11） | 提权交互须在用户终端上下文；注册一次提权、运行期零提权 |
| 功能点清单 | S1/S2/S3 spike 矩阵补齐记录 |

## 5 测试资产（关键脚本内联存档）

```powershell
# 注册（管理员终端跑一次；Settings 含四反直觉默认值覆写 + 重复触发器）
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -DontStopOnIdleEnd
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(30) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Hours 24)
Register-ScheduledTask -TaskName '<name>' -Action (New-ScheduledTaskAction -Execute '<exe>') `
  -Trigger $trigger -Settings $settings -Force
# 观察：Get-ScheduledTaskInfo -TaskName '<name>'（LastRunTime/LastTaskResult）
# 熔断对照：ExecStart 换 cmd.exe /c exit 78
```

（完整脚本在 %TEMP%\m0-spike\t4-guard\：register-elevated.ps1 / add-triggers.ps1 / set-repeat2.ps1 / cleanup-s2.ps1；TEMP 易失，以本附录为准。）

## 6 与 spike 矩阵全景

| Spike | 状态 | 报告 |
|-------|------|------|
| M0（Windows T1–T5） | ✅ 五过一受限 | [M0技术验证Spike报告-2026-08-24.md](M0技术验证Spike报告-2026-08-24.md) |
| S1（员工上岗闭环） | ✅ 7/7 | [S1员工上岗最小闭环Spike报告-2026-08-24.md](S1员工上岗最小闭环Spike报告-2026-08-24.md) |
| S2（Windows 调度语义，本报告） | ✅ 负结果+替代方案 | 本文 |
| S3（WSL/Linux） | ✅ 全过 | [S3-Linux侧Spike报告-2026-08-24.md](S3-Linux侧Spike报告-2026-08-24.md) |
| macOS | ⏸ 无设备，未覆盖 | — |
