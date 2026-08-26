// Package singleton 托盘壳单实例（2026-08-25 用户裁决·方案 B）——命名互斥体占坑 +
// 命名事件唤醒。修复双图标 bug：快捷方式/双击 exe/HKCU Run 三条启动入口并发或重复
// 拉起时，第二个壳无条件 systray.Run 各挂一个托盘图标，双壳并行探活、各自恢复、各自停服务。
//
// 语义（方案 B = 静默退出 + 唤醒重定向）：
//   - TryLock 首个实例 Owned=true，正常起壳；后来者 Owned=false → NotifyExisting 唤醒
//     首实例执行 openWorkbench（= 左键单击行为，「我要用工作台」的意图闭环）后直接退出
//   - Local\ 前缀：per-user per-session 命名空间（与 HKCU/计划任务的 per-user 形态对齐；
//     Global\ 跨会话共享对单用户工具无意义且会误伤远程桌面双会话各自起壳的合理场景）
//
// 事件选 auto-reset（CreateEvent manualReset=0）的两点理由：
//   - 信号保留：无 waiter 期间 SetEvent 的信号保留到下一次 Wait 消费——覆盖「第二实例
//     在首实例进入 Wait 循环之前 Notify」的连点竞态窗口，唤醒不丢
//   - 一次一醒：每次 Wait 消费即复位，不会把后续 Wait 全部误唤醒
//
// 信号保留的前提是**事件对象存活**——命名对象生命周期跟最后一个句柄走。故首实例经
// NewWatcher 常驻持有句柄，且**必须先于 TryLock 建立**：如此第二实例 Notify 时自己
// 的 Watcher 句柄必然开着（TryLock 判定 duplicate 的前提是 mutex 存在 = 首实例已过
// TryLock = 其 Watcher 早已建立），信号零丢失窗口。
//
// NotifyExisting/WaitWakeup 都走 CreateEvent（而非 OpenEvent）：事件不存在则创建、
// 存在则打开——第二实例永不会因「事件还没人建」而 Notify 失败。
//
// 实现注：单实例判定必须依赖 CreateMutexW 的 ERROR_ALREADY_EXISTS 原子语义
// （OpenMutex 先探再建有「双进程同时探测失败→双双自以为首实例」竞态，恰是本 bug 要防的
// 并发双起）；而 x/sys/windows.CreateMutex 封装在 handle!=0 时丢弃该 errno——
// 故此处经 LazyProc 直调，从返回 errno 判定。
package singleton

import (
	"errors"
	"fmt"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32         = windows.NewLazySystemDLL("kernel32.dll")
	procCreateMutexW = kernel32.NewProc("CreateMutexW")
)

// Lock 命名互斥体占用句柄。Owned=false 表示已有实例在跑（句柄仍需 Close——它是
// 对既有命名对象的引用，泄漏句柄会让互斥体在本进程退出后仍残留引用计数）。
type Lock struct {
	handle windows.Handle
	Owned  bool
}

// TryLock 尝试占用命名互斥体（LPSECURITY_ATTRIBUTES=nil 不继承、initialOwner=false
// 不取所有权——占用语义纯靠对象存在性，避免 abandoned mutex 干扰判定）。
func TryLock(name string) (Lock, error) {
	ptr, err := windows.UTF16PtrFromString(`Local\` + name)
	if err != nil {
		return Lock{}, err
	}
	r0, _, e1 := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(ptr)))
	h := windows.Handle(r0)
	if h == 0 || h == windows.InvalidHandle {
		return Lock{}, fmt.Errorf("CreateMutexW(%q): %w", name, e1)
	}
	return Lock{handle: h, Owned: !isAlreadyExists(e1)}, nil
}

// Close 释放句柄；首实例进程退出时 OS 兜底回收（调用方显式关是为测试内可复占）。
// 零值/无效句柄静默成功（幂等）。
func (l Lock) Close() error {
	if l.handle == 0 || l.handle == windows.InvalidHandle {
		return nil
	}
	return windows.CloseHandle(l.handle)
}

// NotifyExisting 唤醒已有实例：置位命名事件后返回。唤醒动作为「打开工作台」
// （方案 B 语义），由首实例的 Watcher.Wait 循环消费执行。
func NotifyExisting(name string) error {
	ptr, err := windows.UTF16PtrFromString(eventName(name))
	if err != nil {
		return err
	}
	h, err := windows.CreateEvent(nil, 0, 0, ptr) // auto-reset · non-signaled（见包注）
	if err != nil && !isAlreadyExists(err) {
		// already-exists 携带有效句柄（x/sys 封装当错误抛）：事件已存在 = 打开成功，正中
		// 本包「创建或打开」的意图；其余错误才真失败
		return fmt.Errorf("CreateEventW(%q): %w", eventName(name), err)
	}
	defer windows.CloseHandle(h)
	if err := windows.SetEvent(h); err != nil {
		return fmt.Errorf("SetEvent(%q): %w", eventName(name), err)
	}
	return nil
}

// Watcher 常驻唤醒监听：持有命名事件句柄直至 Close——事件对象全程存活，Notify 置位
// 的信号不随 NotifyExisting 的临时句柄关闭而丢（见包注「信号保留的前提」）。
type Watcher struct {
	event windows.Handle
}

// NewWatcher 创建/打开命名事件并常驻持有（调用序：先于 TryLock，见包注）。
func NewWatcher(name string) (*Watcher, error) {
	ptr, err := windows.UTF16PtrFromString(eventName(name))
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateEvent(nil, 0, 0, ptr) // auto-reset · non-signaled
	if err != nil && !isAlreadyExists(err) {
		return nil, fmt.Errorf("CreateEventW(%q): %w", eventName(name), err)
	}
	return &Watcher{event: h}, nil
}

// Wait 等待唤醒一次：命中 true；超时/失败 false。timeout<0 = INFINITE（生产形态）。
func (w *Watcher) Wait(timeout time.Duration) bool {
	if w == nil || w.event == 0 || w.event == windows.InvalidHandle {
		return false
	}
	ms := uint32(windows.INFINITE)
	if timeout >= 0 {
		ms = uint32(timeout.Milliseconds())
	}
	r, err := windows.WaitForSingleObject(w.event, ms)
	return err == nil && r == windows.WAIT_OBJECT_0
}

// Close 释放常驻句柄（进程退出时 OS 兜底回收；幂等）。
func (w *Watcher) Close() error {
	if w == nil || w.event == 0 || w.event == windows.InvalidHandle {
		return nil
	}
	return windows.CloseHandle(w.event)
}

// eventName 唤醒事件名：互斥体名 + 后缀，同一基础名下两对象各司其职。
func eventName(name string) string {
	return `Local\` + name + ".wakeup"
}

// isAlreadyExists LazyProc.Call 的 error（成功时为 Errno(0)，非 nil）→ 判
// ERROR_ALREADY_EXISTS。CreateMutexW 该 errno 伴随有效句柄返回 = 命名对象已存在。
func isAlreadyExists(err error) bool {
	var errno syscall.Errno
	return errors.As(err, &errno) && errno == windows.ERROR_ALREADY_EXISTS
}
