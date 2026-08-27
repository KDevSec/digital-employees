# A06 - Vulnerable and Outdated Components (脆弱组件)

## 概述

使用已知有漏洞的组件或过时的依赖库。这是最容易被忽视的漏洞类型，因为开发者往往不关注依赖库的安全状态。

OWASP排名：**A06** | 严重性：**HIGH**

## 漏洞类别

| 类别 | 说明 |
|------|------|
| known-vulnerability | 已知CVE的依赖版本 |
| outdated-dependency | 过时的依赖版本 |
| unverified-component | 跳过验证安装的组件 |

## 各语言示例

### Python
```python
# 漏洞：requirements.txt中固定了有CVE的版本
flask==0.12  # 已知漏洞
django==1.11  # 已知漏洞
pip install --no-verify  # 跳过验证
```

### Java
```xml
<!-- 漏洞：pom.xml中有CVE的依赖 -->
<dependency>log4j 2.14</dependency>  <!-- Log4Shell -->
<repository><url>http://...</url></repository>  <!-- HTTP仓库 -->
```

### Go
```
// 漏洞：go.mod中伪版本可能过时
golang.org/x/net v0.0.0-20200101...
```

### JavaScript
```json
// 漏洞：package.json中有CVE的版本
"lodash": "4.17.15"  // 已知漏洞
npm install --ignore-scripts  // 跳过验证
```

### C
```c
// 漏洞：链接了有CVE的库版本
openssl 1.0.1  // Heartbleed
```

## 修复建议

1. 定期运行`npm audit`/`pip audit`/`dependency-check`
2. 使用Snyk/Dependabot/Renovate自动更新
3. 只从HTTPS源安装依赖
4. 使用SBOM（软件物料清单）追踪所有依赖