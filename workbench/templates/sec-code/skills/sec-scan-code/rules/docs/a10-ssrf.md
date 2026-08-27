# A10 - Server-Side Request Forgery (服务端请求伪造)

## 概述

SSRF发生在服务端根据用户输入发起HTTP请求，攻击者可利用此访问内部服务、云元数据等。

OWASP排名：**A10** | 严重性：**HIGH**

## 漏洞类别

| 类别 | 说明 |
|------|------|
| ssrf-url | 用户控制的URL发起请求 |
| ssrf-redirect | 跟随重定向无验证 |
| ssrf-filter-bypass | 简单的SSRF过滤可绕过 |

## 各语言示例

### Python
```python
# 漏洞
requests.get(request.json['url'])  # 用户控制URL
urllib.request.urlopen(request.data['url'])
url.replace('localhost', '')  # 简单过滤可绕过
```

### Java
```java
// 漏洞
new URL(request.getParameter("url")).openStream()  // 用户控制URL
HttpClient.newHttpClient().send(request)  // 无URL验证
```

### Go
```go
// 漏洞
http.Get(r.FormValue("url"))  // 用户控制URL
http.NewRequest("GET", c.Query("url"), nil)
```

### JavaScript
```javascript
// 漏洞
fetch(req.body.url)  // 用户控制URL
axios.get(req.query.url)
```

### C
```c
// 漏洞
curl_easy_setopt(curl, CURLOPT_URL, user_input);  // 用户控制URL
```

## 修复建议

1. URL白名单：只允许访问预定义的域名
2. 禁止访问内网IP（127.0.0.1, 10.x, 172.16-31.x, 192.168.x）
3. 禁用重定向跟随或严格验证重定向目标
4. 不要用字符串替换来过滤SSRF（可被编码绕过）
5. 使用DNS解析后验证IP地址