/**
 * secretgate.mjs — 密钥泄露扫描（A1 零 token 扫描 + LLM 定性分工）
 *
 * 1.0 agents-team/pyieidev/ieidev_hud/secretgate.py 正则规则引擎 TS 生态移植（ESM mjs 零依赖）。
 * vendored_from: agents-team@1.0（2026-08-27 移植）；sec-compliance skill 内置脚本。
 *
 * A1 分工（D-044/Q-sg 决策）：
 *   - 脚本零 token 扫描命中（正则规则集——本文件）
 *   - LLM 做真泄露 vs 测试 fixture 的定性解读与处置建议（SKILL.md 描述）
 *   - 脚本说什么不算数——扫描结果交 LLM 定性
 *
 * 用法：
 *   node secretgate.mjs <file>          → JSON 报告到 stdout（{file, hits: [{rule, match, line, col}]}）
 *   node secretgate.mjs                 → usage + exit 1
 *
 * 退出码：有命中 exit 1；无命中 exit 0；用法错误 exit 1。
 *
 * 规则集：从 1.0 secretgate.py _CORE_RULES + _MULTI_LINE_RULES 移植（re.IGNORECASE | re.MULTILINE）。
 * 豁免：_WHITELIST_PATTERNS（your_X_here/example/placeholder/changeme/<...>/${...}/xxx/test/fake/demo/sample）。
 */

import { readFileSync, existsSync, statSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 核心扫描规则 ──────────────────────────────────────────────
// 每条: [pattern, type, description]
// 移植自 1.0 _CORE_RULES（re.IGNORECASE | re.MULTILINE）
const CORE_RULES = [
  // 硬编码密码
  [/(?:password|passwd|pwd)\s*[:=]\s*["'](?!\s*["'])(?!.*(?:your_|example|placeholder|changeme|<))[^"']{3,}["']/gim, 'password', '硬编码密码'],
  [/(?:password|passwd|pwd)\s*[:=]\s*[^"'\s]{6,}/gim, 'password', '硬编码密码（无引号）'],
  // API Key
  [/(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*["'](?!\s*["'])(?!.*(?:your_|example|placeholder|<|\$\{))[^"']{8,}["']/gim, 'api_key', '硬编码 API Key'],
  [/(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*[^"'\s]{8,}/gim, 'api_key', '硬编码 API Key（无引号）'],
  // Token (GitHub / 通用)
  [/(?:token|access_token|auth_token|secret_token)\s*[:=]\s*["'](?!\s*["'])(?!.*(?:your_|example|placeholder|<|\$\{))[^"']{8,}["']/gim, 'token', '硬编码 Token'],
  [/ghp_[a-zA-Z0-9]{36}/g, 'token', 'GitHub Personal Access Token'],
  [/github[_-]?token\s*[:=]\s*["']?(?!.*(?:your_|example|<|\$\{))[^"'\s]{8,}/gim, 'token', 'GitHub Token'],
  // 私钥（单行 PEM 头）
  [/-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PRIVATE)\s/gim, 'private_key', '私钥文件'],
  // Bearer Token
  [/Authorization["']?\s*[:=]\s*["']?\s*Bearer\s+(?!.*(?:your_|example|placeholder|<|\$\{))[^"')\s]{20,}/gim, 'token', '硬编码 Bearer Token'],
  [/bearer\s*[:=]\s*["']?(?!\s*["'])[^"'\s]{20,}/gim, 'token', '硬编码 Bearer Token'],
  // JDBC / 连接串凭据
  [/jdbc:[a-z]+:\/\/[^?\s]+\?(?:.*&)?password=([^&\s]{3,})/gim, 'password', 'JDBC 连接串含硬编码密码'],
  // 数据库连接凭据
  [/(?:DATABASE_URL|DB_URL|MONGO_URI|REDIS_URL)\s*[:=]\s*["'](?!.*(?:your_|example|placeholder|<|\$\{))[^"']{10,}["']/gim, 'password', '数据库连接串含凭据'],
  // ── 服务专属密钥 ──
  // AWS Access Key
  [/(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g, 'aws_key', 'AWS Access Key ID'],
  [/(?:aws_secret_access_key|secret_access_key|secretKey|aws_secret)["'\s:=]+([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gim, 'aws_key', 'AWS Secret Access Key'],
  // Slack Token
  [/(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{10,72}(?![A-Za-z0-9-])/g, 'slack_token', 'Slack Bot/User Token'],
  // Stripe Key
  [/(?<![A-Za-z0-9_])sk_live_[A-Za-z0-9]{24,99}(?![A-Za-z0-9_])/g, 'stripe_key', 'Stripe Secret Key (live)'],
  [/(?<![A-Za-z0-9_])rk_live_[A-Za-z0-9]{24,99}(?![A-Za-z0-9_])/g, 'stripe_key', 'Stripe Restricted Key (live)'],
  // Google API Key
  [/(?<![A-Za-z0-9_])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, 'google_key', 'Google API Key'],
  // OpenAI Key
  [/(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}(?![A-Za-z0-9_-])/g, 'openai_key', 'OpenAI API Key'],
  [/(?<![A-Za-z0-9_-])sk-proj-[A-Za-z0-9_-]{40,200}(?![A-Za-z0-9_-])/g, 'openai_key', 'OpenAI Project Key'],
  // JWT Token
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?![A-Za-z0-9_-])/g, 'jwt', 'JSON Web Token (JWT)'],
  // 数据库连接串含凭据（通用 URI 格式）
  [/(?:postgres|mysql|mongodb|redis|amqp|ftp):\/\/[^\s"'<>]*:(?:[^@\s"'<>]{4,})@/gim, 'password', '数据库连接串含凭据'],
]

// 多行规则：扫描全文（非逐行），用于 PEM 私钥块等跨行模式
const MULTI_LINE_RULES = [
  [/-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)\s+PRIVATE\s+KEY-----\s*[\s\S]*?-----END\s+(?:RSA|EC|DSA|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/gim, 'private_key', '私钥文件（PEM 块）'],
]

// ── 豁免模式（不扫描） ────────────────────────────────────────
const WHITELIST_PATTERNS = [
  /your[_-]?password[_-]?here/i,
  /your[_-]?api[_-]?key[_-]?here/i,
  /your[_-]?token[_-]?here/i,
  /example[_-]?/i,
  /placeholder/i,
  /changeme/i,
  /<[^>]+>/, // <YOUR_API_KEY>
  /\$\{[^}]+\}/, // ${API_KEY}
  /(?<![a-zA-Z0-9_.-])xxx+(?![a-zA-Z0-9_.-])/i, // placeholder xxx (standalone)
  /test[_-]?/i,
  /fake[_-]?/i,
  /demo[_-]?/i,
  /sample[_-]?/i,
]

function isWhitelisted(matchText) {
  return WHITELIST_PATTERNS.some((p) => p.test(matchText))
}

/**
 * scan(text) — 纯函数：扫描文本，返回命中列表。
 * @param {string} text
 * @returns {Array<{rule: string, type: string, description: string, match: string, line: number, col: number}>}
 */
export function scan(text) {
  if (!text || typeof text !== 'string') return []
  const hits = []

  // 逐行扫描（单行规则）
  const lines = text.split('\n')
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]
    const stripped = line.trim()
    // 跳过纯注释行（与 1.0 一致：# / // / -- 但不跳 PEM 头）
    if (
      stripped.startsWith('#') ||
      stripped.startsWith('//') ||
      (stripped.startsWith('--') && !stripped.startsWith('-----BEGIN'))
    ) {
      continue
    }
    for (const [pattern, type, desc] of CORE_RULES) {
      pattern.lastIndex = 0
      let m
      while ((m = pattern.exec(line)) !== null) {
        const matched = m[0]
        if (isWhitelisted(matched)) continue
        const col = m.index + 1
        hits.push({
          rule: type,
          type,
          description: desc,
          match: matched.length > 80 ? matched.slice(0, 80) : matched,
          line: lineNo + 1,
          col,
        })
        if (m.index === pattern.lastIndex) pattern.lastIndex++
      }
    }
  }

  // 全文扫描（多行规则）
  for (const [pattern, type, desc] of MULTI_LINE_RULES) {
    pattern.lastIndex = 0
    let m
    while ((m = pattern.exec(text)) !== null) {
      const matched = m[0]
      if (isWhitelisted(matched)) continue
      const startLine = text.slice(0, m.index).split('\n').length
      const display = matched.length > 60 ? matched.slice(0, 60) + '...' : matched
      hits.push({
        rule: type,
        type,
        description: desc,
        match: display,
        line: startLine,
        col: 1,
      })
      if (m.index === pattern.lastIndex) pattern.lastIndex++
    }
  }

  return hits
}

/**
 * scanFile(filePath) — 扫描单个文件，返回带 file 字段的命中列表。
 */
export function scanFile(filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return []
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  const hits = scan(text)
  return hits.map((h) => ({ ...h, file: filePath }))
}

// ── CLI ─────────────────────────────────────────────────────────
function usage() {
  process.stderr.write('usage: node secretgate.mjs <file-or-dir>\n')
  process.stderr.write('  输出 JSON 报告到 stdout：{file, hits: [{rule, type, match, line, col}]}\n')
  process.stderr.write('  退出码：有命中 1，无命中 0，用法错误 1\n')
}

function main() {
  const arg = process.argv[2]
  if (!arg) {
    usage()
    process.exit(1)
  }

  if (!existsSync(arg)) {
    process.stderr.write(`not found: ${arg}\n`)
    process.exit(1)
  }

  const stat = statSync(arg)
  let allHits = []
  let file = arg
  if (stat.isFile()) {
    const text = readFileSync(arg, 'utf8')
    allHits = scan(text).map((h) => ({ ...h, file: arg }))
  } else if (stat.isDirectory()) {
    const EXT = new Set(['.md', '.yml', '.yaml', '.json', '.py', '.js', '.ts', '.mjs', '.txt', '.env', '.sh', '.toml', '.cfg', '.ini', '.xml'])
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        const s = statSync(p)
        if (s.isDirectory()) walk(p)
        else if (EXT.has(p.slice(p.lastIndexOf('.')).toLowerCase())) {
          const text = readFileSync(p, 'utf8')
          allHits.push(...scan(text).map((h) => ({ ...h, file: p })))
        }
      }
    }
    walk(arg)
    file = arg
  }

  const report = { file, hits: allHits }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exit(allHits.length > 0 ? 1 : 0)
}

// 仅在直接执行时跑 CLI（被 import 时不跑）
const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()
if (isMain) {
  main()
}
