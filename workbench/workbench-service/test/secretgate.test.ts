/**
 * secretgate 移植测试（Task 21 / D5）：
 *
 * 1.0 ieidev_hud/secretgate.py 正则规则引擎移植为 sec-compliance skill 内置 mjs 脚本。
 * A1 分工：脚本零 token 扫描命中（正则规则集），LLM 做真泄露 vs 测试 fixture 的定性解读。
 *
 * 测试覆盖：
 *  ① 纯函数 scan(text) 表驱动断言每类规则命中（API Key / 私钥块 / 连接串 / 凭证 / Bearer / JWT / AWS / Slack / Stripe / Google / OpenAI）
 *  ② 不误报：普通文本零命中
 *  ③ 豁免模式：placeholder/example/changeme/${VAR}/<YOUR_KEY> 不报
 *  ④ CLI 入口冒烟：spawn node 跑临时文件断言 JSON 输出
 *  ⑤ manifest skills 恢复（sec-compliance/skills/secretgate/SKILL.md 在位 + frontmatter 过 schema）
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { builtinTemplates } from '../src/assets/templates.gen'

// secretgate.mjs 是 ESM —— 动态 import
const SECRETGATE_PATH = join(__dirname, '..', '..', 'templates', 'sec-compliance', 'skills', 'secretgate', 'scripts', 'secretgate.mjs')

type ScanHit = { rule: string; match: string; line?: number; col?: number }

async function importScan(): Promise<(text: string) => ScanHit[]> {
  const mod = await import(`file://${SECRETGATE_PATH.replace(/\\/g, '/')}`)
  if (typeof mod.scan !== 'function') {
    throw new Error('secretgate.mjs 未导出 scan 函数')
  }
  return mod.scan as (text: string) => ScanHit[]
}

describe('secretgate — ① 规则集表驱动命中', () => {
  let scan: (text: string) => ScanHit[]

  beforeAll(async () => {
    scan = await importScan()
  })

  // 表驱动：每类规则一例命中
  const cases: Array<[string, string, string | RegExp]> = [
    // [规则名关键词, 样例串, 命中 match 期望片段]
    ['OpenAI sk-', 'env OPENAI_API_KEY=sk-abc1234567890T3BlbkFJxyz1234567890', /sk-.*T3BlbkFJ/],
    ['OpenAI sk-proj-', 'key = "sk-proj-1234567890abcdefghijklmnopqrstuv1234567890abcdefghij"', /sk-proj-/],
    ['AWS AKIA', 'aws_access_key_id = AKIA1234567890ABCDEF', /AKIA/],
    ['GitHub ghp_', 'GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuv', /ghp_/],
    ['Slack xoxb-', 'SLACK_TOKEN=xoxb-1234567890-abcdefghij', /xoxb-/],
    ['Stripe sk_live_', 'pk = sk_live_1234567890abcdefghijklmnopqrstuv', /sk_live_/],
    ['Google AIza', 'GOOGLE_API_KEY=AIzaSyA1234567890abcdefghijklmnopqrstuv', /AIza/],
    ['PEM private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIabc...\n-----END RSA PRIVATE KEY-----', /BEGIN.*PRIVATE.*KEY/],
    ['postgres connection', 'DATABASE_URL=postgres://user:secretpass@localhost:5432/db', /postgres:.*:.*@/],
    ['mysql connection', 'url = "mysql://root:password123@host:3306/db"', /mysql:.*:.*@/],
    ['password=', 'db password = "hardcoded-secret-123"', /password/i],
    ['Bearer token', 'Authorization: Bearer eyJabc.def.ghi_longtoken', /Bearer\s+\S+/i],
    ['JWT', 'token = eyJabcd1234.eyJefgh5678.ijkl9012', /eyJ/],
    ['JDBC password', 'jdbc:mysql://host:3306/db?password=secret123', /password=/i],
  ]

  for (const [label, sample, expectedMatch] of cases) {
    it(`${label}: 命中 → scan 返回非空 + match 命中期望片段`, () => {
      const hits = scan(sample)
      expect(hits.length).toBeGreaterThan(0)
      const allMatches = hits.map((h) => h.match).join('|')
      expect(allMatches).toMatch(expectedMatch)
    })
  }
})

describe('secretgate — ② 不误报', () => {
  let scan: (text: string) => ScanHit[]
  beforeAll(async () => {
    scan = await importScan()
  })

  it('普通文本零命中', () => {
    const text = `# README
这是一个普通的项目文档。包含一些示例代码但不包含任何真实凭据。

\`\`\`python
def hello():
    print("Hello, World!")
\`\`\`

运行命令：npm install && npm start
`
    expect(scan(text)).toEqual([])
  })

  it('注释/示例代码零命中（含 # 与 //）', () => {
    const text = `# config.example.yaml
# database_url: postgres://user:pass@host/db  ← 这是注释，不应被扫到
// const api_key = "sk-test-1234567890abcdef"  ← JS 注释
`
    // 注释行被跳过（1.0 行为： stripped 以 # 或 // 开头即跳）
    expect(scan(text).length).toBe(0)
  })
})

describe('secretgate — ③ 豁免模式', () => {
  let scan: (text: string) => ScanHit[]
  beforeAll(async () => {
    scan = await importScan()
  })

  const exemptCases: Array<[string, string]> = [
    ['your_X_here', 'API_KEY = "your_api_key_here"'],
    ['example', 'API_KEY = "example-key-1234567890abcdef"'],
    ['placeholder', 'password = "placeholder-secret"'],
    ['changeme', 'password = "changeme-please"'],
    ['${VAR}', 'API_KEY = "${OPENAI_API_KEY}"'],
    ['<YOUR_KEY>', 'API_KEY = "<YOUR_API_KEY_HERE>"'],
  ]

  for (const [label, sample] of exemptCases) {
    it(`${label}: 豁免 → 零命中`, () => {
      // 注意：某些豁免词可能因规则正则不命中（如 example 字面不匹配 sk- 模式），scan 自然返回 0
      // 但若命中了某个泛规则（如 password=），豁免词应让 _is_whitelisted 跳过
      const hits = scan(sample)
      expect(hits).toEqual([])
    })
  }
})

describe('secretgate — ④ CLI 入口冒烟', () => {
  it('node secretgate.mjs <file> → JSON 输出含 hits', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'secretgate-cli-'))
    const tmpFile = join(tmpDir, 'leak.txt')
    writeFileSync(tmpFile, 'GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuv\n')

    const r = spawnSync('node', [SECRETGATE_PATH, tmpFile], {
      encoding: 'utf8',
      timeout: 10000,
    })

    expect(r.status).toBe(1) // 1.0 协议：有命中时 exit 1
    const out = r.stdout.trim()
    expect(out).toMatch(/^\{/) // JSON 起始
    const parsed = JSON.parse(out) as { file: string; hits: ScanHit[] }
    expect(parsed.file).toBe(tmpFile)
    expect(parsed.hits.length).toBeGreaterThan(0)
    expect(parsed.hits[0]?.match).toMatch(/ghp_/)
  })

  it('node secretgate.mjs <干净文件> → JSON hits 空数组 + exit 0', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'secretgate-clean-'))
    const tmpFile = join(tmpDir, 'clean.txt')
    writeFileSync(tmpFile, 'just a plain text file with no secrets\n')

    const r = spawnSync('node', [SECRETGATE_PATH, tmpFile], {
      encoding: 'utf8',
      timeout: 10000,
    })

    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout.trim()) as { file: string; hits: ScanHit[] }
    expect(parsed.hits).toEqual([])
  })

  it('node secretgate.mjs 无参 → usage + exit 1', () => {
    const r = spawnSync('node', [SECRETGATE_PATH], {
      encoding: 'utf8',
      timeout: 10000,
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/usage/i)
  })
})

describe('secretgate — ⑤ manifest 恢复 + SKILL.md 在位', () => {
  it('sec-compliance/manifest.yml skills 含 secretgate', () => {
    // builtinTemplates 已含 manifest（gen 已重跑）
    const text = builtinTemplates['sec-compliance/manifest.yml']
    expect(text).toContain('secretgate')
  })

  it('sec-compliance/skills/secretgate/SKILL.md 在位 + frontmatter 过 schema', async () => {
    const skillMd = builtinTemplates['sec-compliance/skills/secretgate/SKILL.md']
    expect(skillMd).toBeDefined()
    expect(skillMd).toMatch(/^---/)
    expect(skillMd).toContain('name: secretgate')
    expect(skillMd.length).toBeGreaterThan(100) // 有正文
  })

  it('sec-compliance/skills/secretgate/scripts/secretgate.mjs 在位', () => {
    const mjs = builtinTemplates['sec-compliance/skills/secretgate/scripts/secretgate.mjs']
    expect(mjs).toBeDefined()
    expect(mjs).toContain('export function scan')
    expect(mjs).toContain('export') // ESM 导出
  })
})
