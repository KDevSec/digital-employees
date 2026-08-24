// Package menu 菜单构建与状态联动（设计 §4，TR-03）——纯函数产出展示模型。
// Wave 5 组装层按 Items 渲染 systray 菜单并绑定回调。
package menu

import (
	"strconv"

	"workbench-tray/internal/brand"
	"workbench-tray/internal/statemachine"
)

// ItemID 菜单项标识
type ItemID uint8

const (
	ItemStatus        ItemID = iota // 状态项（禁用展示，随四态与端口更新）
	ItemOpen                        // 打开工作台（默认项 = 左键行为）
	ItemCopyURL                     // 复制访问地址
	ItemStart                       // 启动服务
	ItemStop                        // 停止服务
	ItemRestart                     // 重启服务
	ItemViewLogs                    // 查看日志
	ItemOpenDataDir                 // 打开数据目录
	ItemCheckUpdate                 // 检查更新
	ItemPendingUpdate               // 有更新已就绪（禁用展示项，C-8 壳侧落点）
	ItemApplyUpdate                 // 立即重启以应用
	ItemAbout                       // 关于
	ItemQuit                        // 退出（仅退壳，不停服务——服务归 OS 守护）
)

// MenuItem 单个菜单项的展示语义
type MenuItem struct {
	ID      ItemID
	Label   string
	Visible bool
	Enabled bool
	Default bool // 默认项（加粗，= 左键行为）
}

// MenuModel 某一时刻的完整菜单展示模型
type MenuModel struct {
	Items []MenuItem
}

// Find 按 ID 取菜单项
func (m MenuModel) Find(id ItemID) (MenuItem, bool) {
	for _, it := range m.Items {
		if it.ID == id {
			return it, true
		}
	}
	return MenuItem{}, false
}

// IsVisible 便捷查询（不存在视为不可见）
func (m MenuModel) IsVisible(id ItemID) bool {
	it, ok := m.Find(id)
	return ok && it.Visible
}

// IsEnabled 便捷查询（不存在或不可见视为不可用）
func (m MenuModel) IsEnabled(id ItemID) bool {
	it, ok := m.Find(id)
	return ok && it.Visible && it.Enabled
}

// serviceOpsFrozen 黄态/初始态防抖：启动窗口内全部服务操作禁用（设计 §3 黄态硬规则的菜单面）
func serviceOpsFrozen(state statemachine.State) bool {
	return state == statemachine.Yellow || state == statemachine.Starting
}

// MenuModelFor 纯函数：状态 + 端口 + pending 标记 → 完整菜单展示模型。
//
// 状态联动（设计 §4.1 + §3 菜单联动列）：
//   - Green：显示停止/重启，隐藏启动；打开可用
//   - Gray：显示启动，隐藏停止/重启；打开可用（TR-04 拉起再开）
//   - Yellow/Starting：全部服务操作禁用（防抖），状态项「启动中…/探测中…」
//   - Red：显示重启（+基线项查看日志被强调），状态项「异常」
//   - 只读工具项（复制地址/数据目录/日志/检查更新/关于/退出）任何态都可用
//   - pending：追加禁用展示项「⬆ 新版本已就绪」+「立即重启以应用」（启用规则同服务操作）
func MenuModelFor(state statemachine.State, port int, hasPendingUpdate bool) MenuModel {
	frozen := serviceOpsFrozen(state)

	statusText := "探测中…"
	switch state {
	case statemachine.Green:
		statusText = "运行中 · " + brand.LoopbackHost + ":" + strconv.Itoa(port)
	case statemachine.Yellow:
		statusText = "启动中…"
	case statemachine.Gray:
		statusText = "已停止"
	case statemachine.Red:
		statusText = "异常"
	}

	// 服务操作项的可见性矩阵（Red 只留重启；Gray 只留启动；Green 留停止+重启）
	showStart := state == statemachine.Gray
	showStop := state == statemachine.Green || state == statemachine.Yellow || state == statemachine.Starting
	showRestart := state != statemachine.Gray
	// 打开工作台：服务就绪（Green）或明确可用（Gray 拉起再开）时可用；
	// Red 下服务已确认异常（重启才是出路）、Yellow/Starting 防抖禁用
	openEnabled := state == statemachine.Green || state == statemachine.Gray

	// 全部项都入模型（含隐藏项）——Wave 5 组装层统一按 Visible 渲染，避免「缺项」歧义
	m := MenuModel{Items: []MenuItem{
		{ID: ItemStatus, Label: statusText, Visible: true, Enabled: false},
		{ID: ItemPendingUpdate, Label: "⬆ 新版本已就绪", Visible: hasPendingUpdate, Enabled: false},
		{ID: ItemOpen, Label: "打开工作台", Visible: true, Enabled: openEnabled, Default: true},
		{ID: ItemCopyURL, Label: "复制访问地址", Visible: true, Enabled: true},
		{ID: ItemStart, Label: "启动服务", Visible: showStart, Enabled: showStart},
		{ID: ItemStop, Label: "停止服务", Visible: showStop, Enabled: showStop && !frozen},
		{ID: ItemRestart, Label: "重启服务", Visible: showRestart, Enabled: showRestart && !frozen},
		{ID: ItemApplyUpdate, Label: "立即重启以应用", Visible: hasPendingUpdate, Enabled: hasPendingUpdate && !frozen},
		{ID: ItemViewLogs, Label: "查看日志", Visible: true, Enabled: true},
		{ID: ItemOpenDataDir, Label: "打开数据目录", Visible: true, Enabled: true},
		{ID: ItemCheckUpdate, Label: "检查更新…", Visible: true, Enabled: true},
		{ID: ItemAbout, Label: "关于", Visible: true, Enabled: true},
		{ID: ItemQuit, Label: "退出", Visible: true, Enabled: true},
	}}
	return m
}
