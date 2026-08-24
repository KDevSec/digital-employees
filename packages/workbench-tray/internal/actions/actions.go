// Package actions CLI 动作构造（TR-03，S-02 CLI 面的壳侧消费集）——纯函数。
// 执行层（exec.Command(exe, args...) / explorer / 浏览器）在 Wave 5 组装时实现，冒烟覆盖。
package actions

import (
	"path/filepath"
	"strconv"

	"workbench-tray/internal/brand"
)

// restartHealthWaitMs Restart 中段「等 healthz」预算（设计 §4.1：重启 = stop && start（等 healthz）；
// 与 §4.2 左键直达的 15s 同款预算）
const restartHealthWaitMs = 15000

// Kind CLI 动作种类
type Kind uint8

const (
	KindStart Kind = iota
	KindStop
	KindRestart
	KindHealthWait
)

// Action 一次用户意图（纯数据）；一个意图可能对应多条按序执行的 CLI 调用（如 Restart）
type Action struct {
	Kind      Kind
	TimeoutMs int // 仅 HealthWait：等 healthz 就绪的超时毫秒数（必须 > 0）
}

// Start 启动服务
func Start() Action { return Action{Kind: KindStart} }

// Stop 停止服务
func Stop() Action { return Action{Kind: KindStop} }

// Restart 重启服务（stop && start，中段等 healthz，见 BuildCliArgs）
func Restart() Action { return Action{Kind: KindRestart} }

// HealthWait 等 /healthz 就绪（内部子命令，左键直达「不让用户看到浏览器连接失败」的关键）。
// timeoutMs 必须 > 0：零/负预算是程序员错误，前置 panic（不产出静默等待零预算的调用串）。
func HealthWait(timeoutMs int) Action {
	if timeoutMs <= 0 {
		panic("actions.HealthWait: timeoutMs must be > 0, got " + strconv.Itoa(timeoutMs))
	}
	return Action{Kind: KindHealthWait, TimeoutMs: timeoutMs}
}

// BuildCliArgs 动作 → 按序执行的多条 workbench CLI 调用（每段一次 exec.Command）：
//
//	Stop        → [["stop"]]
//	Start       → [["start"]]
//	Restart     → [["stop"], ["__health-wait","15000"], ["start"]]
//	HealthWait  → [["__health-wait","<ms>"]]
//
// 多段而非扁平拼接：Restart 三段有依赖，扁平展开成 ["stop","start"] 时 commander 会把
// start 当 stop 的位置参数静默吞掉——重启只停不起（审查 I-1 实证缺陷）。
// 执行层（Wave 5）按序循环执行，顺序不可乱：
//
//	for _, args := range actions.BuildCliArgs(a) {
//	    if err := exec.Command(exe, args...).Run(); err != nil { ... }
//	}
func BuildCliArgs(a Action) [][]string {
	switch a.Kind {
	case KindStart:
		return [][]string{{"start"}}
	case KindStop:
		return [][]string{{"stop"}}
	case KindRestart:
		return [][]string{
			{"stop"},
			{"__health-wait", strconv.Itoa(restartHealthWaitMs)},
			{"start"},
		}
	case KindHealthWait:
		return [][]string{{"__health-wait", strconv.Itoa(a.TimeoutMs)}}
	default:
		return nil
	}
}

// OpenBrowserURL 左键直达/打开工作台的浏览器地址
func OpenBrowserURL(port int) string {
	return "http://" + brand.LoopbackHost + ":" + strconv.Itoa(port)
}

// DataDirPath 打开数据目录（explorer 目标）——数据目录即 profile 目录
func DataDirPath(profile string) string { return profile }

// LogsDirPath 查看日志（explorer 目标：<profile>/logs）
func LogsDirPath(profile string) string { return filepath.Join(profile, "logs") }
