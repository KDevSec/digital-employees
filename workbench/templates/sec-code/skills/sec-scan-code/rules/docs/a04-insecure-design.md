# A04 - Insecure Design (不安全设计)

## 概述

不安全设计指缺少安全设计模式，如速率限制、账户锁定、业务逻辑验证等。这不是实现bug，而是设计缺陷。

OWASP排名：**A04** | 严重性：**HIGH**

## 漏洞类别

| 类别 | 说明 |
|------|------|
| missing-rate-limit | 缺少速率限制 |
| missing-lockout | 缺少账户锁定机制 |
| business-logic-flaw | 业务逻辑漏洞（价格来自请求） |
| trust-boundary-violation | 信任边界违反（会话数据来自请求） |

## 各语言示例

### Python

**漏洞代码：**
```python
@app.route("/login", methods=["POST"])  # 无速率限制
def login():
    check_password(request.form['password'])  # 无尝试次数限制
    price = request.json['price']  # 价格来自请求
    session['role'] = request.json['role']  # 信任边界违反
```

**安全代码：**
```python
@limiter.limit("5/minute")
@app.route("/login", methods=["POST"])
def login():
    if attempt_count > MAX_ATTEMPTS:
        lockout_account()
```

### Java / Go / JavaScript / C

各语言模式类似：登录端点缺少速率限制装饰器/中间件，价格/金额直接从请求获取未做边界校验。

## 修复建议

1. 所有认证端点必须有速率限制
2. 实现账户锁定机制（N次失败后锁定）
3. 业务关键参数（价格、折扣）不从请求获取，从数据库读取
4. 明确信任边界：会话数据必须经过验证