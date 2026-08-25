// workbench-tray 托盘壳组装层（Task 16 / Wave 5）：GUI 层 + 执行层，消费 internal/* 纯模块。
//
// 红线（托盘壳设计 v0.1 卷首）：壳不承担唯一保活责任（W-2：杀壳服务活）；
// 壳零业务逻辑——启停/探活数据全走 workbench CLI / /healthz / run/*.json，壳内无服务语义。
//
// 平台注记：V0.1 仅面向 Windows（syscall.SysProcAttr.CreationFlags 与 registry 均
// Windows 专属；darwin 变体归 0.2，状态机/契约/菜单模型全部平台无关已就位）。
// runtime.LockOSThread（设计 §2）由 systray.Run 内部完成（systray.go:37），不重复加锁。
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"fyne.io/systray"
	"golang.org/x/sys/windows/registry"

	"workbench-tray/internal/actions"
	"workbench-tray/internal/autostart"
	"workbench-tray/internal/brand"
	"workbench-tray/internal/contract"
	"workbench-tray/internal/icons"
	"workbench-tray/internal/menu"
	"workbench-tray/internal/probe"
	"workbench-tray/internal/singleton"
	"workbench-tray/internal/statemachine"
	"workbench-tray/internal/traylog"
)

const (
	// trayVersion 壳版本线（与服务版本分离，W-12 双版本线；versioninfo.json 的 FileVersion 与此同步）
	trayVersion = "0.1.0"
	// probeInterval 探活间隔（设计 §3 默认 5s；黄态加密 2s 是 T-Q1 开放问题，M3 实测冷启动分布后定）
	probeInterval = 5 * time.Second
	// createNoWindow CREATE_NO_WINDOW：GUI 壳（-H windowsgui）拉起控制台子进程不闪黑窗
	createNoWindow = 0x08000000
	// cliOutMaxLimit CLI 段输出进 traylog 的截断上限（防巨包刷爆日志）
	cliOutMaxLimit = 512
	// singletonName 单实例命名空间基础名（2026-08-25 用户裁决·方案 B）：Local\ 前缀由
	// singleton 包统一加，互斥体 Local\workbench-tray / 唤醒事件 Local\workbench-tray.wakeup
	singletonName = "workbench-tray"
)

// app 托盘壳运行体：全部可变状态由 mu 串行化（探活循环/菜单回调/信号处理并发三源）
type app struct {
	mu         sync.Mutex
	logger     *traylog.Logger
	profileDir string
	serviceExe string // 与壳 exe 同目录的 workbench.exe（TR-09 双制品兄弟路径）
	trayExe    string
	client     probe.Client

	// 探活外部计数器（statemachine 是无状态纯函数，计数纪律在壳侧——见 internal/statemachine 注释）
	state            statemachine.State
	port             int
	consecutiveFails int
	firstFailAt      time.Time
	// handleWasThere 上一轮 service.json 是否存在：两轮间消失 = 外部优雅停止（CLI stop 清
	// discovery 文件）→ 喂 UserStop 落灰（设计 §3 Gray 进入条件），不与用户意志对抗；
	// 崩溃（taskkill）留 stale 文件 → 走 ProbeFail → YELLOW/RED 恢复路径——两态由此区分
	handleWasThere bool

	// 去抖标记（见 applyIfNeededLocked）：appliedPort 初始 -1 保证 onReady 首次必应用
	appliedState statemachine.State
	appliedPort  int

	items map[menu.ItemID]*systray.MenuItem
}

func main() {
	a := newApp()

	// 单实例 + 唤醒重定向（2026-08-25 用户裁决·方案 B，修复双图标 bug）。调用序不可倒：
	// NewWatcher 必须先于 TryLock——第二实例 Notify 时事件对象必然有人常驻持句柄，
	// 信号零丢失窗口（见 singleton 包注）。两步任一系统调用失败均降级不杀壳
	// （对齐 TR-06「注册失败不挡托盘出现」的裁决风格）：Watcher 失败 → 防双开仍由
	// mutex 侧独立生效、仅唤醒重定向失效；TryLock 失败 → 起壳（可能双开，比起不来轻）
	w, werr := singleton.NewWatcher(singletonName)
	if werr != nil {
		a.logger.Event("tray.singleton_watcher_failed", map[string]any{"error": werr.Error()})
	}
	lock, lerr := singleton.TryLock(singletonName)
	if lerr != nil {
		a.logger.Event("tray.singleton_probe_failed", map[string]any{"error": lerr.Error()})
	} else if !lock.Owned {
		// 已有实例在跑：唤醒它打开工作台（= 用户点快捷方式/双击 exe 的意图），自己退出——不再叠图标
		rec := map[string]any{"pid": os.Getpid()}
		if nerr := singleton.NotifyExisting(singletonName); nerr != nil {
			rec["notify_error"] = nerr.Error()
		}
		a.logger.Event("tray.duplicate_exit", rec)
		_ = lock.Close()
		_ = w.Close()
		_ = a.logger.Close()
		return
	}

	// tray.start 移到单实例判定后（原在 newApp）：第二实例不再冒充 tray.start，
	// 其唯一痕迹是上面的 tray.duplicate_exit——日志读者可无歧义区分首实例与重开尝试
	a.logger.Event("tray.start", map[string]any{
		"trayVersion": trayVersion,
		"profileDir":  a.profileDir,
		"serviceExe":  a.serviceExe,
		"pid":         os.Getpid(),
	})
	go a.watchWakeups(w)
	a.applyAutostart() // TR-06：注册失败不挡托盘出现（错误只落 traylog/stderr）
	systray.Run(a.onReady, a.onExit)
}

// watchWakeups 单实例唤醒重定向消费端（方案 B）：第二实例 NotifyExisting 置位事件 →
// 此处 Wait 命中 → openWorkbench（= 左键单击行为，「我要用工作台」的意图闭环）。
// INFINITE 常驻等，进程退出时 OS 回收；Wait 返回 false（句柄失效/WAIT_FAILED）即退循环。
// w 为 nil（NewWatcher 降级）时静默不监听——防双开不受影响，仅唤醒重定向失效。
func (a *app) watchWakeups(w *singleton.Watcher) {
	if w == nil {
		return
	}
	for w.Wait(-1) {
		a.logger.Event("tray.wakeup", nil)
		a.openWorkbench()
	}
}

// newApp 解析路径与日志（tray.start 事件由 main 在单实例判定通过后记——第二实例
// 不冒充 tray.start，其痕迹是 tray.duplicate_exit；Task 16：serviceExe 解析结果随 tray.start 落 traylog）
func newApp() *app {
	profileDir := probe.ProfileDir()
	trayExe, err := os.Executable()
	if err != nil {
		trayExe = ""
	}
	serviceExe := filepath.Join(filepath.Dir(trayExe), "workbench.exe")

	logger, err := traylog.Open(profileDir)
	if err != nil {
		// 降级：profile 不可写不能杀壳（托盘必须照常出现）——nil 句柄静默丢弃事件
		fmt.Fprintf(os.Stderr, "traylog: 打开 %s 失败：%v（事件将丢弃）\n", profileDir, err)
		logger = &traylog.Logger{}
	}

	a := &app{
		logger:      logger,
		profileDir:  profileDir,
		serviceExe:  serviceExe,
		trayExe:     trayExe,
		client:      probe.DefaultClient(),
		state:       statemachine.Starting,
		appliedPort: -1, // 保证 onReady 首次 apply 必触发（真实端口恒 > 0）
		items:       make(map[menu.ItemID]*systray.MenuItem),
	}
	a.handleWasThere = fileExists(filepath.Join(profileDir, "run", "service.json"))
	return a
}

// ---------- 生命周期 ----------

func (a *app) onReady() {
	a.logger.Event("tray.ready", nil)
	a.buildMenu()
	a.mu.Lock()
	a.applyIfNeededLocked() // 初始 Starting 态联动（图标/状态项「探测中…」）
	a.mu.Unlock()
	// 启动即活（2026-08-25 用户裁决补 UX 缺口：托盘退出后重开，服务应立即可用而非等 30s 红态自愈）：
	// 托盘被用户显式启动（双击/快捷方式/登录自启）= 用户要产品在跑——立即探测一次，
	// 不健康就 spawn start（用户路径清 user-stopped 哨兵，与后台 __daemon 尊重哨兵的语义正交：
	// 后台不对抗用户停止，前台启动代表新的用户意图）。start 幂等（D-020 五分支），与探活循环/红态恢复并发安全。
	go func() {
		port := probe.DiscoverPort(a.profileDir)
		if r := probe.Probe(a.client, port); !r.Ok {
			a.logger.Event("tray.launch_revive", map[string]any{"port": port, "own": r.Own})
			a.runAction("launch_revive", actions.Start())
		}
	}()
	// 左键单击直达（TR-04）：v1.12.2 即有 SetOnTapped（Windows WM_LBUTTONUP），
	// 设置后左键不再弹菜单（菜单归右键）——设计 §4.2 的左键语义。
	// I-1（Wave 5 审查修复）：回调在 wndProc 线程同步执行，probe(≤2s) + health-wait(≤15s)
	// 会阻塞消息循环——期间菜单弹不出、Windows 判 hung。必须 go 异步化；
	// 全链服务幂等（单实例判定五分支），并发双 start 安全（审查已论证）
	systray.SetOnTapped(func() { go a.openWorkbench() })
	go a.watchSignals()
	go a.watchMenu()
	go a.probeLoop()
}

func (a *app) onExit() {
	_ = a.logger.Close()
}

// watchSignals SIGTERM/SIGINT → 退壳（记 tray.quit；服务不停——服务独立生存，归 OS 守护）。
// 注：windowsgui 构建下控制台信号不可达（无控制台可投递），真实退出路径走
// WM_CLOSE/WM_ENDSESSION → wndProc → systray 退出回调；本路径保留供 -H console
// 调试形态（开发期不带旗标跑 go build 时 Ctrl+C 可退）
func (a *app) watchSignals() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
	sig := <-ch
	a.logger.Event("tray.quit", map[string]any{"via": "signal", "signal": sig.String()})
	systray.Quit()
}

// ---------- 探活循环（TR-02/TR-05） ----------

func (a *app) probeLoop() {
	a.tick() // 立即首探：Starting → 真实态，不等首个 5s
	t := time.NewTicker(probeInterval)
	defer t.Stop()
	for range t.C {
		a.tick()
	}
}

// tick 单轮探活：端口发现 → 探测 → 事件构造 → 状态机 → 联动 + 落日志。
// 每轮都落 probe 事件（含未迁移态）——冒烟脚本轮询消费的就是它。
func (a *app) tick() {
	a.mu.Lock()
	defer a.mu.Unlock()

	port := probe.DiscoverPort(a.profileDir)
	handleThere := fileExists(filepath.Join(a.profileDir, "run", "service.json"))
	res := probe.Probe(a.client, port)
	a.port = port

	var ev statemachine.Event
	switch {
	case res.Ok:
		ev = statemachine.ProbeOk{}
		a.consecutiveFails = 0
		a.firstFailAt = time.Time{}
	case a.handleWasThere && !handleThere:
		// service.json 两轮间消失 = 外部优雅停止（stopCommand clearDiscoveryFiles）
		ev = statemachine.UserStop{}
		a.consecutiveFails = 0
		a.firstFailAt = time.Time{}
	default:
		a.consecutiveFails++
		if a.firstFailAt.IsZero() {
			a.firstFailAt = time.Now()
		}
		ev = statemachine.ProbeFail{
			Fails:     a.consecutiveFails,
			ElapsedMs: time.Since(a.firstFailAt).Milliseconds(),
		}
	}
	a.handleWasThere = handleThere

	a.feedLocked(ev)
	// 端口可能无状态迁移地变（config 改端口后服务重启）——TR-03「状态项与实际端口一致」
	a.applyIfNeededLocked()
	a.logger.Event("probe", map[string]any{
		"state":            a.state.String(),
		"port":             a.port,
		"ok":               res.Ok,
		"own":              res.Own, // 端口在但非自家 = 冲突态诊断位（设计 §3）
		"consecutiveFails": a.consecutiveFails,
	})
}

// feedLocked 喂事件给状态机并应用迁移（tick 与用户动作共用；调用方持 mu）。
// 顺序：先记状态迁移、后执行恢复动作——日志里「入红 → 恢复」的因果序可读（冒烟按此断言次序）
func (a *app) feedLocked(ev statemachine.Event) {
	tr := statemachine.Next(a.state, ev)
	if tr.State != a.state {
		a.logger.Event("state.change", map[string]any{"from": a.state.String(), "to": tr.State.String()})
		a.state = tr.State
	}
	if tr.ShouldRecover {
		a.recoverOnce() // 恰好一次由状态机保证（ShouldRecover 仅进入 RED 时为 true）
	}
	a.applyIfNeededLocked()
}

// applyIfNeededLocked 去抖：状态或端口变化才重放 GUI 联动（SetIcon/SetTitle 都是
// 消息循环往返，每 5s 无脑重放是无谓抖动；菜单联动本就纯状态函数，幂等）
func (a *app) applyIfNeededLocked() {
	if a.state == a.appliedState && a.port == a.appliedPort {
		return
	}
	a.appliedState = a.state
	a.appliedPort = a.port
	a.applyStateLocked()
}

// applyStateLocked 四态联动：图标 + Tooltip + 菜单（调用方持 mu）
func (a *app) applyStateLocked() {
	m := menu.MenuModelFor(a.state, a.port, false)

	switch a.state {
	case statemachine.Green:
		systray.SetIcon(icons.GreenIco())
	case statemachine.Yellow, statemachine.Starting:
		systray.SetIcon(icons.YellowIco())
	case statemachine.Gray:
		systray.SetIcon(icons.GrayIco())
	case statemachine.Red:
		systray.SetIcon(icons.RedIco())
	}
	if it, ok := m.Find(menu.ItemStatus); ok {
		systray.SetTooltip(brand.DisplayName + " · " + it.Label)
	}

	for id, item := range a.items {
		mi, ok := m.Find(id)
		if !ok {
			continue
		}
		switch id {
		case menu.ItemStatus:
			item.SetTitle(mi.Label) // 状态项恒为禁用展示项
			item.Disable()
		case menu.ItemAbout:
			// 关于 = 禁用信息项，双版本线（W-12）：workbench v<service.json version> · 壳 v<trayVersion>。
			// 弹窗需要窗口框架（V0.1 无），版本文本入菜单项承载
			svc := serviceVersion(a.profileDir)
			if svc == "" {
				svc = "?"
			}
			item.SetTitle("关于 workbench v" + svc + " · 壳 v" + trayVersion)
			item.Disable()
		default:
			// 简化裁决（Task 16）：模型 Visible=false 一律映射为 Disabled——
			// fyne.io/systray v1.12.2 的 Hide()/Show() 在 Windows 上 re-show 会把项
			// 追加到菜单尾部（systray_windows.go addOrUpdateMenuItem 走末位插入），
			// 动态显隐打乱固定布局，改用禁用语义
			if !mi.Visible || !mi.Enabled {
				item.Disable()
			} else {
				item.Enable()
			}
		}
	}
}

// ---------- 红态恢复（TR-05：恰好一次） ----------

// recoverOnce 红态接管（设计 §3）：壳只做一件事——调 workbench start 一次；
// 不做循环自愈（进程级归 OS 守护，壳只补 health 级这一层）。
// CLI 段形状消费 actions 纯模块（I-2：组装层不手写段），事件名保持冒烟契约稳定
func (a *app) recoverOnce() {
	a.logger.Event("recover.start", map[string]any{"exe": a.serviceExe})
	for _, seg := range actions.BuildCliArgs(actions.Start()) {
		if pid, err := a.spawnDaemon(seg); err != nil {
			a.logger.Event("recover.start_failed", map[string]any{"error": err.Error()})
		} else {
			a.logger.Event("recover.start_spawned", map[string]any{"pid": pid})
		}
	}
}

// ---------- 菜单构建与回调（TR-03） ----------

// menuOrder 创建顺序 = 展示顺序（menu.MenuModelFor Items 序 + 设计 §4.1 分组分隔线）
var menuOrder = []menu.ItemID{
	menu.ItemStatus,
	menu.ItemOpen,
	menu.ItemCopyURL,
	menu.ItemStart,
	menu.ItemStop,
	menu.ItemRestart,
	menu.ItemViewLogs,
	menu.ItemOpenDataDir,
	menu.ItemCheckUpdate,
	menu.ItemAbout,
	menu.ItemQuit,
}

var menuNames = map[menu.ItemID]string{
	menu.ItemStatus:      "status",
	menu.ItemOpen:        "open",
	menu.ItemCopyURL:     "copyURL",
	menu.ItemStart:       "start",
	menu.ItemStop:        "stop",
	menu.ItemRestart:     "restart",
	menu.ItemViewLogs:    "viewLogs",
	menu.ItemOpenDataDir: "openDataDir",
	menu.ItemCheckUpdate: "checkUpdate",
	menu.ItemAbout:       "about",
	menu.ItemQuit:        "quit",
}

func (a *app) buildMenu() {
	// 无锁写 a.items 的初始化顺序不变量：buildMenu 在 onReady 里先于全部读方 goroutine
	// （probeLoop/watchMenu/菜单回调/左键协程）启动——map 建好后才有并发读者，无竞态；
	// U 系列若需运行期增删菜单项（pending 项动态创建），必须改为持 mu 或专用锁
	a.items[menu.ItemStatus] = systray.AddMenuItem("探测中…", "服务状态")
	a.items[menu.ItemOpen] = systray.AddMenuItem("打开工作台", "打开默认浏览器（= 左键单击行为）")
	a.items[menu.ItemCopyURL] = systray.AddMenuItem("复制访问地址", "复制 http://127.0.0.1:<port>")
	systray.AddSeparator()
	a.items[menu.ItemStart] = systray.AddMenuItem("启动服务", "启动服务")
	a.items[menu.ItemStop] = systray.AddMenuItem("停止服务", "停止服务（有在飞任务时需确认）")
	a.items[menu.ItemRestart] = systray.AddMenuItem("重启服务", "重启服务（等 healthz 就绪）")
	systray.AddSeparator()
	a.items[menu.ItemViewLogs] = systray.AddMenuItem("查看日志", "explorer 打开 logs/ 目录")
	a.items[menu.ItemOpenDataDir] = systray.AddMenuItem("打开数据目录", "explorer 打开 profile 目录")
	a.items[menu.ItemCheckUpdate] = systray.AddMenuItem("检查更新…", "检查更新")
	a.items[menu.ItemAbout] = systray.AddMenuItem("关于", "版本信息")
	systray.AddSeparator()
	a.items[menu.ItemQuit] = systray.AddMenuItem("停止服务并退出", "优雅停止服务（守护不再自动拉起）并退出托盘")

	// 菜单构建日志（冒烟断言消费；也即 TR-03「点击链路留人眼验收」外的可脚本化证据）
	names := make([]string, 0, len(menuOrder))
	for _, id := range menuOrder {
		names = append(names, menuNames[id])
	}
	a.logger.Event("menu.build", map[string]any{"items": names})
}

// watchMenu 每项一 goroutine 监听 ClickedCh（systray 惯用法）；exec 阻塞不互相拖累探活
func (a *app) watchMenu() {
	for _, id := range menuOrder {
		id, ch := id, a.items[id].ClickedCh
		go func() {
			for range ch {
				a.onMenu(id)
			}
		}()
	}
}

func (a *app) onMenu(id menu.ItemID) {
	a.logger.Event("menu.click", map[string]any{"item": menuNames[id]})
	switch id {
	case menu.ItemOpen:
		a.openWorkbench()
	case menu.ItemCopyURL:
		a.copyURL()
	case menu.ItemStart:
		a.runAction("start", actions.Start())
		a.mu.Lock()
		a.feedLocked(statemachine.UserStart{}) // 状态不即时变更（等探活确认），喂事件保持语义对齐
		a.mu.Unlock()
	case menu.ItemStop:
		a.stopWithActivityCheck()
	case menu.ItemRestart:
		a.runAction("restart", actions.Restart())
	case menu.ItemViewLogs:
		a.explorerOpen(actions.LogsDirPath(a.profileDir))
	case menu.ItemOpenDataDir:
		a.explorerOpen(actions.DataDirPath(a.profileDir))
	case menu.ItemCheckUpdate:
		// U 系列未落地（Wave 5 无 update 通道）：占位记事件，U 系列落地后接 workbench update --check
		a.logger.Event("update_check_pending", nil)
	case menu.ItemQuit:
		// 2026-08-25 用户裁决：退出 = 停止服务并退出（不再有「仅退壳」入口）。
		// 停止走既有 CLI 链路（stop 落 user-stopped 哨兵 -> 守护不复活），壳仍零业务；
		// 意外死亡路径（taskkill/崩溃）不受影响——那是 W-2 红线的领域（服务独立生存）。
		a.logger.Event("tray.quit", map[string]any{"via": "menu", "stops_service": true})
		go func() {
			a.runAction("quit", actions.Stop())
			systray.Quit()
		}()
	}
}

// ---------- 执行层（TR-03：菜单动作 → CLI/explorer/浏览器） ----------

// runAction 多段循环 exec（actions.BuildCliArgs 的段序不可乱，每段完成才下一段）。
// 段失败记 traylog 继续（Task 16 裁决：Restart 的 stop 段失败于「已停止」不能挡住 start 段）
func (a *app) runAction(name string, act actions.Action) {
	for _, seg := range actions.BuildCliArgs(act) {
		if isDaemonSegment(seg) {
			if _, err := a.spawnDaemon(seg); err != nil {
				a.logger.Event("action.segment_failed", map[string]any{
					"action": name, "args": seg, "error": err.Error(),
				})
			}
			continue
		}
		if _, err := a.runCli(seg); err != nil {
			a.logger.Event("action.segment_failed", map[string]any{
				"action": name, "args": seg, "error": err.Error(),
			})
		}
	}
	a.logger.Event("action.done", map[string]any{"action": name})
}

// isDaemonSegment start 段是常驻命令（前台 daemon 形态，S-02）：Run 会永挂，
// 必须 detached spawn；stop/__health-wait/activity 是完成即退命令，Run 等退出码
func isDaemonSegment(seg []string) bool {
	return len(seg) > 0 && seg[0] == "start"
}

// spawnDaemon 常驻 CLI 段：Start() 不等待，goroutine Wait 回收句柄。
// 返回 pid 供调用方日志归因（recover / 动作 start 段 / 左键拉起）
func (a *app) spawnDaemon(seg []string) (int, error) {
	cmd := exec.Command(a.serviceExe, seg...)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow}
	if err := cmd.Start(); err != nil {
		a.logger.Event("cli.spawn_failed", map[string]any{"args": seg, "error": err.Error()})
		return 0, err
	}
	a.logger.Event("cli.spawn", map[string]any{"args": seg, "pid": cmd.Process.Pid})
	go func() { _ = cmd.Wait() }()
	return cmd.Process.Pid, nil
}

// runCli 单段 CLI exec（等退出码；CREATE_NO_WINDOW 防 GUI 壳拉子进程闪黑窗），输出截断记 traylog
func (a *app) runCli(args []string) ([]byte, error) {
	cmd := exec.Command(a.serviceExe, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow}
	out, err := cmd.CombinedOutput()
	rec := map[string]any{"args": args, "exit": exitCode(err)}
	if len(out) > 0 {
		rec["out"] = truncateOut(string(out))
	}
	a.logger.Event("cli.segment", rec)
	return out, err
}

// stopWithActivityCheck TR-07 停止前活动检查：activity 段输出 → contract.ParseActivity
// （字段名契约单源）→ Total() > 0 时跳过停止。确认窗需要窗口框架（V0.1 无 GUI 框架），
// 窗口留业务填充——当前策略是保守跳过（V0.1 在飞任务恒为零，链路即验收面）。
// 解析失败仍停（审查 M-8 记账：activity 命令失败/坏输出极罕见，V0.1 风险≈0）
func (a *app) stopWithActivityCheck() {
	for _, seg := range actions.BuildCliArgs(actions.Activity()) {
		out, err := a.runCli(seg)
		if err != nil {
			a.logger.Event("activity.probe_failed", map[string]any{"args": seg, "error": err.Error()})
			continue
		}
		info, perr := contract.ParseActivity(out)
		if perr != nil {
			a.logger.Event("activity.parse_failed", map[string]any{"error": perr.Error()})
			continue
		}
		if info.Total() > 0 {
			a.logger.Event("stop_confirmed_needed", map[string]any{
				"conversationTasks": info.ConversationTasks,
				"triggerTasks":      info.TriggerTasks,
			})
			return
		}
	}
	a.runAction("stop", actions.Stop())
	// 用户意志即时落灰（设计 §3：CLI stop 成功 → GRAY），不等下轮探活（期间 YELLOW 瞬态是噪音）
	a.mu.Lock()
	a.feedLocked(statemachine.UserStop{})
	a.mu.Unlock()
}

// openWorkbench 左键直达/打开工作台（TR-04，设计 §4.2）：
// 就绪直开；未就绪「拉起 + 等 healthz（15s）+ 开浏览器」——不让用户看到浏览器连接失败。
// CLI 段全部消费 actions 纯模块（I-2）：预算统一引用 actions.HealthWaitBudgetMs，
// 组装层不手写段与 15000 字面量
func (a *app) openWorkbench() {
	a.logger.Event("tray.open", nil)
	port := probe.DiscoverPort(a.profileDir)
	if probe.Probe(a.client, port).Ok {
		a.openBrowser(port)
		return
	}
	a.logger.Event("open.starting", map[string]any{"port": port})
	a.setStatusTitle("启动中…") // 等待期间状态项（Task 16）
	for _, seg := range actions.BuildCliArgs(actions.Start()) {
		if _, err := a.spawnDaemon(seg); err != nil {
			a.logger.Event("open.failed", map[string]any{"port": port, "error": err.Error()})
			return
		}
	}
	for _, seg := range actions.BuildCliArgs(actions.HealthWait(actions.HealthWaitBudgetMs)) {
		if _, err := a.runCli(seg); err != nil {
			// 超时不开浏览器（白屏比不开更糟）；失败气泡留 GUI 框架，V0.1 记日志
			a.logger.Event("open.failed", map[string]any{"port": port, "error": err.Error()})
			return
		}
	}
	a.openBrowser(port)
}

// openBrowser 开默认浏览器（设计 §4.2 ShellExecute；与服务侧 openBrowser 同款 rundll32 形态，
// 同样尊重 WORKBENCH_NO_BROWSER=1 抑制位——冒烟环境不开真浏览器）
func (a *app) openBrowser(port int) {
	if os.Getenv("WORKBENCH_NO_BROWSER") == "1" {
		a.logger.Event("open.browser_suppressed", nil)
		return
	}
	url := actions.OpenBrowserURL(port)
	a.logger.Event("open.browser", map[string]any{"url": url})
	// rundll32 是 GUI 子系统进程（无黑窗）。go Run：不阻塞回调 + 回收句柄；
	// 惯常非零退出码不判（浏览器接管后的生命周期不归壳）
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	go func() { _ = cmd.Run() }()
}

// copyURL 复制地址到剪贴板。任务指令原形 cmd /c echo <url> | clip——改 clip stdin 直灌：
// 避开 cmd 引号转义 + 不往剪贴板塞尾部 CRLF（等效更净，裁决记录于此）
func (a *app) copyURL() {
	url := actions.OpenBrowserURL(probe.DiscoverPort(a.profileDir))
	a.logger.Event("menu.copy_url", map[string]any{"url": url})
	cmd := exec.Command("clip")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow}
	cmd.Stdin = strings.NewReader(url)
	if err := cmd.Run(); err != nil {
		a.logger.Event("copy_url_failed", map[string]any{"error": err.Error()})
	}
}

// explorerOpen 打开目录：explorer 立即返回且惯常回传非零退出码——go Run 不阻塞回调
// 且回收句柄，退出码不判（打开失败由 explorer 自身弹窗兜底）
func (a *app) explorerOpen(path string) {
	a.logger.Event("menu.explorer", map[string]any{"path": path})
	cmd := exec.Command("explorer", path)
	go func() { _ = cmd.Run() }()
}

// setStatusTitle 左键等待期间的乐观状态项文本（状态机仍是唯一事实源，下轮 tick 会重放真实态）
func (a *app) setStatusTitle(title string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if it, ok := a.items[menu.ItemStatus]; ok {
		it.SetTitle(title)
	}
}

// ---------- 自启注册（TR-06，设计 §5） ----------

// applyAutostart 哨兵 + settings.json 四象限判定 → HKCU Run 注册/注销。
// settings.json 的 system.tray.enabled 文件不存在/坏 JSON/字段缺失均视为 true
// （Task 16 简化：V0.1 服务侧 settings 尚未落盘，缺省自启开）。
func (a *app) applyAutostart() {
	setting := readTraySetting(a.profileDir)
	sentinel := autostart.SentinelPath(a.profileDir)
	sentinelExists := fileExists(sentinel)
	d := autostart.ShouldRegister(sentinelExists, setting)
	a.logger.Event("autostart.decision", map[string]any{
		"register":       d.Register,
		"writeSentinel":  d.WriteSentinel,
		"userSetting":    setting,
		"sentinelExists": sentinelExists,
	})

	if d.Register {
		if err := setRunKey(autostart.RunKeyValue(a.trayExe)); err != nil {
			a.logger.Event("autostart.register_failed", map[string]any{"error": err.Error()})
		} else {
			a.logger.Event("autostart.registered", map[string]any{
				"runKey": brand.RunKeyName, "value": a.trayExe,
			})
		}
	} else {
		// 注销是双侧语义（设计 §5/W-16）：确保键不存在——「用户关过自启，键残留升级复活」防线
		if err := deleteRunKey(); err != nil {
			a.logger.Event("autostart.unregister_failed", map[string]any{"error": err.Error()})
		} else {
			a.logger.Event("autostart.unregistered", nil)
		}
	}

	if d.WriteSentinel {
		if err := os.MkdirAll(filepath.Dir(sentinel), 0o755); err != nil {
			a.logger.Event("autostart.sentinel_write_failed", map[string]any{"error": err.Error()})
		} else if err := os.WriteFile(sentinel, []byte("defaulted\n"), 0o644); err != nil {
			a.logger.Event("autostart.sentinel_write_failed", map[string]any{"error": err.Error()})
		} else {
			a.logger.Event("autostart.sentinel_written", map[string]any{"path": sentinel})
		}
	}
}

// setRunKey HKCU\Software\Microsoft\Windows\CurrentVersion\Run 写值（非提权可写；值名 brand.RunKeyName）
func setRunKey(value string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, autostart.RunKeyPath(), registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetStringValue(brand.RunKeyName, value)
}

// deleteRunKey 删 Run 值（键不存在 = 幂等成功）
func deleteRunKey() error {
	k, err := registry.OpenKey(registry.CURRENT_USER, autostart.RunKeyPath(), registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if err := k.DeleteValue(brand.RunKeyName); err != nil {
		if errors.Is(err, syscall.ERROR_FILE_NOT_FOUND) {
			return nil
		}
		return err
	}
	return nil
}

// ---------- 小工具 ----------

// readTraySetting 读 <profile>/settings.json 的 system.tray.enabled；
// 缺文件/坏 JSON/字段缺失 → true（见 applyAutostart 注释）
func readTraySetting(profileDir string) bool {
	data, err := os.ReadFile(filepath.Join(profileDir, "settings.json"))
	if err != nil {
		return true
	}
	var s struct {
		System struct {
			Tray struct {
				Enabled *bool `json:"enabled"`
			} `json:"tray"`
		} `json:"system"`
	}
	if err := json.Unmarshal(data, &s); err != nil || s.System.Tray.Enabled == nil {
		return true
	}
	return *s.System.Tray.Enabled
}

// serviceVersion 读 run/service.json 的 version（关于项双版本线，W-12）；不可得返回空串
func serviceVersion(profileDir string) string {
	data, err := os.ReadFile(filepath.Join(profileDir, "run", "service.json"))
	if err != nil {
		return ""
	}
	h, err := contract.ParseServiceHandle(data)
	if err != nil {
		return ""
	}
	return h.Version
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// exitCode exec 错误 → 退出码（nil=0；非 ExitError=启动失败 -1）
func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	return -1
}

// truncateOut CLI 输出截断（进日志用）
func truncateOut(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > cliOutMaxLimit {
		return s[:cliOutMaxLimit] + "…"
	}
	return s
}

// 编译期接口断言：client 与生产注入类型对齐（probe.DefaultClient 返回 *http.Client）
var _ probe.Client = (*http.Client)(nil)
