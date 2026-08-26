// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { resolveRuntimeMode } from '../src/composables/use-kanban-runtime'

/**
 * 运行时挑选（L5 看板线 T9，设计 §6.5）：dev 默认 fixture 演出（引擎线未通时的看板开发
 * 主场景）；?live=1 强制真实；?fixture=1 显式 fixture；生产 build 一律真实（fixture 模块
 * 动态 import 隔离，不进 bundle——D-kb04）。
 */

describe('resolveRuntimeMode（三态挑选矩阵）', () => {
  it('无参数：dev → fixture / 生产 → live', () => {
    expect(resolveRuntimeMode('', true)).toBe('fixture')
    expect(resolveRuntimeMode('', false)).toBe('live')
  })

  it('?live=1：dev 下也强制真实', () => {
    expect(resolveRuntimeMode('?live=1', true)).toBe('live')
  })

  it('?fixture=1：显式 fixture（生产显式要求也可演出——演示场景）', () => {
    expect(resolveRuntimeMode('?fixture=1', false)).toBe('fixture')
  })

  it('live 与 fixture 同在：live 优先', () => {
    expect(resolveRuntimeMode('?fixture=1&live=1', false)).toBe('live')
  })

  it('无关参数不干扰', () => {
    expect(resolveRuntimeMode('?foo=bar', true)).toBe('fixture')
  })
})
