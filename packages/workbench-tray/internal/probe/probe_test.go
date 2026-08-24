package probe

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"workbench-tray/internal/brand"
)

func serverPort(t *testing.T, srv *httptest.Server) int {
	t.Helper()
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse server url: %v", err)
	}
	p, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parse port %q: %v", u.Port(), err)
	}
	return p
}

func TestHealthzURL(t *testing.T) {
	if got, want := HealthzURL(19980), "http://127.0.0.1:19980/healthz"; got != want {
		t.Fatalf("HealthzURL(19980) = %q, want %q", got, want)
	}
	if got, want := HealthzURL(7777), "http://127.0.0.1:7777/healthz"; got != want {
		t.Fatalf("HealthzURL(7777) = %q, want %q", got, want)
	}
}

// TestProbe 三种服务器形态 + 超时路径（httptest，零真实外部网络）
func TestProbe(t *testing.T) {
	t.Run("自家服务200_就绪", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/healthz" {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"app":"workbench","status":"ok","version":"0.1.0","pid":123,"uid":"u","uptime":1}`)
		}))
		defer srv.Close()
		got := Probe(&http.Client{Timeout: ProbeTimeout}, serverPort(t, srv))
		if got != (ProbeResult{Ok: true, Own: true}) {
			t.Fatalf("Probe = %+v, want {Ok:true Own:true}", got)
		}
	})

	t.Run("端口在但非自家_冲突态", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"app":"other"}`))
		}))
		defer srv.Close()
		got := Probe(&http.Client{Timeout: ProbeTimeout}, serverPort(t, srv))
		if got != (ProbeResult{Ok: false, Own: true}) {
			t.Fatalf("Probe = %+v, want {Ok:false Own:true}", got)
		}
	})

	t.Run("连接拒绝_无人监听", func(t *testing.T) {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("listen: %v", err)
		}
		port := l.Addr().(*net.TCPAddr).Port
		if err := l.Close(); err != nil {
			t.Fatalf("close listener: %v", err)
		}
		got := Probe(&http.Client{Timeout: ProbeTimeout}, port)
		if got != (ProbeResult{Ok: false, Own: false}) {
			t.Fatalf("Probe = %+v, want {Ok:false Own:false}", got)
		}
	})

	t.Run("挂起服务_客户端超时注入生效", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(500 * time.Millisecond)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"app":"workbench"}`))
		}))
		defer srv.Close()
		start := time.Now()
		got := Probe(&http.Client{Timeout: 50 * time.Millisecond}, serverPort(t, srv))
		elapsed := time.Since(start)
		if got != (ProbeResult{Ok: false, Own: false}) {
			t.Fatalf("Probe = %+v, want {Ok:false Own:false}", got)
		}
		if elapsed > 400*time.Millisecond {
			t.Fatalf("超时路径耗时 %v，want < 400ms（50ms 客户端超时应生效）", elapsed)
		}
	})
}

func writeT(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

const validServiceJSON = `{"schemaVersion":1,"app":"workbench","pid":123,"port":7777,"host":"127.0.0.1","version":"0.1.0","buildCommitId":"dev","uid":"u","instanceId":"i","startedAt":"2026-08-24T00:00:00.000Z"}`

// TestDiscoverPort 三级 fallback（tmpdir 造文件驱动；service.json 在 <profile>/run/、config.json 在 <profile>/ 根，对齐 TS 侧 load.ts）
func TestDiscoverPort(t *testing.T) {
	t.Run("一级_run/service.json", func(t *testing.T) {
		dir := t.TempDir()
		writeT(t, filepath.Join(dir, "run", "service.json"), validServiceJSON)
		writeT(t, filepath.Join(dir, "config.json"), `{"network":{"port":5555}}`)
		if got := DiscoverPort(dir); got != 7777 {
			t.Fatalf("DiscoverPort = %d, want 7777", got)
		}
	})
	t.Run("二级_config.json", func(t *testing.T) {
		dir := t.TempDir()
		writeT(t, filepath.Join(dir, "config.json"), `{"network":{"port":5555}}`)
		if got := DiscoverPort(dir); got != 5555 {
			t.Fatalf("DiscoverPort = %d, want 5555", got)
		}
	})
	t.Run("三级_默认端口", func(t *testing.T) {
		dir := t.TempDir()
		if got := DiscoverPort(dir); got != brand.DefaultPort {
			t.Fatalf("DiscoverPort = %d, want %d", got, brand.DefaultPort)
		}
	})
	t.Run("service.json损坏JSON_落二级", func(t *testing.T) {
		dir := t.TempDir()
		writeT(t, filepath.Join(dir, "run", "service.json"), `{broken`)
		writeT(t, filepath.Join(dir, "config.json"), `{"network":{"port":5555}}`)
		if got := DiscoverPort(dir); got != 5555 {
			t.Fatalf("DiscoverPort = %d, want 5555（损坏按不存在，fresh 自愈）", got)
		}
	})
	t.Run("service.json损坏且无config_落默认", func(t *testing.T) {
		dir := t.TempDir()
		writeT(t, filepath.Join(dir, "run", "service.json"), `{broken`)
		if got := DiscoverPort(dir); got != brand.DefaultPort {
			t.Fatalf("DiscoverPort = %d, want %d", got, brand.DefaultPort)
		}
	})
	t.Run("service.json版本不符_落二级", func(t *testing.T) {
		dir := t.TempDir()
		writeT(t, filepath.Join(dir, "run", "service.json"), `{"schemaVersion":2,"app":"workbench","pid":1,"port":7777}`)
		writeT(t, filepath.Join(dir, "config.json"), `{"network":{"port":5555}}`)
		if got := DiscoverPort(dir); got != 5555 {
			t.Fatalf("DiscoverPort = %d, want 5555（不认识的 schemaVersion 按损坏）", got)
		}
	})
	t.Run("service.json端口为零_视为无效落二级", func(t *testing.T) {
		dir := t.TempDir()
		writeT(t, filepath.Join(dir, "run", "service.json"), `{"schemaVersion":1,"app":"workbench","pid":1,"port":0}`)
		writeT(t, filepath.Join(dir, "config.json"), `{"network":{"port":5555}}`)
		if got := DiscoverPort(dir); got != 5555 {
			t.Fatalf("DiscoverPort = %d, want 5555（port=0 视为无效）", got)
		}
	})
}

// TestProfileDir profile 目录解析：env WORKBENCH_HOME 覆盖默认 ~/.workbench（对齐 TS 侧 main.ts）
func TestProfileDir(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir: %v", err)
	}
	t.Run("默认_用户目录下profile", func(t *testing.T) {
		t.Setenv("WORKBENCH_HOME", "")
		want := filepath.Join(home, ".workbench")
		if got := ProfileDir(); got != want {
			t.Fatalf("ProfileDir = %q, want %q", got, want)
		}
	})
	t.Run("WORKBENCH_HOME覆盖", func(t *testing.T) {
		custom := filepath.Join(t.TempDir(), "wb-home")
		t.Setenv("WORKBENCH_HOME", custom)
		if got := ProfileDir(); got != custom {
			t.Fatalf("ProfileDir = %q, want %q", got, custom)
		}
	})
}
