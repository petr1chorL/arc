import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, readJson } from './http'

describe('readJson', () => {
  it('returns a stable message when the server error is not JSON', async () => {
    const response = new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    })

    await expect(readJson(response)).rejects.toEqual(
      new ApiError(500, '服务暂时不可用，请稍后重试'),
    )
  })
})

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.cookie = 'arc_one_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  })

  it('sends same-origin credentials and CSRF header for non-GET requests', async () => {
    document.cookie = 'arc_one_csrf=test-token; path=/'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/auth/logout', { method: 'POST' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    })
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('test-token')
  })

  it('dispatches one auth-session-expired event for protected 401 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: '未登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const handler = vi.fn()
    window.addEventListener('auth-session-expired', handler)

    await apiFetch('/api/workspaces/workspace-a/agents')
    await apiFetch('/api/workspaces/workspace-a/workflows')

    expect(handler).toHaveBeenCalledTimes(1)

    window.removeEventListener('auth-session-expired', handler)
  })
})
