---
name: secretgate
description: 密钥泄露扫描与定性——脚本零 token 扫描命中（API Key/私钥/连接串/凭证模式），LLM 做真泄露 vs 测试 fixture 的定性解读与处置建议
version: 1.0.0
vendored_from: agents-team@1.0
license: MIT
---

# 密钥泄露扫描（secretgate）

`scripts/secretgate.mjs` —— 1.0 `ieidev_hud/secretgate.py` 正则规则引擎 TS 生态移植（ESM mjs 零依赖）。

## 用法

```bash
# 扫描单文件
node scripts/secretgate.mjs path/to/file.md

# 扫描目录（递归常见文本扩展名）
node scripts/secretgate.mjs path/to/dir/

# 输出 JSON 报告到 stdout
{
 "file": "path/to/file.md",
 "hits": [
   {"rule": "token", "type": "token", "description": "GitHub Personal Access Token",
    "match": "ghp_...", "line": 12, "col": 5}
 ]
}

# 退出码：有命中 1，无命中 0，用法错误 1
```

## 编程式调用（mjs 模块导入）

```js
import { scan, scanFile } from './scripts/secretgate.mjs'

const hits = scan('text containing ghp_xxx...')
// hits: [{rule, type, description, match, line, col}]

const fileHits = scanFile('path/to/file.md')
// fileHits: [...hits with file field]
```

## 规则集

移植自 1.0 `_CORE_RULES` + `_MULTI_LINE_RULES`（22+ 条核心 + 1 条多行 PEM 块）：

- 硬编码密码（带/不带引号、JDBC 连接串、DATABASE_URL 等）
- API Key（api_key/apikey/api_secret）
- Token（GitHub `ghp_`、通用 token、Bearer、JWT `eyJ...`）
- 私钥（PEM 块 `-----BEGIN ... PRIVATE KEY-----`）
- 服务专属：AWS（`AKIA`/`aws_secret`）、Slack（`xox[baprs]-`）、Stripe（`sk_live_`/`rk_live_`）、Google（`AIza`）、OpenAI（`sk-`/`sk-proj-`）
- 数据库连接串含凭据（`postgres://user:pass@`/`mysql://`/`mongodb://`/`redis://`/`amqp://`/`ftp://`）

## 豁免模式（不报）

`your_X_here`、`example`、`placeholder`、`changeme`、`<YOUR_KEY>`、`${VAR}`、`xxx`、`test`、`fake`、`demo`、`sample` —— 命中规则但匹配文本含豁免词时跳过。

注释行（`#` / `//` / `--`，但不跳 PEM 头）整行跳过。

## A1 分工（D-044/Q-sg 决策落地）

**扫描由 skill 内置脚本执行**（毫秒级、零 token、正则规则集）；
**你（LLM）负责命中结果的定性解读**——区分真泄露与测试 fixture/示例密钥/文档说明文字，
给出处置建议（人工处置/打回重做）并写进 handoff 明细。脚本说什么不算数，你的定性才算闸的结论。

### 准入阶段（n-adm）

任务输入文档跑 secretgate 全量规则 → 命中即停跑上报（规则 ID + 位置）→ LLM 定性：
- 真泄露 → 阻断任务，要求人工处置
- 测试 fixture / 示例密钥 / 文档说明文字 → 标注豁免理由，任务可推进
- 模糊情形 → 写明疑点，建议人工复核

### 准出阶段（n3-sec）

交付产物复扫 secretgate → 命中即按准入同样定性流程处置。
