# XSS - Cross-Site Scripting (跨站脚本)

## 概述

XSS发生在用户输入未经转义直接渲染到HTML中，攻击者可注入脚本窃取Cookie/令牌。

严重性：**HIGH** | 优先级：supplementary

## 漏洞类别

| 类别 | 说明 |
|------|------|
| xss-reflected | 反射型XSS（输入直接出现在响应中） |
| xss-stored | 存储型XSS（恶意输入存入数据库） |
| xss-dom | DOM型XSS（客户端渲染） |

## 各语言示例

### Python
```python
# 漏洞
render_template_string(request.args['name'])  # 反射型XSS
mark_safe(user_input)  # 标记为安全HTML
```

### JavaScript
```javascript
// 漏洞
element.innerHTML = userInput  // DOM XSS
res.send(req.query.name)  // 反射型XSS
```

## 修复建议

1. 使用模板引擎的自动转义功能
2. 使用textContent替代innerHTML
3. 输入净化库：DOMPurify/bleach
4. 设置CSP（Content-Security-Policy）响应头