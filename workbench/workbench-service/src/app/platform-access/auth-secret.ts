/**
 * A-06 加密密钥：首启随机生成、单独落盘（auth/state.key，0600）。
 * demo 的 WORKBENCH_STATE_SECRET 环境变量默认值绝不带入——密钥只此一处来源（设计 §5.2）。
 * 已有文件但损坏（<32 字符）→ 重新生成：旧密文随之不可解，走「删状态文件重新接入」恢复路径（设计 §6）。
 * 同步实现（控制端裁决 2026-08-27）：Task 14（service 装配）须同步拿到密钥，加载从源头即同步；
 * 原子写沿用 runtime/contracts.ts atomicWrite 模式（同目录临时文件 + rename）。
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const KEY_FILE = 'state.key'

/** 原子写：先写同目录临时文件，再 rename 覆盖目标（镜像 runtime/contracts.ts atomicWrite） */
function atomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`
  writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmpPath, filePath)
}

export function loadOrCreateAuthSecret(authDir: string): string {
  const path = join(authDir, KEY_FILE)
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim()
    if (existing.length >= 32) return existing
    // 损坏（<32 字符）→ 落到下方重新生成分支
  }

  const secret = randomBytes(32).toString('base64url') // 43 字符
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  atomicWrite(path, secret)
  return secret
}
