import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError, api } from '../src/api'

function mockLocation(pathname: string, search = '') {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { pathname, search, href: `http://localhost${pathname}${search}`, assign },
  })
  return assign
}

describe('api 401 handling', () => {
  afterEach(() => vi.restoreAllMocks())

  it('redirects to login with return_to when an API call returns 401', async () => {
    const assign = mockLocation('/app/workbenches', '?page=2')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'PERSON_SESSION_INVALID', message: 'session gone' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(api('/api/v1/workbenches')).rejects.toThrow('session gone')
    expect(assign).toHaveBeenCalledWith('/auth/login?return_to=%2Fapp%2Fworkbenches%3Fpage%3D2')
  })

  it('does not redirect on 401 when already on an /auth path', async () => {
    const assign = mockLocation('/auth/callback')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'PERSON_SESSION_INVALID', message: 'x' } }), { status: 401 }),
    )

    await expect(api('/api/v1/me')).rejects.toBeInstanceOf(ApiClientError)
    expect(assign).not.toHaveBeenCalled()
  })

  it('does not redirect on non-401 errors', async () => {
    const assign = mockLocation('/app/workbenches')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'PERMISSION_DENIED', message: 'no' } }), { status: 403 }),
    )

    await expect(api('/api/v1/x')).rejects.toBeInstanceOf(ApiClientError)
    expect(assign).not.toHaveBeenCalled()
  })
})
