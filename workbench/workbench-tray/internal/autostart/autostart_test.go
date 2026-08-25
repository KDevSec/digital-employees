package autostart

import (
	"path/filepath"
	"testing"
)

// TestShouldRegister 哨兵 + 用户设置四象限判定（W-16：用户关过自启，升级不重开）
func TestShouldRegister(t *testing.T) {
	cases := []struct {
		name               string
		sentinelExists     bool
		userSettingEnabled bool
		want               Decision
	}{
		{"首次默认注册_注册并写哨兵", false, true, Decision{Register: true, WriteSentinel: true}},
		{"用户关过自启_注销语义（Register=false=确保键不存在）升级不重开", true, false, Decision{}},
		{"哨兵在设置开_幂等注册不重写哨兵", true, true, Decision{Register: true}},
		{"未表态且设置关_注销语义_不注册不写哨兵", false, false, Decision{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ShouldRegister(c.sentinelExists, c.userSettingEnabled); got != c.want {
				t.Fatalf("ShouldRegister(%v, %v) = %+v, want %+v", c.sentinelExists, c.userSettingEnabled, got, c.want)
			}
		})
	}
}

func TestSentinelPath(t *testing.T) {
	dir := t.TempDir()
	want := filepath.Join(dir, "run", "sentinels", "tray-autostart-defaulted")
	if got := SentinelPath(dir); got != want {
		t.Fatalf("SentinelPath(%q) = %q, want %q", dir, got, want)
	}
}

func TestRunKeyValue(t *testing.T) {
	exe := filepath.Join(t.TempDir(), "workbench-tray.exe")
	if got := RunKeyValue(exe); got != exe {
		t.Fatalf("RunKeyValue(%q) = %q, want 原样（暂无参数拼接）", exe, got)
	}
}

func TestRunKeyPath(t *testing.T) {
	want := `Software\Microsoft\Windows\CurrentVersion\Run`
	if got := RunKeyPath(); got != want {
		t.Fatalf("RunKeyPath() = %q, want %q", got, want)
	}
}
