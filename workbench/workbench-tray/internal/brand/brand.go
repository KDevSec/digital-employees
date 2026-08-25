// Package brand 品牌唯一来源（Go 侧，换牌只改此文件）。
// 与 TS 侧 workbench/workbench-service/src/brand.ts 保持镜像；
// 其余模块只允许 import brand 取值，不得硬编码端口/目录名/应用名。
package brand

const (
	// AppName 与 service 侧 brand.app 对齐（镜像，Wave 5 组装时校验）。
	// app 值 'workbench' 是 service/tray/web 三方内部契约标识（healthz、service.json 的
	// app 字段；web 侧 src/api/health.ts APP_ID 同镜像），不在 2026-08-25 品牌重命名映射表内
	// --同 workbench_version 类内部契约，改名需三方同步（contract_test 绊网盯防）
	AppName = "workbench"
	// DisplayName 托盘 Tooltip / 菜单标题用展示名
	DisplayName = "DevZero"
	// DefaultPort 默认监听端口（D-022，端口发现链的最终 fallback）
	DefaultPort = 19980
	// ProfileName 用户目录下的 profile 目录名（镜像 TS 侧 brand.profileName）
	ProfileName = ".devzero"
	// RunKeyName HKCU Run 键值名
	RunKeyName = "DevZeroTray"
	// CompanyName VersionInfo 占位（品牌定后换）
	CompanyName = "Placeholder"
	// TrayLogName 壳日志文件名（<profile>/logs/ 下）
	TrayLogName = "tray.log"
	// LoopbackHost 网络边界：壳与服务只连 127.0.0.1（设计 §7），无任何外部连接。
	// probe/actions/menu 三包共用的单一常量（M-4 上提）
	LoopbackHost = "127.0.0.1"
)
