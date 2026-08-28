// Package actions CLI 动作构造（TR-03，S-02 CLI 面的壳侧消费集）——纯函数。
// 执行层（exec.Command(exe, args...) / explorer / 浏览器）在 Wave 5 组装时实现，冒烟覆盖。
package actions

import (
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"

	"devzero-tray/internal/brand"
)

// HealthWaitBudgetMs 「等 healthz 就绪」预算（设计 §4.2：15s）——Restart 末段与
// 左键直达共用单一常量（组装层不得再写 15000 字面量，审查 I-2 双常量消除）
const HealthWaitBudgetMs = 15000

// Kind CLI 动作种类
type Kind uint8

const (
	KindStart Kind = iota
	KindStop
	KindRestart
	KindHealthWait
	KindActivity
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

// Restart 重启服务（stop && start（等 healthz）——设计 §4.1。
// 段序裁决（2026-08-25 协调人，采纳运行时语义观察）：health-wait 段在 start 之后——
// 若置于 stop 与 start 之间，等待的是已停止的服务，必然空转满预算 exit 1 才执行 start
// （重启延迟 +15s 且中段永远"失败"）；「等 healthz」的意图是重启以就绪收尾
func Restart() Action { return Action{Kind: KindRestart} }

// HealthWait 等 /healthz 就绪（内部子命令，左键直达「不让用户看到浏览器连接失败」的关键）。
// timeoutMs 必须 > 0：零/负预算是程序员错误，前置 panic（不产出静默等待零预算的调用串）。
func HealthWait(timeoutMs int) Action {
	if timeoutMs <= 0 {
		panic("actions.HealthWait: timeoutMs must be > 0, got " + strconv.Itoa(timeoutMs))
	}
	return Action{Kind: KindHealthWait, TimeoutMs: timeoutMs}
}

// Activity 查活动任务（TR-07 停止前检查的数据源）；输出解析在 contract.ParseActivity
func Activity() Action { return Action{Kind: KindActivity} }

// BuildCliArgs 动作 → 按序执行的多条 devzero CLI 调用（每段一次 exec.Command）：
//
//	Stop        → [["stop"]]
//	Start       → [["start"]]
//	Restart     → [["stop"], ["start"], ["__health-wait","15000"]]
//	HealthWait  → [["__health-wait","<ms>"]]
//	Activity    → [["activity"]]
//
// 多段而非扁平拼接：Restart 三段有依赖，扁平展开成 ["stop","start"] 时 commander 会把
// start 当 stop 的位置参数静默吞掉——重启只停不起（审查 I-1 实证缺陷）。
// 执行层（组装 main.go）按序循环执行，顺序不可乱：
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
			{"start"},
			{"__health-wait", strconv.Itoa(HealthWaitBudgetMs)}, // 末段：重启以就绪收尾
		}
	case KindHealthWait:
		return [][]string{{"__health-wait", strconv.Itoa(a.TimeoutMs)}}
	case KindActivity:
		return [][]string{{"activity"}}
	default:
		return nil
	}
}

// OpenBrowserURL 左键直达/打开工作台的浏览器地址
func OpenBrowserURL(port int) string {
	return "http://" + brand.LoopbackHost + ":" + strconv.Itoa(port)
}

// ChildEnv 托盘 spawn devzero CLI 子进程时继承的环境（028：单窗口修复）。
// 在继承当前环境的基础上追加 WORKBENCH_NO_BROWSER=1：浏览器只由托盘
// openWorkbench 在服务就绪后显式开一次——服务侧 runStartup 的 idempotent 分支
// （实例已在跑也开窗）与首启哨兵分支（fresh 首启开窗）都会与托盘就绪后的开窗
// 重复，表现为一次点击弹两个终端登录窗口。非托盘路径（终端直跑 devzero start /
// 安装器拉起）不经过本函数，服务侧首启自动开窗行为保持不变。
func ChildEnv() []string {
	return append(os.Environ(), "WORKBENCH_NO_BROWSER=1")
}

// OpenGate openWorkbench 并发合并闸门（028）：同一时刻只允许一条开窗链路进行
// （未就绪时链路含 spawn start + healthwait，最长 HealthWaitBudgetMs）。
// 期间重复触发（左键连击 / 菜单「打开工作台」/ 第二实例唤醒并发）TryEnter 返回
// false，调用方记日志后直接返回，不再弹第二个窗口。
type OpenGate struct {
	inFlight int32
}

// TryEnter 非阻塞尝试进入；首个调用者返回 true，链路结束必须配对 Leave。
func (g *OpenGate) TryEnter() bool {
	return atomic.CompareAndSwapInt32(&g.inFlight, 0, 1)
}

// Leave 释放闸门，允许后续开窗链路。
func (g *OpenGate) Leave() {
	atomic.StoreInt32(&g.inFlight, 0)
}

// DataDirPath 打开数据目录（explorer 目标）——数据目录即 profile 目录
func DataDirPath(profile string) string { return profile }

// LogsDirPath 查看日志（explorer 目标：<profile>/logs）
func LogsDirPath(profile string) string { return filepath.Join(profile, "logs") }
