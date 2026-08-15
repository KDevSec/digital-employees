import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PublicHome from '../src/features/public/PublicHome.vue'


describe('PublicHome', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders package metadata returned by the public endpoint without requiring a session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'package-1',
            version: '1.0.0',
            os: 'linux',
            arch: 'x64',
            file_name: 'workbench.bin',
            size_bytes: 1024,
            sha256: 'a'.repeat(64),
            signature_status: 'VALID',
            status: 'PUBLISHED',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const wrapper = mount(PublicHome)
    await flushPromises()

    expect(wrapper.text()).toContain('Linux')
    expect(wrapper.text()).toContain('1.0.0')
    expect(wrapper.text()).toContain('x64')
    expect(wrapper.get('a[download]').attributes('href')).toBe(
      '/api/v1/public/workbench-packages/package-1/download',
    )
  })
})
