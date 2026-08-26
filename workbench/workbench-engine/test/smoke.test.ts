import { describe, expect, it } from 'vitest'

/**
 * 空壳冒烟（I0-5 T5）：L3 编排引擎线落地前的骨架保险——
 * 入口模块可导入、导出面存在即可；逻辑测试随 L3 线（契约见路线图 §3.3）填充。
 */
import * as engine from '../src/index'

describe('@devzero/engine 空壳入口', () => {
  it('入口模块可导入且导出 ENGINE_VERSION 常量', () => {
    expect(engine.ENGINE_VERSION).toBe('0.0.1')
  })
})
