# Race Conditions (竞态条件)

## 概述

竞态条件发生在并发访问共享资源时缺少同步机制。TOCTOU（检查时间/使用时间）是最常见的竞态类型。

严重性：**MEDIUM** | 优先级：supplementary

## 漏洞类别

| 类别 | 说明 |
|------|------|
| toctou | 检查时间/使用时间竞态 |
| missing-lock | 缺少锁/互斥机制 |
| atomic-violation | 非原子操作违反 |

## 各语言示例

### Python
```python
# 漏洞
if os.path.exists(path):  # TOCTOU
    with open(path) as f: ...
threading.Thread(target=worker)  # 无Lock
filter(...).update(...)  # 非原子filter-update
```

### Java
```java
// 漏洞
if (file.exists()) new FileInputStream(file);  // TOCTOU
new Thread(() -> worker());  // 无synchronized
atomicInt.get(); atomicInt.set(x);  // 非原子get-set
```

### Go
```go
// 漏洞
if _, err := os.Stat(path); err == nil {  // TOCTOU
    os.Open(path)
}
go func() { ... }()  // 无mutex/channel同步
```

### JavaScript
```javascript
// 漏洞
if (await fs.exists(path)) await fs.readFile(path)  // TOCTOU
Promise.all([task1(), task2()])  // 无同步
```

### C
```c
// 漏洞
if (access(path, R_OK) == 0) fopen(path, "r");  // TOCTOU
global_counter++;  // 非原子递增
```

## 修复建议

1. 使用原子操作替代check-then-act模式
2. 并发访问共享资源必须加锁
3. 数据库操作使用事务和`SELECT FOR UPDATE`
4. Go使用sync.Mutex或channel同步
5. C使用atomic操作或pthread_mutex