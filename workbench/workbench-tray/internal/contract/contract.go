// Package contract 跨语言 JSON 契约的 Go 侧解析（镜像 TS 侧 ServiceHandle 与
// /api/activity 形状，设计 §6）。
// 与 TS 侧的共享物 = run/*.json 与 activity JSON 的 schema：字段名严格对齐，手写同步
// （contract_test.go 的跨语言绊网强制检查）。
package contract

import (
	"encoding/json"
	"fmt"
)

// ServiceHandle run/service.json 发现契约（与 TS 侧字段名严格对齐）。
// 外部（托盘壳/脚本/任何工具）对 Service 的认知 = 这些文件 + /healthz。
type ServiceHandle struct {
	SchemaVersion int    `json:"schemaVersion"`
	App           string `json:"app"`
	Pid           int    `json:"pid"`
	Port          int    `json:"port"`
	Host          string `json:"host"`
	Version       string `json:"version"`
	BuildCommitId string `json:"buildCommitId"`
	Uid           string `json:"uid"`
	InstanceId    string `json:"instanceId"`
	StartedAt     string `json:"startedAt"`
}

// schemaVersionSupported 当前认识的 run/ 契约版本（与 TS 侧一致：1）
const schemaVersionSupported = 1

// ParseServiceHandle 解析 service.json；坏 JSON 或 schemaVersion != 1 → error（不 panic）。
// 调用方（端口发现链）按 advisory 语义把 error 当「文件不存在」处理，fresh 自愈。
func ParseServiceHandle(data []byte) (ServiceHandle, error) {
	var h ServiceHandle
	if err := json.Unmarshal(data, &h); err != nil {
		return ServiceHandle{}, fmt.Errorf("service.json 解析失败: %w", err)
	}
	if h.SchemaVersion != schemaVersionSupported {
		return ServiceHandle{}, fmt.Errorf("service.json schemaVersion=%d 不支持（want %d）", h.SchemaVersion, schemaVersionSupported)
	}
	return h, nil
}

// ParseConfigPort 解析 config.json 的 network.port；坏 JSON → error。
// port 未配置时返回零值（0），由调用方决定 fallback。
func ParseConfigPort(data []byte) (int, error) {
	var c struct {
		Network struct {
			Port int `json:"port"`
		} `json:"network"`
	}
	if err := json.Unmarshal(data, &c); err != nil {
		return 0, fmt.Errorf("config.json 解析失败: %w", err)
	}
	return c.Network.Port, nil
}

// ActivityInfo 活动任务契约（TR-07 优雅停服判据）：workbench activity 子命令的 stdout，
// 与 TS 侧 /api/activity handler（activityCommand 转发其响应）字段名严格对齐。
type ActivityInfo struct {
	ConversationTasks int `json:"conversationTasks"`
	TriggerTasks      int `json:"triggerTasks"`
}

// Total 在飞任务总数（停止前确认判据的唯一聚合口径）
func (a ActivityInfo) Total() int {
	return a.ConversationTasks + a.TriggerTasks
}

// ParseActivity 解析 activity JSON；坏 JSON/非对象 → error（不 panic）。
// 调用方（托盘停止前检查）按「解析失败仍停」处理——V0.1 服务不在跑时兜底输出零值，
// 解析失败极罕见（审查 M-8 记账：方向语义 V0.1 风险≈0）。
func ParseActivity(data []byte) (ActivityInfo, error) {
	var a ActivityInfo
	if err := json.Unmarshal(data, &a); err != nil {
		return ActivityInfo{}, fmt.Errorf("activity JSON 解析失败: %w", err)
	}
	return a, nil
}
