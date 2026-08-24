// Package statemachine 托盘壳四态状态机（设计 §3，TR-02/TR-05）——纯逻辑，无 IO 无 GUI。
// 状态机本身无状态：探活循环在外部维护连续失败计数与时间窗，把事件喂给 Next。
package statemachine

// State 托盘壳四态 + 初始态（设计 §3）
type State uint8

const (
	// Starting 初始态：壳刚启动、首个探活结果未到
	Starting State = iota
	// Green 运行中：/healthz 就绪
	Green
	// Yellow 启动中：进程在但 healthz 未就绪（冷启动窗口）
	Yellow
	// Gray 已停止：用户主动停止，不自动恢复
	Gray
	// Red 异常：连续 3 次失败且超冷启动预算（双条件）
	Red
)

// String 供日志与测试输出用
func (s State) String() string {
	switch s {
	case Starting:
		return "Starting"
	case Green:
		return "Green"
	case Yellow:
		return "Yellow"
	case Gray:
		return "Gray"
	case Red:
		return "Red"
	default:
		return "Unknown"
	}
}

// Event 探活循环与用户动作喂给状态机的事件（闭式和类型）
type Event interface{ isEvent() }

// ProbeOk 探活成功（/healthz 200 且 app 匹配）
type ProbeOk struct{}

// ProbeFail 探活失败；Fails = 外部维护的连续失败次数，ElapsedMs = 失败窗口已经过的毫秒数
type ProbeFail struct {
	Fails     int
	ElapsedMs int64
}

// UserStop 用户点了「停止服务」（或 CLI stop 成功）
type UserStop struct{}

// UserStart 用户点了「启动服务」——状态不即时变更，等探活确认
type UserStart struct{}

func (ProbeOk) isEvent()   {}
func (ProbeFail) isEvent() {}
func (UserStop) isEvent()  {}
func (UserStart) isEvent() {}

// Transition 单次状态迁移结果
type Transition struct {
	State State
	// ShouldRecover 进入 RED 时恰好为 true 一次：壳应执行一次 workbench start（不循环自愈）
	ShouldRecover bool
}

// 接管双条件（设计 §3）：连续失败阈值 + 冷启动预算，缺一不可
const (
	TakeoverFails     = 3
	ColdStartBudgetMs = 30000
)

// Next 纯函数：当前态 + 事件 → 迁移结果。
//
// 规则（设计 §3）：
//   - ProbeOk：任意态（含 GRAY——用户自行重启了服务）回到 GREEN
//   - ProbeFail：GRAY 保持 GRAY（用户意志，不自动恢复）；
//     非 RED 态满足双条件（Fails>=TakeoverFails 且 ElapsedMs>=ColdStartBudgetMs）→ RED 且恰好恢复一次；
//     其余 → YELLOW（黄态硬规则：skip 不重启）
//   - UserStop：任意态落灰（幂等）
//   - UserStart：不改变状态——探活是唯一事实源（GRAY+UserStart 等 ProbeOk 确认）
func Next(s State, ev Event) Transition {
	switch e := ev.(type) {
	case ProbeOk:
		return Transition{State: Green}

	case ProbeFail:
		if s == Gray {
			return Transition{State: Gray}
		}
		// 双条件接管。GREEN 直转红是防御分支：计数清零纪律下不可达（GREEN 收到首败即转
		// YELLOW，fails 单调升时不会以 ≥3 回到 GREEN）——保留判定让错误调用方也得到正确裁决
		if s != Red && e.Fails >= TakeoverFails && e.ElapsedMs >= ColdStartBudgetMs {
			return Transition{State: Red, ShouldRecover: true}
		}
		if s == Red {
			return Transition{State: Red} // 已接管过：不重复拉起
		}
		return Transition{State: Yellow}

	case UserStop:
		return Transition{State: Gray}

	case UserStart:
		return Transition{State: s}

	default:
		return Transition{State: s}
	}
}
