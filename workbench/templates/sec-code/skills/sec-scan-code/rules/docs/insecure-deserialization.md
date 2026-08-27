# Insecure Deserialization (不安全反序列化)

## 概述

不安全反序列化是最危险的漏洞之一，可导致远程代码执行（RCE）。发生在反序列化不受信任的数据时未做类型验证。

严重性：**CRITICAL** | 优先级：supplementary

## 漏洞类别

| 类别 | 说明 |
|------|------|
| unsafe-deserialize | 反序列化不受信任的数据 |
| deserialize-type-confusion | 类型混淆攻击 |

## 各语言示例

### Python
```python
# 漏洞
pickle.loads(data)  # RCE风险
yaml.load(data)  # 无SafeLoader
eval(request.data)  # 代码注入
```

### Java
```java
// 漏洞
ObjectInputStream ois = new ObjectInputStream(input);  // 反序列化RCE
ObjectMapper.enableDefaultTyping()  // Jackson类型混淆
Fastjson.parse(json)  // Fastjson autoType RCE
```

### JavaScript
```javascript
// 漏洞
deserialize(buffer)  // RCE风险
eval(JSON.stringify(data))  // 代码注入
```

## 修复建议

1. 使用JSON替代二进制序列化格式
2. Python使用`yaml.safe_load`替代`yaml.load`
3. Java使用ObjectInputFilter限制反序列化类型
4. 禁用Jackson的enableDefaultTyping
5. Fastjson设置autoType安全模式