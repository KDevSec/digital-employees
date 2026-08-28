# A05 - Security Misconfiguration (安全配置错误)

## 概述

安全配置错误包括CORS通配符、调试模式开启、默认凭据、详细错误信息等。这是最常见的中等风险漏洞。

OWASP排名：**A05** | 严重性：**MEDIUM**

## 漏洞类别

| 类别 | 说明 |
|------|------|
| cors-wildcard | CORS允许所有来源 |
| debug-mode | 调试模式在生产环境开启 |
| default-credentials | 默认密码/凭据 |
| verbose-errors | 详细错误信息泄露 |
| missing-security-headers | 缺少安全响应头 |

## 各语言示例

### Python

**漏洞代码：**
```python
DEBUG = True  # 生产环境调试模式
CORS_ORIGIN_ALLOW_ALL = True  # CORS通配符
password = 'admin'  # 默认密码
traceback.print_exc()  # 打印异常堆栈
```

**安全代码：**
```python
DEBUG = False
CORS_ALLOW_ORIGINS = ['https://specific-domain.com']
```

### Java

**漏洞代码：**
```java
spring.profiles.active=dev  // 开发配置
Access-Control-Allow-Origin: *  // CORS通配符
e.printStackTrace()  // 堆栈泄露
```

### Go / JavaScript / C

类似模式：CORS通配符、调试日志级别、默认密码、错误堆栈暴露。

## 修复建议

1. 生产环境关闭DEBUG模式
2. CORS指定具体域名，不用通配符
3. 修改所有默认密码
4. 错误响应不包含堆栈信息
5. 添加安全响应头（X-Frame-Options, CSP等）