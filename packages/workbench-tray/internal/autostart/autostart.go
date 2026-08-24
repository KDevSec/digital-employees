// Package autostart 自启注册判定（设计 §5，TR-06）——纯逻辑。
// 注册执行层（golang.org/x/sys/registry 写 HKCU Run）在 Wave 5 组装时实现：
// registry.SetStringKey(RunKeyPath(), brand.RunKeyName, RunKeyValue(exe))；本波只出判定、路径与键值。
package autostart

import "path/filepath"

// Decision 一次自启注册的判定结果
type Decision struct {
	Register      bool // 确保 HKCU Run 键存在（幂等——键在则不重写）
	WriteSentinel bool // 写哨兵文件（首次默认注册时记录「默认开过、用户没表态」）
}

// ShouldRegister 哨兵存在性 + 用户设置 → 注册判定（四象限）：
//
//	(哨兵无, 设置开) → 注册并写哨兵：首次运行，默认注册一次
//	(哨兵有, 设置关) → 跳过：用户显式关过自启，升级重装不重开（W-16 实证事故）
//	(哨兵有, 设置开) → 幂等注册（Run 键可能被外部清掉，补上），不重写哨兵
//	(哨兵无, 设置关) → 不注册不写哨兵：用户从未表态且设置已关
//
// 用户开关落在 Service 的 settings.json（system.launchAtLogin），壳读该文件后调本函数。
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
