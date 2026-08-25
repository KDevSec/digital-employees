package menu

import (
	"testing"

	"workbench-tray/internal/statemachine"
)

// baselineIDs 每态都含的菜单项（任务规格：打开工作台/复制地址/数据目录/日志/检查更新/关于/退出）
var baselineIDs = []ItemID{ItemOpen, ItemCopyURL, ItemOpenDataDir, ItemViewLogs, ItemCheckUpdate, ItemAbout, ItemQuit}

func TestMenuModelForStates(t *testing.T) {
	tests := []struct {
		name            string
		state           statemachine.State
		statusText      string
		startVisible    bool
		startEnabled    bool
		stopVisible     bool
		stopEnabled     bool
		restartVisible  bool
		restartEnabled  bool
		openEnabled     bool
		viewLogsEnabled bool
		quitEnabled     bool
	}{
		{
			name: "Green_运行中", state: statemachine.Green,
			statusText:  "运行中 · 127.0.0.1:19980",
			stopVisible: true, stopEnabled: true, restartVisible: true, restartEnabled: true,
			openEnabled: true, viewLogsEnabled: true, quitEnabled: true,
		},
		{
			name: "Gray_已停止", state: statemachine.Gray,
			statusText:   "已停止",
			startVisible: true, startEnabled: true,
			openEnabled: true, viewLogsEnabled: true, quitEnabled: true,
		},
		{
			name: "Yellow_启动中_全部操作禁用", state: statemachine.Yellow,
			statusText:  "启动中…",
			stopVisible: true, stopEnabled: false, restartVisible: true, restartEnabled: false,
			openEnabled: false, viewLogsEnabled: true, quitEnabled: true,
		},
		{
			name: "Red_异常", state: statemachine.Red,
			statusText:     "异常",
			restartVisible: true, restartEnabled: true,
			openEnabled: false, viewLogsEnabled: true, quitEnabled: true,
		},
		{
			name: "Starting_探测中_全部禁用", state: statemachine.Starting,
			statusText:  "探测中…",
			stopVisible: true, stopEnabled: false, restartVisible: true, restartEnabled: false,
			openEnabled: false, viewLogsEnabled: true, quitEnabled: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := MenuModelFor(tt.state, 19980, false)

			// 状态项：恒可见、恒禁用（纯展示）、文本随态
			st, ok := m.Find(ItemStatus)
			if !ok || !st.Visible {
				t.Fatalf("状态项缺失或不可见: %+v", st)
			}
			if st.Enabled {
				t.Fatalf("状态项应为禁用展示项（仅展示）")
			}
			if st.Label != tt.statusText {
				t.Fatalf("状态项文本 = %q, want %q", st.Label, tt.statusText)
			}

			// 基线项：每态都含（可见）；其中只读工具项不随服务状态禁用，退出永远可用
			for _, id := range baselineIDs {
				it, ok := m.Find(id)
				if !ok || !it.Visible {
					t.Fatalf("基线项 %d 缺失或不可见", id)
				}
			}
			for _, id := range []ItemID{ItemCopyURL, ItemOpenDataDir, ItemViewLogs, ItemCheckUpdate, ItemAbout, ItemQuit} {
				it, _ := m.Find(id)
				if !it.Enabled {
					t.Fatalf("只读工具项 %d 不应被禁用", id)
				}
			}

			// 打开工作台 = 默认项（加粗 = 左键行为）
			open, _ := m.Find(ItemOpen)
			if !open.Default {
				t.Fatalf("打开工作台应为默认项")
			}
			if open.Enabled != tt.openEnabled {
				t.Fatalf("打开工作台 Enabled = %v, want %v", open.Enabled, tt.openEnabled)
			}

			// 服务操作项的可见/可用矩阵
			assertItem := func(id ItemID, wantVisible, wantEnabled bool) {
				t.Helper()
				it, ok := m.Find(id)
				if !ok {
					t.Fatalf("菜单项 %d 缺失（未建即隐藏也应入模型）", id)
				}
				if it.Visible != wantVisible {
					t.Fatalf("菜单项 %d Visible = %v, want %v", id, it.Visible, wantVisible)
				}
				if it.Enabled != wantEnabled {
					t.Fatalf("菜单项 %d Enabled = %v, want %v", id, it.Enabled, wantEnabled)
				}
			}
			assertItem(ItemStart, tt.startVisible, tt.startEnabled)
			assertItem(ItemStop, tt.stopVisible, tt.stopEnabled)
			assertItem(ItemRestart, tt.restartVisible, tt.restartEnabled)

			if got := m.IsEnabled(ItemViewLogs); got != tt.viewLogsEnabled {
				t.Fatalf("查看日志可用 = %v, want %v", got, tt.viewLogsEnabled)
			}
			if got := m.IsEnabled(ItemQuit); got != tt.quitEnabled {
				t.Fatalf("退出可用 = %v, want %v", got, tt.quitEnabled)
			}

			// 无 pending：两项均不可见
			if m.IsVisible(ItemPendingUpdate) || m.IsVisible(ItemApplyUpdate) {
				t.Fatalf("hasPendingUpdate=false 时不应出现 pending 项")
			}
		})
	}
}

func TestMenuModelStatusTextPort(t *testing.T) {
	m := MenuModelFor(statemachine.Green, 7777, false)
	st, _ := m.Find(ItemStatus)
	if want := "运行中 · 127.0.0.1:7777"; st.Label != want {
		t.Fatalf("状态项文本 = %q, want %q", st.Label, want)
	}
}

// TestMenuModelPendingUpdate pending 项在任意态追加；启用遵循该态的服务操作防抖规则
func TestMenuModelPendingUpdate(t *testing.T) {
	applyEnabledByState := map[statemachine.State]bool{
		statemachine.Green:    true,
		statemachine.Gray:     true,
		statemachine.Red:      true,
		statemachine.Yellow:   false, // 防抖：启动窗口内禁用服务操作
		statemachine.Starting: false,
	}
	for _, state := range []statemachine.State{statemachine.Green, statemachine.Gray, statemachine.Yellow, statemachine.Red, statemachine.Starting} {
		t.Run(state.String(), func(t *testing.T) {
			m := MenuModelFor(state, 19980, true)
			pending, ok := m.Find(ItemPendingUpdate)
			if !ok || !pending.Visible {
				t.Fatalf("pending 展示项缺失或不可见")
			}
			if pending.Enabled {
				t.Fatalf("pending 展示项应为禁用（纯展示）")
			}
			apply, ok := m.Find(ItemApplyUpdate)
			if !ok || !apply.Visible {
				t.Fatalf("「立即重启以应用」项缺失或不可见")
			}
			if want := applyEnabledByState[state]; apply.Enabled != want {
				t.Fatalf("「立即重启以应用」Enabled = %v, want %v", apply.Enabled, want)
			}
		})
	}
}

func TestMenuModelHelpers(t *testing.T) {
	m := MenuModelFor(statemachine.Green, 19980, false)
	if m.IsVisible(ItemPendingUpdate) {
		t.Fatalf("不存在语义：pending 不可见")
	}
	if m.IsEnabled(ItemPendingUpdate) {
		t.Fatalf("不存在语义：pending 不可用")
	}
	// Green 下 Start 隐藏 → IsEnabled 为 false（不可见即不可用）
	if m.IsVisible(ItemStart) || m.IsEnabled(ItemStart) {
		t.Fatalf("Green 下启动服务应隐藏")
	}
}
