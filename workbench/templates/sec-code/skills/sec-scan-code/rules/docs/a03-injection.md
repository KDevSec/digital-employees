# A03 - Injection (注入攻击)

## 概述

注入攻击发生在用户输入未经处理直接拼接到SQL/命令/模板中。这是最危险的漏洞类型之一，可导致数据泄露、RCE（远程代码执行）。

OWASP排名：**A03** | 严重性：**CRITICAL**

## 漏洞类别

| 类别 | 说明 |
|------|------|
| sql-injection | SQL注入 |
| command-injection | 命令注入 |
| template-injection | 模板注入（SSTI） |
| ldap-injection | LDAP注入 |

## 各语言示例

### Python

**漏洞代码：**
```python
db.execute(f"SELECT * FROM users WHERE id = {user_id}")  # SQL注入
os.system(user_input)  # 命令注入
subprocess.call(cmd, shell=True)  # 命令注入
eval(request.data)  # 代码注入
```

**安全代码：**
```python
db.execute("SELECT * FROM users WHERE id = ?", (user_id,))  # 参数化查询
subprocess.run(cmd, shell=False)  # 不使用shell
```

### Java

**漏洞代码：**
```java
Statement.execute("SELECT * FROM users WHERE id = " + id)  // SQL注入
Runtime.getRuntime().exec(userInput)  // 命令注入
```

**安全代码：**
```java
PreparedStatement stmt = conn.prepareStatement("SELECT * FROM users WHERE id = ?");
stmt.setLong(1, id);
```

### Go

**漏洞代码：**
```go
query := fmt.Sprintf("SELECT * FROM users WHERE id = %s", id)  // SQL注入
exec.Command("sh", "-c", userInput)  // 命令注入
```

**安全代码：**
```go
db.Query("SELECT * FROM users WHERE id = $1", id)  // 参数化
```

### JavaScript

**漏洞代码：**
```javascript
db.query(`SELECT * FROM users WHERE id = ${id}`)  // SQL注入
child_process.exec(userInput)  // 命令注入
```

**安全代码：**
```javascript
db.query('SELECT * FROM users WHERE id = $1', [id])
```

### C

**漏洞代码：**
```c
sprintf(query, "SELECT * FROM users WHERE id = %s", input);  // SQL注入
system(user_input);  // 命令注入
```

**安全代码：**
```c
sqlite3_prepare_v2(db, "SELECT * FROM users WHERE id = ?", -1, &stmt, 0);
sqlite3_bind_text(stmt, 1, input, -1, SQLITE_STATIC);
```

## 修复建议

1. **始终使用参数化查询/预编译语句**
2. 禁止`shell=True`/`system()`/`exec()`处理用户输入
3. 输入验证：白名单优于黑名单
4. 最小权限原则：数据库用户只授予必要权限