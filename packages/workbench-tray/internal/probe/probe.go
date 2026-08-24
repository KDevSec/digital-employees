// Package probe health 探测与端口发现链（设计 §3，TR-04/TR-05）。
// 纯逻辑 + 注入 http client（测试用 httptest / 超时注入），零真实外部网络。
package probe

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"workbench-tray/internal/brand"
	"workbench-tray/internal/contract"
)

// loopbackHost 网络边界：壳只连 127.0.0.1（设计 §7），无任何外部连接
const loopbackHost = "127.0.0.1"

// ProbeTimeout 探活请求超时（设计 §3：2s）
const ProbeTimeout = 2 * time.Second

// healthz 最大读取字节数（防御异常服务返回巨包）
const maxBodyBytes = 4096

// Client 与 *http.Client 兼容的最小接口（测试注入）
type Client interface {
	Do(req *http.Request) (*http.Response, error)
}

// ProbeResult 一次 /healthz 探测结果。
// Own 的语义：端口上有 HTTP 应答者——哪怕不是自家（端口冲突态，Wave 5 用于区分提示）。
type ProbeResult struct {
	Ok  bool
	Own bool
}

// HealthzURL 纯函数：端口 → healthz 地址
func HealthzURL(port int) string {
	return "http://" + loopbackHost + ":" + strconv.Itoa(port) + "/healthz"
}

// DefaultClient 生产用 client（ProbeTimeout 超时）
func DefaultClient() *http.Client {
	return &http.Client{Timeout: ProbeTimeout}
}

// Probe 用注入的 client 探测一次 /healthz。
// 传输层错误（拒绝/超时/非 HTTP 应答者）→ Own=false；有 HTTP 应答 → Own=true，
// Ok = 200 且 app 字段匹配自家。
func Probe(client Client, port int) ProbeResult {
	req, err := http.NewRequest(http.MethodGet, HealthzURL(port), nil)
	if err != nil {
		return ProbeResult{}
	}
	resp, err := client.Do(req)
	if err != nil {
		return ProbeResult{Ok: false, Own: false}
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return ProbeResult{Ok: false, Own: true}
	}
	var payload struct {
		App string `json:"app"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ProbeResult{Ok: false, Own: true}
	}
	return ProbeResult{
		Ok:  resp.StatusCode == http.StatusOK && payload.App == brand.AppName,
		Own: true,
	}
}

// DiscoverPort 端口发现链（设计 §3，三级 fallback）：
//  1. <profileDir>/run/service.json 的 port（运行时事实，最权威）
//  2. <profileDir>/config.json 的 network.port（用户配置，与 TS 侧 load.ts 路径对齐）
//  3. brand.DefaultPort（19980）
//
// service.json 损坏/版本不符/端口无效时按不存在处理，落到下一级（advisory 契约，fresh 自愈）。
func DiscoverPort(profileDir string) int {
	if data, err := os.ReadFile(filepath.Join(profileDir, "run", "service.json")); err == nil {
		if h, err := contract.ParseServiceHandle(data); err == nil && h.Port > 0 {
			return h.Port
		}
	}
	if data, err := os.ReadFile(filepath.Join(profileDir, "config.json")); err == nil {
		if p, err := contract.ParseConfigPort(data); err == nil && p > 0 {
			return p
		}
	}
	return brand.DefaultPort
}

// ProfileDir 壳侧 profile 目录解析：env WORKBENCH_HOME > ~/.workbench（与 TS 侧 main.ts 同语义）。
func ProfileDir() string {
	if v := os.Getenv("WORKBENCH_HOME"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		// UserHomeDir 失败极罕见（无 USERPROFILE）；退化为相对路径由调用方日志暴露
		return brand.ProfileName
	}
	return filepath.Join(home, brand.ProfileName)
}
