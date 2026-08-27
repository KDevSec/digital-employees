import { profile } from '../../../src/adapters/claude-code/profile'
import { describe, expect, it } from 'vitest'

describe('claude-code profile', () => {
  it('Windows 版本基线分档：version_min >= 2.1.226（M2 实测 2.1.226，原 2.1.245 误伤）', () => {
    expect(profile.version_min).toBe('2.1.226')
    expect(profile.version_tested).toBe('2.1.226')
  })
})
