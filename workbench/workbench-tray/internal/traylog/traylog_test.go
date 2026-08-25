package traylog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"workbench-tray/internal/brand"
)

// TestOpenCreatesDirsAndFile 打开即建目录（mkdir -p 语义）与日志文件本体。
func TestOpenCreatesDirsAndFile(t *testing.T) {
	profile := t.TempDir()
	// logs/ 与 sentinels/ 同级不存在时由 Open 递归创建
	l, err := Open(filepath.Join(profile, "nested"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer l.Close()

	want := filepath.Join(profile, "nested", "logs", brand.TrayLogName)
	if l.Path() != want {
		t.Errorf("Path() = %q, want %q", l.Path(), want)
	}
	if _, err := os.Stat(want); err != nil {
		t.Errorf("日志文件未创建: %v", err)
	}
}

// TestEventJSONLFormat 事件落盘形状：JSONL、UTF-8 无 BOM、{ts,event,payload} 三段、行尾 \n。
func TestEventJSONLFormat(t *testing.T) {
	l, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer l.Close()

	if err := l.Event("probe", map[string]any{"state": "Green", "port": 19980}); err != nil {
		t.Fatalf("Event: %v", err)
	}
	data, err := os.ReadFile(l.Path())
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}

	// 无 BOM（UTF-8 直写）
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		t.Errorf("日志文件带 BOM：前 3 字节 % X", data[:3])
	}
	// 单行 + 换行结尾
	if !strings.HasSuffix(string(data), "\n") {
		t.Errorf("行尾缺 \\n：%q", data)
	}

	var rec Record
	if err := json.Unmarshal(data, &rec); err != nil {
		t.Fatalf("非合法 JSON：%v（%s）", err, data)
	}
	if rec.Event != "probe" {
		t.Errorf("event = %q, want probe", rec.Event)
	}
	if rec.Ts == "" {
		t.Error("ts 为空")
	}
	if _, err := time.Parse(time.RFC3339, rec.Ts); err != nil {
		t.Errorf("ts 非 RFC3339：%q（%v）", rec.Ts, err)
	}
	if rec.Payload["state"] != "Green" {
		t.Errorf("payload.state = %v, want Green", rec.Payload["state"])
	}
	if rec.Payload["port"] != float64(19980) {
		t.Errorf("payload.port = %v, want 19980", rec.Payload["port"])
	}
}

// TestEventNilPayloadOmitted 无载荷事件不写 payload 键（与 M0 无参事件同构）。
func TestEventNilPayloadOmitted(t *testing.T) {
	l, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer l.Close()

	if err := l.Event("tray.quit", nil); err != nil {
		t.Fatalf("Event: %v", err)
	}
	data, _ := os.ReadFile(l.Path())
	if strings.Contains(string(data), "payload") {
		t.Errorf("nil payload 不应落 payload 键：%s", data)
	}
}

// TestOpenAppendMode 追加不截断（壳升级重启后旧日志保留）。
func TestOpenAppendMode(t *testing.T) {
	dir := t.TempDir()
	l1, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	l1.Event("first", nil)
	l1.Close()

	l2, err := Open(dir)
	if err != nil {
		t.Fatalf("二次 Open: %v", err)
	}
	defer l2.Close()
	l2.Event("second", nil)

	data, _ := os.ReadFile(l2.Path())
	if got := strings.Count(string(data), "\n"); got != 2 {
		t.Errorf("追加后行数 = %d, want 2（内容：%q）", got, data)
	}
}

// TestEventConcurrentWrites 并发写不交错：探活循环/菜单回调/信号处理三源并发是组装层事实。
func TestEventConcurrentWrites(t *testing.T) {
	l, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer l.Close()

	const goroutines, perG = 20, 50
	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < perG; i++ {
				l.Event("concurrent", map[string]any{"g": g, "i": i})
			}
		}(g)
	}
	wg.Wait()

	data, err := os.ReadFile(l.Path())
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	if len(lines) != goroutines*perG {
		t.Fatalf("行数 = %d, want %d（存在交错丢失）", len(lines), goroutines*perG)
	}
	for i, line := range lines {
		var rec Record
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("第 %d 行非合法 JSON（交错写坏）：%q", i+1, line)
		}
	}
}

// TestNilFileDiscard 打开失败降级：nil 句柄静默丢弃事件——壳日志缺失不能杀壳（GUI 必须照常出现）。
func TestNilFileDiscard(t *testing.T) {
	l := &Logger{}
	if err := l.Event("anything", map[string]any{"k": 1}); err != nil {
		t.Errorf("nil 句柄 Event 应静默成功，got %v", err)
	}
	if err := l.Close(); err != nil {
		t.Errorf("nil 句柄 Close 应静默成功，got %v", err)
	}
}

// TestNewRecord 纯函数：时间注入构造（ts 由调用方时钟决定，可测）。
func TestNewRecord(t *testing.T) {
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	rec := NewRecord(now, "probe", map[string]any{"ok": true})
	if rec.Ts != "2026-08-25T12:00:00Z" {
		t.Errorf("Ts = %q, want 2026-08-25T12:00:00Z", rec.Ts)
	}
	if rec.Event != "probe" {
		t.Errorf("Event = %q, want probe", rec.Event)
	}
	if rec.Payload["ok"] != true {
		t.Errorf("Payload.ok = %v, want true", rec.Payload["ok"])
	}
}
