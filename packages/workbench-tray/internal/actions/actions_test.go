package actions

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestBuildCliArgs(t *testing.T) {
	cases := []struct {
		name   string
		action Action
		want   []string
	}{
		{"Stop", Stop(), []string{"stop"}},
		{"Start", Start(), []string{"start"}},
		{"Restart", Restart(), []string{"stop", "start"}},
		{"HealthWait_15000", HealthWait(15000), []string{"__health-wait", "15000"}},
		{"HealthWait_2000", HealthWait(2000), []string{"__health-wait", "2000"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := BuildCliArgs(c.action); !reflect.DeepEqual(got, c.want) {
				t.Fatalf("BuildCliArgs(%+v) = %q, want %q", c.action, got, c.want)
			}
		})
	}
}

func TestOpenBrowserURL(t *testing.T) {
	if got, want := OpenBrowserURL(19980), "http://127.0.0.1:19980"; got != want {
		t.Fatalf("OpenBrowserURL(19980) = %q, want %q", got, want)
	}
	if got, want := OpenBrowserURL(7777), "http://127.0.0.1:7777"; got != want {
		t.Fatalf("OpenBrowserURL(7777) = %q, want %q", got, want)
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
