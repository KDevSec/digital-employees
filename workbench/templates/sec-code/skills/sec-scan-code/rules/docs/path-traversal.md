# Path Traversal (路径遍历)

## 概述

路径遍历发生在用户输入用于文件路径而未做清理时，攻击者可使用`../`访问任意文件。

严重性：**HIGH** | 优先级：supplementary

## 漏洞类别

| 类别 | 说明 |
|------|------|
| path-user-input | 文件操作使用用户控制的路径 |
| path-concatenation | 路径拼接用户输入 |
| path-symlink | 符号链接操作使用用户输入 |

## 各语言示例

### Python
```python
# 漏洞
open(request.args['file'])  # 用户控制文件路径
os.path.join(base, request.data['path'])  # 路径拼接用户输入
send_file(request.args['file'])  # 用户控制文件响应
```

### Java
```java
// 漏洞
new File(request.getParameter("file"))  // 用户控制文件路径
Paths.get(base, request.getParameter("path"))  // 路径拼接
```

### JavaScript
```javascript
// 漏洞
fs.readFile(req.query.file)  // 用户控制文件路径
path.join(base, req.body.path)  // 路径拼接
```

## 修复建议

1. 验证规范化路径在允许的目录内：`realpath().startswith(allowed_dir)`
2. 使用白名单限制可访问的文件
3. 不要直接拼接用户输入到文件路径
4. 处理符号链接后验证最终路径