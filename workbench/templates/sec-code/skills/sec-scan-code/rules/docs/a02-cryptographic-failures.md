# A02 - Cryptographic Failures (加密失败)

## 概述

加密失败指使用弱加密算法、硬编码密钥、不安全随机数等问题，导致敏感数据泄露。这是数据保护的核心问题。

OWASP排名：**A02** | 严重性：**HIGH**

## 漏洞类别

| 类别 | 说明 |
|------|------|
| weak-hash | 弱哈希算法（MD5/SHA1） |
| hardcoded-secret | 硬编码密钥/密码 |
| insecure-random | 不安全随机数（用于安全场景） |
| weak-encryption | 弱加密算法（DES/ECB模式） |
| plaintext-transmission | 明文传输敏感数据 |

## 各语言示例

### Python

**漏洞代码：**
```python
import hashlib, random
hashlib.md5(password.encode())  # 弱哈希
SECRET_KEY = 'hardcoded-secret'  # 硬编码密钥
token = random.randint(0, 999999)  # 不安全随机数
```

**安全代码：**
```python
import hashlib, secrets
hashlib.sha256(password.encode())  # SHA-256
SECRET_KEY = os.environ['SECRET_KEY']  # 环境变量
token = secrets.token_hex(32)  # 安全随机数
```

### Java

**漏洞代码：**
```java
MessageDigest.getInstance("MD5")  // 弱哈希
java.util.Random()  // 不安全随机数
Cipher.getInstance("DES")  // 弱加密
```

**安全代码：**
```java
MessageDigest.getInstance("SHA-256")
SecureRandom()
Cipher.getInstance("AES/GCM/NoPadding")
```

### Go

**漏洞代码：**
```go
import "crypto/md5"  // 弱哈希
import "math/rand"   // 不安全随机数
```

**安全代码：**
```go
import "crypto/sha256"
import "crypto/rand"
```

### JavaScript

**漏洞代码：**
```javascript
crypto.createHash('md5')  // 弱哈希
Math.random()  // 不安全随机数
```

**安全代码：**
```javascript
crypto.createHash('sha256')
crypto.randomBytes(32)
```

### C

**漏洞代码：**
```c
MD5(data, len, hash);  // 弱哈希
rand()  // 不安全随机数
DES_encrypt()  // 弱加密
```

**安全代码：**
```c
SHA256(data, len, hash);
RAND_bytes(buf, len);
```

## 修复建议

1. 使用SHA-256+替代MD5/SHA1
2. 密钥从环境变量/密钥管理服务获取，绝不硬编码
3. 安全场景使用`secrets`/`SecureRandom`/`crypto/rand`
4. 使用AES-GCM替代DES/ECB