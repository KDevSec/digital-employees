# A09 - Security Logging and Monitoring Failures (日志监控失败)

## 概述

缺少安全日志和监控意味着攻击发生时无法检测和响应。包括静默吞异常、敏感数据写入日志、缺少告警等。

OWASP排名：**A09** | 严重性：**MEDIUM**

## 漏洞类别

| 类别 | 说明 |
|------|------|
| missing-logging | 缺少日志记录（空catch/except） |
| sensitive-in-log | 敏感数据写入日志 |
| missing-alert | 缺少安全告警 |
| log-injection | 日志注入 |

## 各语言示例

### Python
```python
# 漏洞
except Exception:
    pass  # 静默吞异常
logger.info(f"login: {password}")  # 密码写入日志
logger.info(request.body)  # 完整请求体（可能含敏感数据）
```

### Java
```java
// 漏洞
catch (Exception e) {}  // 空catch
log.debug("password: " + password);  // 密码写入日志
```

### Go / JavaScript / C

类似模式：错误返回不记录、密码/令牌写入日志、用户输入未清理写入日志。

## 修复建议

1. 绝不使用空catch/except块
2. 认证失败、权限拒绝等安全事件必须记录
3. 日志中脱敏处理密码/令牌
4. 对暴力破解等异常行为设置告警
5. 用户输入写入日志前进行清理（防日志注入）