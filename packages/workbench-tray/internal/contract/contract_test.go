package contract

import (
	"encoding/json"
	"testing"
)

// TestParseServiceHandleRoundTrip 全字段往返：Go struct → JSON → Parse → 相等（锁 json tag 与 TS 字段名一致）
func TestParseServiceHandleRoundTrip(t *testing.T) {
	in := ServiceHandle{
		SchemaVersion: 1,
		App:           "workbench",
		Pid:           4242,
		Port:          19980,
		Host:          "127.0.0.1",
		Version:       "0.1.0",
		BuildCommitId: "c31c761",
		Uid:           "11111111-2222-3333-4444-555555555555",
		InstanceId:    "66666666-7777-8888-9999-000000000000",
		StartedAt:     "2026-08-24T10:00:00.000Z",
	}
	data, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, err := ParseServiceHandle(data)
	if err != nil {
		t.Fatalf("ParseServiceHandle(%s) error: %v", data, err)
	}
	if got != in {
		t.Fatalf("round trip = %+v, want %+v", got, in)
	}
}

// TestParseServiceHandleFromTsJson TS 侧实际产出的 JSON（contracts.ts writeServiceHandle）逐字段对齐
func TestParseServiceHandleFromTsJson(t *testing.T) {
	raw := `{"schemaVersion":1,"app":"workbench","pid":123,"port":7777,"host":"127.0.0.1","version":"0.1.0","buildCommitId":"dev","uid":"uid-1","instanceId":"inst-1","startedAt":"2026-08-24T00:00:00.000Z"}`
	got, err := ParseServiceHandle([]byte(raw))
	if err != nil {
		t.Fatalf("ParseServiceHandle error: %v", err)
	}
	want := ServiceHandle{
		SchemaVersion: 1,
		App:           "workbench",
		Pid:           123,
		Port:          7777,
		Host:          "127.0.0.1",
		Version:       "0.1.0",
		BuildCommitId: "dev",
		Uid:           "uid-1",
		InstanceId:    "inst-1",
		StartedAt:     "2026-08-24T00:00:00.000Z",
	}
	if got != want {
		t.Fatalf("ParseServiceHandle = %+v, want %+v", got, want)
	}
}

// TestParseServiceHandleErrors 坏输入返回 error 不 panic（含 schemaVersion 门禁）
func TestParseServiceHandleErrors(t *testing.T) {
	cases := []struct {
		name string
		data string
	}{
		{"坏JSON", `{not json`},
		{"空输入", ``},
		{"schemaVersion=2", `{"schemaVersion":2,"app":"workbench","pid":1,"port":1,"host":"127.0.0.1"}`},
		{"缺schemaVersion", `{"app":"workbench","pid":1,"port":1}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := ParseServiceHandle([]byte(c.data)); err == nil {
				t.Fatalf("ParseServiceHandle(%q) 无 error，期望拒绝", c.data)
			}
		})
	}
}

// TestParseConfigPort config.json 的 network.port 解析
func TestParseConfigPort(t *testing.T) {
	t.Run("有效port", func(t *testing.T) {
		got, err := ParseConfigPort([]byte(`{"network":{"port":5555}}`))
		if err != nil {
			t.Fatalf("ParseConfigPort error: %v", err)
		}
		if got != 5555 {
			t.Fatalf("ParseConfigPort = %d, want 5555", got)
		}
	})
	t.Run("未配置port_零值无错", func(t *testing.T) {
		got, err := ParseConfigPort([]byte(`{"network":{}}`))
		if err != nil {
			t.Fatalf("ParseConfigPort error: %v", err)
		}
		if got != 0 {
			t.Fatalf("ParseConfigPort = %d, want 0（未配置由发现链兜底）", got)
		}
	})
	t.Run("坏JSON", func(t *testing.T) {
		if _, err := ParseConfigPort([]byte(`nope`)); err == nil {
			t.Fatalf("ParseConfigPort 坏 JSON 无 error")
		}
	})
}
