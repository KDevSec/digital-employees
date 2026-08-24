// Package actions CLI 动作构造（TR-03，S-02 CLI 面的壳侧消费集）——纯函数。
// 执行层（exec.Command(exe, args...) / explorer / 浏览器）在 Wave 5 组装时实现，冒烟覆盖。
package actions

import (
	"path/filepath"
	"strconv"
)

// loopbackHost 网络边界：壳只连 127.0.0.1（设计 §7），无任何外部连接
const loopbackHost = "127.0.0.1"

// Kind CLI 动作种类
type Kind uint8

const (
	KindStart Kind = iota
	KindStop
	KindRestart
	KindHealthWait
)

// Action 一次对 workbench CLI 的调用意图（纯数据）
type Action struct {
	Kind      Kind
	TimeoutMs int // 仅 HealthWait：等 healthz 就绪的超时毫秒数
}

// Start 启动服务
func Start() Action { return Action{Kind: KindStart} }

// Stop 停止服务
func Stop() Action { return Action{Kind: KindStop} }

// Restart 重启服务（stop && start）
func Restart() Action { return Action{Kind: KindRestart} }

// HealthWait 等 /healthz 就绪（内部子命令，左键直达「不让用户看到浏览器连接失败」的关键）
func HealthWait(timeoutMs int) Action {
	return Action{Kind: KindHealthWait, TimeoutMs: timeoutMs}
}

// BuildCliArgs 动作 → workbench CLI 参数（纯函数）。
// 执行层：exec.Command(<exe>, BuildCliArgs(action)...)
func BuildCliArgs(a Action) []string {
	switch a.Kind {
	case KindStart:
		return []string{"start"}
	case KindStop:
		return []string{"stop"}
	case KindRestart:
		return []string{"stop", "start"}
	case KindHealthWait:
		return []string{"__health-wait", strconv.Itoa(a.TimeoutMs)}
	default:
		return nil
	}
}

// OpenBrowserURL 左键直达/打开工作台的浏览器地址
func OpenBrowserURL(port int) string {
	return "http://" + loopbackHost + ":" + strconv.Itoa(port)
}

// DataDirPath 打开数据目录（explorer 目标）——数据目录即 profile 目录
func DataDirPath(profile string) string { return profile }

// LogsDirPath 查看日志（explorer 目标：<profile>/logs）
func LogsDirPath(profile string) string { return filepath.Join(profile, "logs") }
