package actions

import (
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
)

// TestBuildCliArgs 多段 CLI 契约：返回「按序执行的多条 CLI 调用」，每段一次 exec.Command。
// Restart 三段（stop → start → 等 healthz 收尾）扁平展开会被 commander 当位置参数吞掉——只停不起。
func TestBuildCliArgs(t *testing.T) {
	cases := []struct {
		name   string
		action Action
		want   [][]string
	}{
		{"Stop", Stop(), [][]string{{"stop"}}},
		{"Start", Start(), [][]string{{"start"}}},
		{"Restart_三段_以就绪收尾", Restart(), [][]string{{"stop"}, {"start"}, {"__health-wait", "15000"}}},
		{"HealthWait_15000", HealthWait(15000), [][]string{{"__health-wait", "15000"}}},
		{"HealthWait_2000", HealthWait(2000), [][]string{{"__health-wait", "2000"}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := BuildCliArgs(c.action); !reflect.DeepEqual(got, c.want) {
				t.Fatalf("BuildCliArgs(%+v) = %q, want %q", c.action, got, c.want)
			}
		})
	}
}

// TestBuildCliArgsSegmentsNotEmpty 每段非空且首元素为子命令名（执行层直接 exec 的前提）
func TestBuildCliArgsSegmentsNotEmpty(t *testing.T) {
	for _, a := range []Action{Start(), Stop(), Restart(), HealthWait(15000)} {
		segs := BuildCliArgs(a)
		if len(segs) == 0 {
			t.Fatalf("BuildCliArgs(%+v) 返回空段列表", a)
		}
		for i, seg := range segs {
			if len(seg) == 0 {
				t.Fatalf("BuildCliArgs(%+v) 第 %d 段为空", a, i)
			}
		}
	}
}

// TestHealthWaitGuard timeoutMs<=0 是程序员错误：前置 panic，不产出零/负预算的等待调用串
func TestHealthWaitGuard(t *testing.T) {
	for _, ms := range []int{0, -1, -15000} {
		t.Run(strconv.Itoa(ms), func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("HealthWait(%d) 应 panic（前置守卫：timeoutMs 必须 > 0）", ms)
				}
			}()
			HealthWait(ms)
		})
	}
	// 正值不 panic（产出契约由 TestBuildCliArgs 覆盖）
	_ = HealthWait(1)
}

func TestOpenBrowserURL(t *testing.T) {
	if got, want := OpenBrowserURL(19980), "http://127.0.0.1:19980"; got != want {
		t.Fatalf("OpenBrowserURL(19980) = %q, want %q", got, want)
	}
	if got, want := OpenBrowserURL(7777), "http://127.0.0.1:7777"; got != want {
		t.Fatalf("OpenBrowserURL(7777) = %q, want %q", got, want)
	}
}

// TestChildEnv 028：托盘 spawn 的 devzero 子进程继承当前环境且追加 WORKBENCH_NO_BROWSER=1
// （浏览器只由托盘就绪后显式开一次，服务侧 start 的 idempotent/首启开窗被抑制）。
func TestChildEnv(t *testing.T) {
	t.Setenv("WORKBENCH_CHILDENV_MARKER", "inherit-me")
	env := ChildEnv()
	var sawSuppress, sawInherit bool
	for _, kv := range env {
		if kv == "WORKBENCH_NO_BROWSER=1" {
			sawSuppress = true
		}
		if kv == "WORKBENCH_CHILDENV_MARKER=inherit-me" {
			sawInherit = true
		}
	}
	if !sawSuppress {
		t.Fatalf("ChildEnv 缺少 WORKBENCH_NO_BROWSER=1：%v", env)
	}
	if !sawInherit {
		t.Fatalf("ChildEnv 未继承父进程环境（缺 WORKBENCH_CHILDENV_MARKER）：%v", env)
	}
}

// TestOpenGate 028：并发开窗链路合并——首个 TryEnter 放行，链路期间其余请求拒绝，
// Leave 后下一次开窗链路可正常进入。
func TestOpenGate(t *testing.T) {
	var gate OpenGate
	if !gate.TryEnter() {
		t.Fatal("首次 TryEnter 应放行")
	}
	if gate.TryEnter() {
		t.Fatal("链路进行中第二次 TryEnter 应被拒绝（并发合并）")
	}
	gate.Leave()
	if !gate.TryEnter() {
		t.Fatal("Leave 后 TryEnter 应再次放行")
	}
}

func TestPaths(t *testing.T) {
	profile := t.TempDir()
	if got := DataDirPath(profile); got != profile {
		t.Fatalf("DataDirPath(%q) = %q, want 原样", profile, got)
	}
	if got, want := LogsDirPath(profile), filepath.Join(profile, "logs"); got != want {
		t.Fatalf("LogsDirPath(%q) = %q, want %q", profile, got, want)
	}
}

// TestActivityConstructor Activity 动作构造与 CLI 段（TR-07 活动检查的执行层入口）：
// 段形状与 stop/start 同为单段，消费侧不手写
func TestActivityConstructor(t *testing.T) {
	got := BuildCliArgs(Activity())
	want := [][]string{{"activity"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("BuildCliArgs(Activity()) = %q, want %q", got, want)
	}
}

// TestHealthWaitBudgetMsSingleSource 就绪等待预算单源：Restart 末段与左键直达共用
// actions.HealthWaitBudgetMs（main.go 不得再写 15000 字面量——审查 I-2 双常量消除）
func TestHealthWaitBudgetMsSingleSource(t *testing.T) {
	if HealthWaitBudgetMs != 15000 {
		t.Errorf("HealthWaitBudgetMs = %d, want 15000（设计 §4.2：15s）", HealthWaitBudgetMs)
	}
	segs := BuildCliArgs(Restart())
	last := segs[len(segs)-1]
	want := []string{"__health-wait", strconv.Itoa(HealthWaitBudgetMs)}
	if !reflect.DeepEqual(last, want) {
		t.Errorf("Restart 末段 = %q, want %q（应引用 HealthWaitBudgetMs 常量）", last, want)
	}
}
