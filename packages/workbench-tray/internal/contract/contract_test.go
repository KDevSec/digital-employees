package contract

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"workbench-tray/internal/brand"
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

// ---------- 跨语言契约绊网（I-3，沿 Wave 3 先例：镜像变受检查镜像） ----------

// readRepoFile runtime.Caller 定位本测试源文件后上溯到仓库根再拼相对路径——
// 不依赖测试进程 cwd，`go test ./...` 任意目录发起均可跑。
func readRepoFile(t *testing.T, rel ...string) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller 失败：无法定位仓库根")
	}
	// thisFile = <repo>/packages/workbench-tray/internal/contract/contract_test.go → 上溯 5 级 = 仓库根
	repoRoot := thisFile
	for i := 0; i < 5; i++ {
		repoRoot = filepath.Dir(repoRoot)
	}
	path := filepath.Join(append([]string{repoRoot}, rel...)...)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读 %s 失败（跨语言契约绊网要求 TS 源在场）: %v", path, err)
	}
	return string(data)
}

// TestCrossLanguageContractSync 跨语言契约绊网：直接读 TS 侧源文本做存在性断言——
// TS 侧改品牌值 / ServiceHandle 字段名 → 本测试红，强制同步 Go 侧镜像（手写同步的检查闭环）。
func TestCrossLanguageContractSync(t *testing.T) {
	brandTs := readRepoFile(t, "packages", "workbench-service", "src", "brand.ts")
	contractsTs := readRepoFile(t, "packages", "workbench-service", "src", "runtime", "contracts.ts")

	// brand 四镜像值（AppName/DisplayName/DefaultPort/ProfileName）在 brand.ts 文本中出现
	for _, v := range []string{brand.AppName, brand.DisplayName, strconv.Itoa(brand.DefaultPort), brand.ProfileName} {
		if !strings.Contains(brandTs, v) {
			t.Errorf("brand.ts 不再包含镜像值 %q——TS/Go 品牌镜像漂移，需同步 internal/brand/brand.go", v)
		}
	}

	// ServiceHandle 全部 json tag 字段名在 contracts.ts 文本中出现（反射取实际 tag，不手抄清单）
	typ := reflect.TypeOf(ServiceHandle{})
	if n := typ.NumField(); n != 10 {
		t.Fatalf("ServiceHandle 字段数 = %d, want 10——增删字段必须同步 TS 侧 ServiceHandle 与本绊网", n)
	}
	for i := 0; i < typ.NumField(); i++ {
		name := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
		if name == "" {
			t.Fatalf("ServiceHandle 字段 %s 缺 json tag", typ.Field(i).Name)
		}
		if !strings.Contains(contractsTs, name) {
			t.Errorf("contracts.ts 不再包含字段名 %q——run/ 契约漂移，需同步 internal/contract/contract.go", name)
		}
	}
}
