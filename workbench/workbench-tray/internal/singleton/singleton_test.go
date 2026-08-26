package singleton

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// uniqName 每用例唯一命名空间：测试之间互不干扰（Local\ 前缀由包统一加，传裸名）。
func uniqName(t *testing.T) string {
	return fmt.Sprintf("wb-tray-test-%s-%d", t.Name(), time.Now().UnixNano())
}

// TestTryLockFirstInstanceAcquires 首个实例占用成功。
func TestTryLockFirstInstanceAcquires(t *testing.T) {
	name := uniqName(t)
	lock, err := TryLock(name)
	if err != nil {
		t.Fatalf("TryLock: %v", err)
	}
	defer lock.Close()
	if !lock.Owned {
		t.Fatal("首个 TryLock 应 Owned=true（却被告知已有实例——单实例判定误报）")
	}
}

// TestTryLockSecondInstanceIsDuplicate 同名二次占用 = 判定为重复实例。
// Windows CreateMutex 语义：命名互斥体已存在（无论哪个进程创建）时返回 ERROR_ALREADY_EXISTS
// ——同进程内二次 Create 同名对象同样触发，故本测试可在单进程内模拟双开。
func TestTryLockSecondInstanceIsDuplicate(t *testing.T) {
	name := uniqName(t)
	first, err := TryLock(name)
	if err != nil {
		t.Fatalf("首个 TryLock: %v", err)
	}
	defer first.Close()

	second, err := TryLock(name)
	if err != nil {
		t.Fatalf("第二个 TryLock: %v", err)
	}
	defer second.Close()
	if second.Owned {
		t.Fatal("已有实例在跑时第二个 TryLock 应 Owned=false（双开防线失效——正是双图标 bug 根因）")
	}
}

// TestTryLockReleasedThenAcquirable 首实例释放（Close，等价退出）后，互斥体可被重新占用
// ——托盘退出后重开入口（开始菜单快捷方式）依赖此语义，否则退一次就永远起不来。
func TestTryLockReleasedThenAcquirable(t *testing.T) {
	name := uniqName(t)
	first, err := TryLock(name)
	if err != nil {
		t.Fatalf("首个 TryLock: %v", err)
	}
	if !first.Owned {
		t.Fatal("前置失败：首个 TryLock 未占用")
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	second, err := TryLock(name)
	if err != nil {
		t.Fatalf("释放后 TryLock: %v", err)
	}
	defer second.Close()
	if !second.Owned {
		t.Fatal("互斥体已释放后重开应 Owned=true（旧实例退出后新实例起不来）")
	}
}

// TestNotifyWakesBlockedWaiter 唤醒链路：首实例 Watcher 阻塞等待中，第二实例 NotifyExisting → 等待命中。
func TestNotifyWakesBlockedWaiter(t *testing.T) {
	name := uniqName(t)
	w, err := NewWatcher(name)
	if err != nil {
		t.Fatalf("NewWatcher: %v", err)
	}
	defer w.Close()
	got := make(chan bool, 1)
	go func() { got <- w.Wait(3 * time.Second) }()

	time.Sleep(100 * time.Millisecond) // 让 waiter 先就位（不依赖此序，见下一条用例）
	if err := NotifyExisting(name); err != nil {
		t.Fatalf("NotifyExisting: %v", err)
	}
	select {
	case ok := <-got:
		if !ok {
			t.Fatal("waiter 被唤醒却返回 false（唤醒信号丢失）")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("NotifyExisting 后 3s 内 waiter 未命中（唤醒链路断）")
	}
}

// TestWakeupSignalPersistsBeforeWaiter 信号保留：Watcher 常驻句柄在场时，Notify 先于
// Wait 发生，信号不丢。这覆盖真实竞态窗口——用户连点两下快捷方式，第二实例在首实例
// 进入 Wait 循环之前 SetEvent。（生产调用序 NewWatcher→TryLock 保证 Notify 时句柄必在场。）
func TestWakeupSignalPersistsBeforeWaiter(t *testing.T) {
	name := uniqName(t)
	w, err := NewWatcher(name)
	if err != nil {
		t.Fatalf("NewWatcher: %v", err)
	}
	defer w.Close()
	if err := NotifyExisting(name); err != nil {
		t.Fatalf("NotifyExisting（先于 Wait）: %v", err)
	}
	if !w.Wait(0) { // timeout=0：非阻塞探测当前信号态
		t.Fatal("Watcher 在场时先 Notify 后 Wait 应立即命中（信号未保留——连点竞态丢唤醒）")
	}
}

// TestWakeupAutoResetsAfterConsumed 唤醒一次消费一次：Wait 命中后事件自动复位
// （auto-reset 语义），残留信号不会把后续 Wait 全部误唤醒。
func TestWakeupAutoResetsAfterConsumed(t *testing.T) {
	name := uniqName(t)
	w, err := NewWatcher(name)
	if err != nil {
		t.Fatalf("NewWatcher: %v", err)
	}
	defer w.Close()
	if err := NotifyExisting(name); err != nil {
		t.Fatalf("NotifyExisting: %v", err)
	}
	if !w.Wait(200 * time.Millisecond) {
		t.Fatal("前置失败：首次 Wait 未命中")
	}
	if w.Wait(0) {
		t.Fatal("已消费的唤醒不应残留（auto-reset 失效——后续 Wait 会被幽灵信号误唤醒）")
	}
}

// TestWaitWakeupTimeout 无信号时按超时返回 false（不悬挂）。
func TestWaitWakeupTimeout(t *testing.T) {
	name := uniqName(t)
	w, err := NewWatcher(name)
	if err != nil {
		t.Fatalf("NewWatcher: %v", err)
	}
	defer w.Close()
	start := time.Now()
	if w.Wait(150 * time.Millisecond) {
		t.Fatal("无信号时 Wait 应返回 false")
	}
	if elapsed := time.Since(start); elapsed < 100*time.Millisecond {
		t.Fatalf("超时未生效：立即返回（elapsed=%v）", elapsed)
	}
}

// TestConcurrentNotifyAndWaits 并发压力：多路并发 Notify / Wait 下不死锁不崩溃
// （真实场景 = 快捷方式连点 + 托盘常驻 Wait 循环并发）。
func TestConcurrentNotifyAndWaits(t *testing.T) {
	name := uniqName(t)
	w, err := NewWatcher(name)
	if err != nil {
		t.Fatalf("NewWatcher: %v", err)
	}
	defer w.Close()
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 25; j++ {
				if err := NotifyExisting(name); err != nil {
					t.Errorf("并发 NotifyExisting: %v", err)
					return
				}
			}
		}()
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 25; j++ {
				w.Wait(10 * time.Millisecond) // 命中与否皆合法，只验不死锁
			}
		}()
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("并发 Notify/Wait 10s 未收敛（死锁或悬挂）")
	}
}
