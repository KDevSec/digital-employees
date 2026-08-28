# A01 - Broken Access Control (权限控制失效)

## 概述

权限控制失效是最常见的Web应用安全漏洞。当用户可以越权访问资源或执行操作时，就发生了权限控制失效。典型场景包括：未认证访问、IDOR（不安全的直接对象引用）、权限提升。

OWASP排名：**A01** | 严重性：**CRITICAL**

## 漏洞类别

| 类别 | 说明 |
|------|------|
| missing-auth | 缺少认证装饰器/中间件 |
| idor | 不安全的直接对象引用 |
| privilege-escalation | 权限提升（硬编码角色判断） |
| missing-permission-check | 缺少权限检查 |

## 各语言示例

### Python

**漏洞代码：**
```python
@app.get("/users/{id}")  # 无认证装饰器
def get_user(id):
    return User.objects.get(id=id)  # IDOR：任意用户可访问
```

**安全代码：**
```python
@app.get("/users/{id}")
@login_required
@permission_required('user.view')
def get_user(id):
    user = get_object_or_404(User, id=id)
    if not request.user.has_access(user):
        raise PermissionDenied
    return user
```

### Java

**漏洞代码：**
```java
@GetMapping("/users/{id}")  // 无 @PreAuthorize
public User getUser(@PathVariable Long id) {
    return userRepository.findById(id);  // IDOR
}
```

**安全代码：**
```java
@PreAuthorize("hasAuthority('user:view') and #id == authentication.principal.id")
@GetMapping("/users/{id}")
public User getUser(@PathVariable Long id) { ... }
```

### Go

**漏洞代码：**
```go
r.HandleFunc("/users/{id}", getUser)  // 无认证中间件
func getUser(w http.ResponseWriter, r *http.Request) {
    db.First(&user, c.Param("id"))  // IDOR
}
```

**安全代码：**
```go
r.HandleFunc("/users/{id}", AuthMiddleware(getUser))
```

### JavaScript

**漏洞代码：**
```javascript
app.get('/users/:id', (req, res) => {  // 无认证中间件
  User.findById(req.params.id)  // IDOR
})
```

**安全代码：**
```javascript
app.get('/users/:id', requireAuth, (req, res) => { ... })
```

### C

**漏洞代码：**
```c
void handle_request(char *input) {  // 无认证检查
    if (strcmp(role, "admin") == 0) {  // 硬编码角色
        // 执行管理员操作
    }
}
```

## 修复建议

1. 所有API端点必须有认证装饰器/中间件
2. 使用框架的权限系统而非硬编码角色判断
3. 对对象访问进行所有权验证（防IDOR）
4. 默认拒绝，显式允许