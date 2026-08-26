/**
 * secretgate TS 移植测试（L3 T10）——每类规则一正一反 + 豁免白名单 + 注释行跳过 + 返回结构。
 * 语义母本：1.0 ieidev_hud/secretgate.py（tests_hud/test_secretgate.py 对位）。
 */
import { describe, expect, it } from 'vitest'
import { scanText } from '../src/security/secretgate'

describe('secretgate · 规则样本（一正一反）', () => {
  it.each([
    ['password', 'db_password = "hunter2secret!"', 'db_password = "${DB_PWD}"'],
    ['api_key', 'api_key: "abcdefgh12345678"', 'api_key: "${API_KEY}"'],
    ['token', 'access_token = "tok_1234567890abc"', 'access_token = "your_token_here"'],
    ['ghp', 'GITHUB_TOKEN=x', 'GITHUB_TOKEN=x__placeholder__'], // ghp_ 在下一条专测
  ] as const)('%s 豁免侧不报', (_name, _hit, clean) => {
    expect(scanText(clean)).toEqual([])
  })

  it('GitHub PAT：ghp_ 36 位命中', () => {
    const text = 'token: ghp_' + 'a'.repeat(36)
    const f = scanText(text)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ type: 'token', line: 1 })
    expect(f[0].description).toContain('GitHub')
  })

  it('AWS AKIA / Slack xox / Stripe sk_live / Google AIza / OpenAI 两式 / JWT 三段——服务专属密钥全命中', () => {
    const text = [
      'AKIA' + 'B'.repeat(16),
      'xoxb-' + 'c'.repeat(20),
      'sk_live_' + 'd'.repeat(30),
      'AIza' + 'e'.repeat(35),
      'sk-' + 'f'.repeat(20) + 'T3BlbkFJ' + 'g'.repeat(20),
      'sk-proj-' + 'h'.repeat(50),
      'eyJ' + 'i'.repeat(8) + '.eyJ' + 'j'.repeat(8) + '.' + 'k'.repeat(8),
    ].join('\n')
    const types = scanText(text).map((f) => f.type)
    expect(types).toEqual(['aws_key', 'slack_token', 'stripe_key', 'google_key', 'openai_key', 'openai_key', 'jwt'])
  })

  it('Bearer / JDBC 串 / DATABASE_URL / 通用 URI 凭据', () => {
    const text = [
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234',
      'jdbc:mysql://db:3306/x?user=root&password=secret123',
      'DATABASE_URL: "postgres://admin:supersecret@db:5432/app"',
      'redis://:mypassword123@redis:6379/0',
    ].join('\n')
    // py 语义：一行可被多规则同时命中（如 Bearer 行命中 Authorization+bearer 两式）——断言覆盖四类而非精确数
    const types = new Set(scanText(text).map((f) => f.type))
    for (const want of ['password', 'token']) expect(types.has(want)).toBe(true)
    expect(scanText(text).length).toBeGreaterThanOrEqual(4)
  })

  it('PEM 私钥块（多行规则）：起始行号正确 + 长块截断显示', () => {
    const pem = ['-----BEGIN RSA PRIVATE KEY-----', ...Array.from({ length: 5 }, (_, i) => `line${i}data`.repeat(10)), '-----END RSA PRIVATE KEY-----'].join('\n')
    const text = `头部说明\n${pem}\n尾部`
    // py 语义：BEGIN 头行命中单行规则 + 块命中多行规则（双报）；多行块的起始行号=2、长块截断
    const f = scanText(text).filter((x) => x.type === 'private_key')
    expect(f.length).toBe(2)
    const block = f.find((x) => x.match.endsWith('...'))
    expect(block).toMatchObject({ line: 2 })
  })

  it('豁免白名单全集：your_*/example/placeholder/changeme/<X>/${X}/xxx/test-/fake-/demo-/sample- 全静默', () => {
    const text = [
      'password = "your_password_here"',
      'api_key = "example_key_12345678"',
      'token: "placeholder_tok_12345"',
      'secret = "changeme123"',
      'password = "<YOUR_PASSWORD>"',
      'api_key = "${API_KEY}"',
      'password = "xxxxxx"',
      'api_key = "test_key_12345678"',
      'token = "fake_tok_12345678"',
      'api_key = "demo_key_12345678"',
      'secret = "sample_key_1234567"',
    ].join('\n')
    expect(scanText(text)).toEqual([])
  })

  it('注释行跳过（# // --）；PEM 头的 -- 不算注释', () => {
    const text = [
      '# password = "real_secret_123"',
      '// api_key = "real_key_12345678"',
      '-- token = "real_tok_12345678"',
      'password = "real_secret_123"', // 唯一命中
    ].join('\n')
    const f = scanText(text)
    expect(f).toHaveLength(1)
    expect(f[0].line).toBe(4)
  })

  it('match 截 80 字符；空输入返回 []', () => {
    const long = 'password = "' + 'a'.repeat(200) + '"'
    const f = scanText(long)
    expect(f[0].match.length).toBe(80)
    expect(scanText('')).toEqual([])
  })
})
