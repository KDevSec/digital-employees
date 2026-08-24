package statemachine

import "testing"

// TestNext 表驱动覆盖设计 §3 四态状态机全部迁移规则。
func TestNext(t *testing.T) {
	tests := []struct {
		name  string
		state State
		event Event
		want  Transition
	}{
		// GREEN：健康态
		{"GREEN+ProbeOk_保持绿", Green, ProbeOk{}, Transition{State: Green}},
		{"GREEN+首次失败_转黄", Green, ProbeFail{Fails: 1}, Transition{State: Yellow}},
		{"GREEN+双条件_直接转红", Green, ProbeFail{Fails: 3, ElapsedMs: 30000}, Transition{State: Red, ShouldRecover: true}},

		// YELLOW：黄态硬规则——skip 不重启（冷启动窗口内重启必成重启风暴）
		{"YELLOW+单次失败_保持黄", Yellow, ProbeFail{Fails: 1}, Transition{State: Yellow}},
		{"YELLOW+fails小于3_过预算仍黄", Yellow, ProbeFail{Fails: 2, ElapsedMs: 60000}, Transition{State: Yellow}},
		{"YELLOW+fails等于3_未过预算仍黄", Yellow, ProbeFail{Fails: 3, ElapsedMs: 29000}, Transition{State: Yellow}},
		{"YELLOW+双条件_转红且恰好一次恢复", Yellow, ProbeFail{Fails: 3, ElapsedMs: 30000}, Transition{State: Red, ShouldRecover: true}},
		{"YELLOW+恢复_转绿", Yellow, ProbeOk{}, Transition{State: Green}},

		// RED：不重复拉起（OS 守护负责进程级，壳只补 health 级这一层，一次）
		{"RED+继续失败_保持红不重复恢复", Red, ProbeFail{Fails: 4, ElapsedMs: 60000}, Transition{State: Red}},
		{"RED+失败计数重置_仍保持红", Red, ProbeFail{Fails: 1, ElapsedMs: 0}, Transition{State: Red}},
		{"RED+恢复_转绿", Red, ProbeOk{}, Transition{State: Green}},

		// GRAY：用户主动停止——不自动恢复（W-2 语义：停止是用户意志）
		{"GRAY+失败_保持灰（双条件也不接管）", Gray, ProbeFail{Fails: 5, ElapsedMs: 60000}, Transition{State: Gray}},
		{"GRAY+用户自行重启服务_探活转绿", Gray, ProbeOk{}, Transition{State: Green}},
		{"GRAY+UserStart_等探活确认", Gray, UserStart{}, Transition{State: Gray}},
		{"GRAY+UserStop_幂等保持灰", Gray, UserStop{}, Transition{State: Gray}},

		// Starting：壳初始态（探活前）
		{"Starting+ProbeOk_转绿", Starting, ProbeOk{}, Transition{State: Green}},
		{"Starting+失败_转黄", Starting, ProbeFail{Fails: 1}, Transition{State: Yellow}},
		{"Starting+双条件_转红一次恢复", Starting, ProbeFail{Fails: 3, ElapsedMs: 31000}, Transition{State: Red, ShouldRecover: true}},

		// UserStop：任意态落灰（含服务未就绪的中间态）
		{"GREEN+UserStop_落灰", Green, UserStop{}, Transition{State: Gray}},
		{"YELLOW+UserStop_落灰", Yellow, UserStop{}, Transition{State: Gray}},
		{"RED+UserStop_落灰", Red, UserStop{}, Transition{State: Gray}},
		{"Starting+UserStop_落灰", Starting, UserStop{}, Transition{State: Gray}},

		// UserStart：非灰态不改变状态（探活是唯一事实源）
		{"GREEN+UserStart_无操作", Green, UserStart{}, Transition{State: Green}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Next(tt.state, tt.event)
			if got != tt.want {
				t.Fatalf("Next(%s, %#v) = %+v, want %+v", tt.state, tt.event, got, tt.want)
			}
		})
	}
}

// TestTakeoverConstants 锁定设计 §3 双条件常量。
func TestTakeoverConstants(t *testing.T) {
	if TakeoverFails != 3 {
		t.Fatalf("TakeoverFails = %d, want 3（设计 §3：连续 3 次失败）", TakeoverFails)
	}
	if ColdStartBudgetMs != 30000 {
		t.Fatalf("ColdStartBudgetMs = %d, want 30000（设计 §3：冷启动预算 30s）", ColdStartBudgetMs)
	}
}
