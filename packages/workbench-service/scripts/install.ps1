# install.ps1 —— 数字员工工作台 per-user 安装（V0.1 框架增量）
# 形态（调研 §9.2 + S2/安装实证修正）：
#   1. 落盘双制品到 %LOCALAPPDATA%\Programs\workbench\（per-user，免 UAC）
#   2. 注册计划任务守护（重复触发器模型：每分钟 TimeTrigger + IgnoreNew + 四反直觉默认值覆写）
#      —— 2026-08-25 安装实证：纯时间触发任务**非提权可注册**（S2 被拒的是 LogonTrigger/S4U 形态）
#      开机自启：repeat 触发跨重启持续（365 天）；LogonTrigger 需一次提权，留后续版本增强
#   3. 拉起服务（经计划任务，同时验证注册正确）+ 起托盘 + 开浏览器
# 用法：在 packages/workbench-service 下执行  bash scripts/build.sh && bash ../workbench-tray/scripts/build-tray.sh
#       然后  powershell -ExecutionPolicy Bypass -File scripts/install.ps1
$ErrorActionPreference = 'Stop'
$TaskName = 'WorkbenchDaemon'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\workbench'

Write-Host "== 数字员工工作台安装（per-user，全程免提权） =="
Write-Host "安装目录: $InstallDir"

# 1. 落盘双制品
if (-not (Test-Path 'dist\workbench.exe')) { throw "dist\workbench.exe 不存在——先跑 bash scripts/build.sh 与 build-tray.sh" }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item 'dist\workbench.exe' (Join-Path $InstallDir 'workbench.exe') -Force
Copy-Item 'dist\workbench-tray.exe' (Join-Path $InstallDir 'workbench-tray.exe') -Force
Write-Host "[1/4] 双制品已落盘（$((Get-Item (Join-Path $InstallDir 'workbench.exe')).Length) + $((Get-Item (Join-Path $InstallDir 'workbench-tray.exe')).Length) bytes）"

# 2. 注册计划任务（非提权——时间触发器实测可注册）
$exe = Join-Path $InstallDir 'workbench.exe'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -DontStopOnIdleEnd
# S2 定稿：重复触发器 = 崩溃恢复主力（实测 43s 拉回）；RepetitionDuration 用有限时长（MaxValue 超 XML 范围）
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(30) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName $TaskName -Action (New-ScheduledTaskAction -Execute $exe -Argument '__daemon') `
  -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "[2/4] 计划任务 $TaskName 已注册（每分钟重复触发守护；免提权）"

# 3. 经计划任务拉起服务（同时验证注册正确）
schtasks /Run /TN $TaskName | Out-Null
$healthz = "http://127.0.0.1:19980/healthz"
$ready = $false
$r = $null
foreach ($i in 1..20) {
  Start-Sleep -Milliseconds 500
  try { $r = Invoke-RestMethod -Uri $healthz -TimeoutSec 2; if ($r.app -eq 'workbench') { $ready = $true; break } } catch {}
}
if (-not $ready) { throw "服务经计划任务拉起后 10s 内 healthz 未就绪" }
Write-Host "[3/4] 服务已由计划任务拉起（pid=$($r.pid) port=$($r.port) uid=$($r.uid)）"

# 4. 起托盘 + 开浏览器
Start-Process (Join-Path $InstallDir 'workbench-tray.exe')
Start-Process $healthz
Write-Host "[4/4] 托盘已启动 + 浏览器已打开"
Write-Host ""
Write-Host "== 安装完成 =="
Write-Host "  访问:     $healthz"
Write-Host "  安装目录: $InstallDir"
Write-Host "  守护任务: $TaskName（schtasks /Query /TN $TaskName 查看；删除: schtasks /Delete /TN $TaskName /F）"
Write-Host "  卸载:     workbench stop → 删 $InstallDir → schtasks /Delete /TN $TaskName /F"
