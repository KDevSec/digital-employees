// Package autostart 自启注册判定（设计 §5，TR-06）——纯逻辑。
// 注册执行层（golang.org/x/sys/registry 写 HKCU Run）在 Wave 5 组装时实现：
// registry.SetStringKey(RunKeyPath(), brand.RunKeyName, RunKeyValue(exe))；本波只出判定、路径与键值。
package autostart

import "path/filepath"

// Decision 一次自启注册的判定结果。Register 是双侧语义（设计 §5 注册/注销）：
//   - true  = 确保 HKCU Run 键存在（注册；键已在则幂等无操作）
//   - false = 确保 HKCU Run 键不存在（注销；键不在则无操作）——不是「跳过不管」：
//     用户关过自启后若只跳过不注销，键会残留，升级后自启复活（W-16 同类事故换形态）
type Decision struct {
	Register      bool
	WriteSentinel bool // 写哨兵文件（首次默认注册时记录「默认开过、用户没表态」）
}

// ShouldRegister 哨兵存在性 + 用户设置 → 注册判定（四象限）：
//
//	(哨兵无, 设置开) → 注册并写哨兵：首次运行，默认注册一次
//	(哨兵有, 设置关) → 跳过：用户显式关过自启，升级重装不重开（W-16 实证事故）
//	(哨兵有, 设置开) → 幂等注册（Run 键可能被外部清掉，补上），不重写哨兵
//	(哨兵无, 设置关) → 不注册不写哨兵：用户从未表态且设置已关
//
// 用户开关落在 Service 的 settings.json 的 system.tray.enabled（壳自启，即本函数入参
// userSettingEnabled）。注意与 system.launchAtLogin（服务守护开关）并存——两份独立配置
// （设计 §5/D-027/C-4）：壳自启（HKCU Run）与 Service 守护（计划任务）互不隶属，
// 卸载互不影响；本包只裁壳自启这一份。
func ShouldRegister(sentinelExists, userSettingEnabled bool) Decision {
	if !userSettingEnabled {
		return Decision{}
	}
	if sentinelExists {
		return Decision{Register: true}
	}
	return Decision{Register: true, WriteSentinel: true}
}

// SentinelPath 哨兵文件路径：<profile>/run/sentinels/tray-autostart-defaulted
func SentinelPath(profileDir string) string {
	return filepath.Join(profileDir, "run", "sentinels", "tray-autostart-defaulted")
}

// RunKeyValue HKCU Run 键的值数据：exe 路径原样（品牌定后如需追加参数在此扩展）
func RunKeyValue(exePath string) string {
	return exePath
}

// RunKeyPath HKCU Run 完整键路径（注册执行层用 x/sys/registry 打开；值名 = brand.RunKeyName）
func RunKeyPath() string {
	return `Software\Microsoft\Windows\CurrentVersion\Run`
}
