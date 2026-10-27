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

  it('formats structured validation errors without object coercion', async () => {
    const response = new Response(JSON.stringify({
      detail: [{
        type: 'string_too_short',
        loc: ['body', 'password'],
        msg: 'String should have at least 12 characters',
      }],
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    })

    await expect(readJson(response)).rejects.toEqual(
      new ApiError(422, 'password：String should have at least 12 characters'),
    )
  })
})

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    document.cookie = 'arc_one_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  })

  it('uses the explicit same-origin native acceptance path without losing CSRF or request body', async () => {
    vi.stubEnv('VITE_ARC_ONE_API_BASE_PATH', '/native-api')
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime')
    document.cookie = 'arc_one_csrf=test-token; path=/'
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/auth/login?source=test', { method: 'POST', body: '{"test":true}' })
    expect(fetchMock.mock.calls[0][0]).toBe('/native-api/auth/login?source=test')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"test":true}', credentials: 'include' })
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('X-CSRF-Token')).toBe('test-token')
  })

  it.each([
    ['https://outside.example.invalid', 'runtime'],
    ['/native-api', ''],
    ['/unrecognized', 'runtime'],
  ])('rejects an invalid API entry configuration before sending (%s, %s)', async (base, mode) => {
    vi.stubEnv('VITE_ARC_ONE_API_BASE_PATH', base)
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', mode)
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch('/api/auth/login', { method: 'POST', body: 'not-for-another-host' }))
      .rejects.toEqual(new ApiError(503, 'API 入口配置无效'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps session expiry handling on the original workspace route during native acceptance', async () => {
    vi.stubEnv('VITE_ARC_ONE_API_BASE_PATH', '/native-api')
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime')
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValue(Response.json({ detail: '未登录' }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const listener = vi.fn()
    window.addEventListener('auth-session-expired', listener)
    try {
      await apiFetch('/api/auth/session')
      await apiFetch('/api/workspaces/arc-one/agents')
      await apiFetch('/api/workspaces/arc-one/workflows')
      expect(fetchMock.mock.calls[1][0]).toBe('/native-api/workspaces/arc-one/agents')
      expect(listener).toHaveBeenCalledTimes(1)
    } finally { window.removeEventListener('auth-session-expired', listener) }
  })

  it('sends credentials and CSRF header for non-GET requests', async () => {
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
      credentials: 'include',
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

  it('does not dispatch auth-session-expired for auth session 401 responses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: '未登录' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ))

    const handler = vi.fn()
    window.addEventListener('auth-session-expired', handler)

    await apiFetch('/api/health')
    await apiFetch('/api/auth/session')

    expect(handler).not.toHaveBeenCalled()

    window.removeEventListener('auth-session-expired', handler)
  })

  it('does not dispatch auth-session-expired for invitation 401 responses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: '邀请不可用' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ))

    const handler = vi.fn()
    window.addEventListener('auth-session-expired', handler)

    await apiFetch('/api/health')
    await apiFetch('/api/invitations/token')

    expect(handler).not.toHaveBeenCalled()

    window.removeEventListener('auth-session-expired', handler)
  })
})
