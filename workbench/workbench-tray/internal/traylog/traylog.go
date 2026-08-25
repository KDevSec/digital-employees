// Package traylog 壳日志（<profile>/logs/tray.log）——append-only JSONL，UTF-8 无 BOM。
// 与服务日志不交叉（设计 §1：壳独立制品独立日志）；行形状与 M0 spike 同构 {ts,event,payload}。
// 设计 §2 提的大小轮转（1MB×3，T-Q4 壳自管）V0.1 未落：轮转语义留开放问题 T-Q4 裁决后补。
package traylog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"workbench-tray/internal/brand"
)

// Record 单条日志事件
type Record struct {
	Ts      string         `json:"ts"`
	Event   string         `json:"event"`
	Payload map[string]any `json:"payload,omitempty"`
}

// NewRecord 纯函数构造：时间由调用方注入（组装层传 time.Now()，测试传固定钟）。
func NewRecord(now time.Time, event string, payload map[string]any) Record {
	return Record{Ts: now.Format(time.RFC3339), Event: event, Payload: payload}
}

// Line 记录序列化为单行 JSONL（含结尾 \n）。map[string]any 载荷可序列化，错误仅理论存在。
func Line(r Record) ([]byte, error) {
	b, err := json.Marshal(r)
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

// Logger tray.log 追加写句柄。探活循环/菜单回调/信号处理多 goroutine 并发写，
// mu 保证行原子性（JSON 行交错 = 双方都烂，无容忍空间）。
type Logger struct {
	mu   sync.Mutex
	f    *os.File
	path string
}

// Open 打开 <profileDir>/logs/tray.log：目录递归创建（mkdir -p 语义）、追加模式。
// 打开失败时调用方应降级用 &Logger{}（nil 句柄静默丢弃）——壳日志缺失不能杀壳。
func Open(profileDir string) (*Logger, error) {
	dir := filepath.Join(profileDir, "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, brand.TrayLogName)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}
	return &Logger{f: f, path: path}, nil
}

// Event 追加一条事件（写失败返回错误但不中断壳——调用方组装层只记 stderr 不退出）。
// nil 句柄（Open 失败降级）静默成功。
func (l *Logger) Event(event string, payload map[string]any) error {
	if l == nil || l.f == nil {
		return nil
	}
	line, err := Line(NewRecord(time.Now(), event, payload))
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	_, err = l.f.Write(line)
	return err
}

// Path 日志文件路径（冒烟脚本轮询消费）
func (l *Logger) Path() string {
	if l == nil {
		return ""
	}
	return l.path
}

// Close 关闭句柄（onExit 回调路径）；nil 句柄静默成功。
func (l *Logger) Close() error {
	if l == nil || l.f == nil {
		return nil
	}
	return l.f.Close()
}
