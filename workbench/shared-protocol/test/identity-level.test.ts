import { describe, it, expect } from 'vitest'
import { employeeId, parseOrg } from '../src/identity'
import { deriveLevel } from '../src/level'

describe('identity/level', () => {
  it('employeeId 拼装与 parseOrg 往返', () => {
    expect(employeeId('dev-engineer', 'local')).toBe('dev-engineer@local')
    expect(parseOrg('dev-engineer@local')).toBe('local')
  })
  it('deriveLevel：裸用→L0；+方法论|+流程→L1；+编排→L2', () => {
    expect(deriveLevel(['裸用'])).toBe('L0')
    expect(deriveLevel(['裸用', '+方法论'])).toBe('L1')
    expect(deriveLevel(['裸用', '+流程'])).toBe('L1')
    expect(deriveLevel(['裸用', '+编排'])).toBe('L2')
  })
})
