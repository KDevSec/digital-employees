; workbench.iss -- DevZero 安装包（Inno Setup）
; 设计：docs/plans/2026-08-25-真安装包-design.md（七项裁决 §2）
; 构建：scripts/build-installer.sh（版本经 -DMyAppVersion 注入，勿手跑 iscc）
; AppId 固定 GUID--同 AppId 重复安装 = 覆盖升级（设计 §2 裁决 5 依赖）
; 品牌：devzero（2026-08-25 用户裁决标识符级重命名，Task R）

#define MyAppName "DevZero"
#define MyAppExeName "devzero-tray.exe"

[Setup]
AppId={{7E4C2A90-3F1B-4D6E-9A85-2C8B1E0D5F73}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=DevZero
DefaultDirName={localappdata}\Programs\devzero
; 裁决 6：固定路径不可改（计划任务/Run 键/快捷方式引用绝对路径永远不变，升级=原地换文件）
DisableDirPage=yes
; per-user 免 UAC（install.ps1 同形态）
PrivilegesRequired=lowest
WizardStyle=modern
SetupIconFile=assets\devzero.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
OutputDir=..\workbench-service\dist
OutputBaseFilename=devzero-setup-{#MyAppVersion}-x64
; lzma2/max 解压实测 ~7s 是中断窗口大头（Task 4 判别实验），降档换窗口余量；
; 代价 setup 变大（下载一次性成本 vs 每次升级的中断体验）——用户裁决 C 2026-08-25
Compression=lzma2/fast
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
InfoBeforeFile=assets\infobefore.txt

[Languages]
; 官方安装包不含简中（社区翻译件，见 assets/ChineseSimplified.isl 头部版权注释），随仓分发
Name: "chinesesimplified"; MessagesFile: "assets\ChineseSimplified.isl"

[Files]
; 三制品（TR-09）：服务 + 守护变体 + 托盘壳
Source: "..\workbench-service\dist\devzero.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\workbench-service\dist\devzero-daemon.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\workbench-service\dist\devzero-tray.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; 裁决 5+单实例唤醒语义：点快捷方式 = 托盘已跑则打开工作台页，没跑则拉起（启动即活）
Name: "{autoprograms}\DevZero"; Filename: "{app}\devzero-tray.exe"; WorkingDir: "{app}"; Comment: "DevZero（托盘 + 本地服务）"

[Run]
; 裁决 3：复选框仅控制「打开工作台页面」；服务恢复已与用户解耦（ssPostInstall）。
; 经托盘 exe 而非 URL：托盘 openWorkbench 自带 healthz 等待 + 单实例唤醒语义，覆盖
; 「服务刚起未就绪」与「已就绪」两种时序。静默模式原生跳过（skipifsilent+WizardNotSilent
; 双保险——无人值守不开浏览器，执行期设计修订，见计划头部）
Filename: "{app}\devzero-tray.exe"; Description: "打开工作台页面"; Flags: postinstall nowait skipifsilent unchecked; Check: WizardNotSilent

[Code]
// [Run] Check 用：静默安装（/SILENT、/VERYSILENT）下跳过 postinstall 复选框。
// Inno 无内建 WizardNotSilent，惯例辅助函数（帮助文档 Check 示例同款）
function WizardNotSilent(): Boolean;
begin
  Result := not WizardSilent();
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
end;

// 装前清理（install.ps1 重装健壮性段翻译）：优雅停服务（释放 19980）→ 三进程硬杀兜底（解文件锁）。
// Inno 6 事件签名是 function 返回 String：空串 = 无错误继续安装
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  // 优雅 stop（失败不中止——服务可能本就没跑/首装尚无 exe）
  Exec(ExpandConstant('{app}\devzero.exe'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // taskkill 参数经 Inno Exec 直调 Windows 进程，不经 git-bash，/F /IM 原样（无 MSYS 转换坑）
  Exec('taskkill', '/F /IM devzero-tray.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('taskkill', '/F /IM devzero.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('taskkill', '/F /IM devzero-daemon.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1500);
  Result := '';
end;

// user-stopped 哨兵路径：WORKBENCH_HOME > %USERPROFILE%\.devzero（与服务 profile 解析同语义
// ——冒烟隔离环境装删一致，否则隔离 profile 的哨兵删不到）。用 GetEnv+字符串拼接
// （而非 ExpandConstant('{%...}') 环境变量常量）：要兼容 GetEnv 为空的回退分支，一处
// 选型两分支同构。返回值可能含正斜杠（MSYS 导出的 Windows 形态路径），DeleteFile 走
// Win32 API 兼容之，勿换 cmd del（del 把 / 当开关符）
function UserStoppedSentinelPath(): String;
var
  Home: String;
begin
  Home := GetEnv('WORKBENCH_HOME');
  if Home <> '' then
    Result := Home + '\run\sentinels\user-stopped'
  else
    Result := GetEnv('USERPROFILE') + '\.devzero\run\sentinels\user-stopped';
end;

// 系统集成 + 立即恢复（设计 §5.1 步骤 3/4；顺序：任务重建 → 清哨兵 → 起托盘）
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then exit;
  // 计划任务 Force 重建（install.ps1:31-43 逐字翻译：四反直觉默认值覆写 + 每分钟触发器 365 天）。
  // 单次 exec 合并（一次 PowerShell 启动注册完，压中断窗口）。
  // exe 路径用 PowerShell 单引号字面量：双引号嵌套在 CreateProcess/PowerShell 双层解析下会碎
  // ——实测 \"\" 送达 PowerShell 是空串拼接（路径含空格即断，如带空格的用户名）；单引号经
  // 命令行层零干扰，实测含空格路径注册完整。{app} 必须 ExpandConstant（[Code] 字符串不自动展开）
  if not Exec('powershell.exe', '-NoProfile -Command "' +
    '$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries ' +
    '-ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -DontStopOnIdleEnd; ' +
    '$t = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(30) ' +
    '-RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 365); ' +
    'Register-ScheduledTask -TaskName DevZeroDaemon ' +
    '-Action (New-ScheduledTaskAction -Execute ''' + ExpandConstant('{app}\devzero-daemon.exe') +
    ''' -Argument ''__daemon'') ' +
    '-Trigger $t -Settings $s -Force"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    // Exec 不写 Inno 日志，失败必须显式 Log 留痕（冒烟能抓、装机现场只能靠 /LOG——
    // 否则任务注册失败零感知，Task 3 review Minor 1）
    Log('计划任务 DevZeroDaemon 注册失败：Exec 返回 False')
  else if ResultCode <> 0 then
    Log('计划任务 DevZeroDaemon 注册失败：PowerShell 退出码 ' + IntToStr(ResultCode));
  // 安装意图 = 要运行：清 user-stopped 哨兵（install.ps1:47 语义——否则 __daemon 见哨兵秒退）
  DeleteFile(UserStoppedSentinelPath());
  // 立即恢复（裁决 3：与用户解耦；托盘启动即活拉服务——服务幂等单实例判定）
  Exec(ExpandConstant('{app}\devzero-tray.exe'), '', ExpandConstant('{app}'), SW_HIDE, ewNoWait, ResultCode);
end;
