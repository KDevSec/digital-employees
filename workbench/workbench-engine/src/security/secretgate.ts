/**
 * secretgate TS 移植（L3 T10）——1.0 ieidev_hud/secretgate.py 逐条移植。
 * 敏感数据扫描（密钥/密码/Token 泄露检测）——「三站式防线第一站：flow 准入前扫描输入文档」。
 * 纯正则规则引擎 + 豁免白名单，零依赖；消费方：sec-compliance 员工（准入/准出检查）。
 * 语义保持：逐行扫描（跳注释行）+ 全文多行规则（PEM）+ match 截 80 字符 + 豁免模式。
 */

export interface Finding {
  type: string
  description: string
  match: string
  line: number
}

/** 核心规则：(pattern, type, description)——py _CORE_RULES 逐条（JS 正则 i 等价 IGNORECASE） */
const CORE_RULES: [RegExp, string, string][] = [
  // 硬编码密码
  [/(?:password|passwd|pwd)\s*[:=]\s*["'](?!\s*["'])(?!.*(?:your_|example|placeholder|changeme|<))[^"']{3,}["']/i, 'password', '硬编码密码'],
  [/(?:password|passwd|pwd)\s*[:=]\s*[^"'\s]{6,}/i, 'password', '硬编码密码（无引号）'],
  // API Key
  [/(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*["'](?!\s*["'])(?!.*(?:your_|example|placeholder|<|\$\{))[^"']{8,}["']/i, 'api_key', '硬编码 API Key'],
  [/(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*[^"'\s]{8,}/i, 'api_key', '硬编码 API Key（无引号）'],
  // Token（GitHub/通用）
  [/(?:token|access_token|auth_token|secret_token)\s*[:=]\s*["'](?!\s*["'])(?!.*(?:your_|example|placeholder|<|\$\{))[^"']{8,}["']/i, 'token', '硬编码 Token'],
  [/ghp_[a-zA-Z0-9]{36}/, 'token', 'GitHub Personal Access Token'],
  [/github[_-]?token\s*[:=]\s*["']?(?!.*(?:your_|example|<|\$\{))[^"'\s]{8,}/i, 'token', 'GitHub Token'],
  // 私钥（单行 PEM 头）
  [/-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PRIVATE)\s/, 'private_key', '私钥文件'],
  // Bearer Token
  [/Authorization["']?\s*[:=]\s*["']?\s*Bearer\s+(?!.*(?:your_|example|placeholder|<|\$\{))[^"')\s]{20,}/i, 'token', '硬编码 Bearer Token'],
  [/bearer\s*[:=]\s*["']?(?!\s*["'])[^"'\s]{20,}/i, 'token', '硬编码 Bearer Token'],
  // JDBC / 连接串凭据
  [/jdbc:[a-z]+:\/\/[^?\s]+\?(?:.*&)?password=([^&\s]{3,})/i, 'password', 'JDBC 连接串含硬编码密码'],
  // 数据库连接凭据
  [/(?:DATABASE_URL|DB_URL|MONGO_URI|REDIS_URL)\s*[:=]\s*["'](?!.*(?:your_|example|placeholder|<|\$\{))[^"']{10,}["']/i, 'password', '数据库连接串含凭据'],
  // 服务专属密钥（对标 CodeBuddy/Qoder secretgate 规则集）
  [/(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/, 'aws_key', 'AWS Access Key ID'],
  [/(?:aws_secret_access_key|secret_access_key|secretKey|aws_secret)["'\s:=]+([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/, 'aws_key', 'AWS Secret Access Key'],
  [/(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{10,72}(?![A-Za-z0-9-])/, 'slack_token', 'Slack Bot/User Token'],
  [/(?<![A-Za-z0-9_])sk_live_[A-Za-z0-9]{24,99}(?![A-Za-z0-9_])/, 'stripe_key', 'Stripe Secret Key (live)'],
  [/(?<![A-Za-z0-9_])rk_live_[A-Za-z0-9]{24,99}(?![A-Za-z0-9_])/, 'stripe_key', 'Stripe Restricted Key (live)'],
  [/(?<![A-Za-z0-9_])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/, 'google_key', 'Google API Key'],
  [/(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}(?![A-Za-z0-9_-])/, 'openai_key', 'OpenAI API Key'],
  [/(?<![A-Za-z0-9_-])sk-proj-[A-Za-z0-9_-]{40,200}(?![A-Za-z0-9_-])/, 'openai_key', 'OpenAI Project Key'],
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?![A-Za-z0-9_-])/, 'jwt', 'JSON Web Token (JWT)'],
  [/(?:postgres|mysql|mongodb|redis|amqp|ftp):\/\/[^\s"'<>]*:(?:[^@\s"'<>]{4,})@/i, 'password', '数据库连接串含凭据（通用 URI 格式）'],
]

/** 豁免模式（py _WHITELIST_PATTERNS 逐条） */
const WHITELIST_PATTERNS: RegExp[] = [
  /your[_-]?password[_-]?here/i,
  /your[_-]?api[_-]?key[_-]?here/i,
  /your[_-]?token[_-]?here/i,
  /example[_-]?/i,
  /placeholder/i,
  /changeme/i,
  /<[^>]+>/,
  /\$\{[^}]+\}/,
  /(?<![a-zA-Z0-9_.-])xxx+(?![a-zA-Z0-9_.-])/,
  /test[_-]?/i,
  /fake[_-]?/i,
  /demo[_-]?/i,
  /sample[_-]?/i,
]

/** 多行规则（全文扫描——PEM 私钥块） */
const MULTI_LINE_RULES: [RegExp, string, string][] = [
  [/-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)\s+PRIVATE\s+KEY-----\s*[\s\S]*?-----END\s+(?:RSA|EC|DSA|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/, 'private_key', '私钥文件（PEM 块）'],
]

/** 扫描规则必须全局标志（py finditer 等价——无 g 则 exec 原地循环） */
const withGlobal = (rules: [RegExp, string, string][]): [RegExp, string, string][] =>
  rules.map(([r, t, d]) => [new RegExp(r.source, r.flags.includes('g') ? r.flags : `${r.flags}g`), t, d] as [RegExp, string, string])

const CORE = withGlobal(CORE_RULES)
const MULTI_LINE = withGlobal(MULTI_LINE_RULES)

const isWhitelisted = (matchText: string): boolean =>
  WHITELIST_PATTERNS.some((p) => p.test(matchText))

/** 是否注释行（py 同款三前缀；PEM 头豁免——多行规则独立处理） */
const isCommentLine = (line: string): boolean => {
  const s = line.trim()
  return s.startsWith('#') || s.startsWith('//') || (s.startsWith('--') && !s.startsWith('-----BEGIN'))
}

/** 扫描文本：逐行（单行规则，跳注释行）+ 全文（多行规则）；命中返回 findings（match 截 80 字符） */
export function scanText(text: string): Finding[] {
  if (!text || typeof text !== 'string') return []
  const findings: Finding[] = []

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1
    if (isCommentLine(line)) continue
    for (const [pattern, type, description] of CORE) {
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.exec(line)) !== null) {
        const matched = m[0]
        if (isWhitelisted(matched)) continue
        findings.push({ type, description, match: matched.slice(0, 80), line: lineNo })
        if (m.index === pattern.lastIndex) pattern.lastIndex++ // 零宽保护
      }
    }
  }

  for (const [pattern, type, description] of MULTI_LINE) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const matched = m[0]
      if (isWhitelisted(matched)) continue
      const startLine = text.slice(0, m.index).split('\n').length // 起始行号
      const display = matched.length > 63 ? `${matched.slice(0, 60)}...` : matched
      findings.push({ type, description, match: display, line: startLine })
      if (m.index === pattern.lastIndex) pattern.lastIndex++
    }
  }
  return findings
}
