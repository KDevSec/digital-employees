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
Compression=lzma2/max
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
