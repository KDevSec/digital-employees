# A07 - Identification and Authentication Failures (认证失败)

## 概述

认证失败包括弱密码策略、会话管理缺陷、凭据泄露、缺少MFA等。攻击者可利用这些漏洞冒充用户。

OWASP排名：**A07** | 严重性：**CRITICAL**

## 漏洞类别

| 类别 | 说明 |
|------|------|
| weak-password | 弱密码策略（长度过短） |
| broken-session | 会话管理缺陷 |
| credential-exposure | 凭据泄露（密码在响应中） |
| missing-mfa | 缺少多因素认证 |

## 各语言示例

### Python
```python
# 漏洞
SESSION_COOKIE_SECURE = False  # 不安全的Cookie
password = request.json['password']
return jsonify(password=password)  # 密码在响应中
```

### Java
```java
// 漏洞
session.setAttribute("role", request.getParameter("role"));  // 会话来自请求
response.getWriter().write("password: " + password);  // 密码泄露
```

### Go / JavaScript / C

类似模式：不安全的Cookie设置、密码在输出中、仅密码认证无MFA。

## 修复建议

1. 密码最小长度8+字符，要求复杂度
2. Cookie设置Secure/HttpOnly/SameSite
3. 绝不在响应中返回密码/令牌
4. 关键操作启用MFA
5. 使用bcrypt/argon2存储密码哈希