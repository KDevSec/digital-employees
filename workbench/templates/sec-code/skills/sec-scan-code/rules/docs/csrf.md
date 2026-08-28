# CSRF - Cross-Site Request Forgery (跨站请求伪造)

## 概述

CSRF攻击利用用户已认证的会话，诱使浏览器向目标网站发送非预期的请求。缺少CSRF令牌保护的状态变更操作是主要风险点。

严重性：**MEDIUM** | 优先级：supplementary

## 漏洞类别

| 类别 | 说明 |
|------|------|
| missing-csrf-token | 状态变更请求缺少CSRF令牌 |
| csrf-weak-validation | 仅基于Referer的弱CSRF验证 |
| missing-same-site | Cookie SameSite属性未设置 |

## 各语言示例

### Python

**漏洞代码：**
```python
@app.post("/transfer")  # 无CSRF保护
def transfer():
    amount = request.form['amount']
```

**安全代码：**
```python
@app.post("/transfer")
@csrf_protect
def transfer():
    amount = request.form['amount']
```

### Java

**漏洞代码：**
```java
@PostMapping("/transfer")  // 无CsrfToken
public void transfer(@RequestBody TransferRequest req) { ... }
```

**安全代码：**
```java
// Spring Security默认启用CSRF，确保不要disable()
http.csrf().csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse());
```

### JavaScript

**漏洞代码：**
```javascript
app.post('/transfer', (req, res) => {  // 无csurf中间件
  db.transfer(req.body.amount)
})
```

**安全代码：**
```javascript
app.post('/transfer', csrfProtection, (req, res) => { ... })
```

## 修复建议

1. 所有POST/PUT/DELETE请求必须包含CSRF令牌
2. Cookie设置SameSite=Lax或Strict
3. 使用框架内置的CSRF保护机制