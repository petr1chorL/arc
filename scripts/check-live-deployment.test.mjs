import { describe, expect, it, vi } from 'vitest'

import { checkLiveDeployment, fetchWithRetry } from './check-live-deployment.mjs'

function okResponse(body, headers = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(body),
  }
}

describe('fetchWithRetry', () => {
  it('waits through a transient startup response', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const response = await fetchWithRetry('https://arc.example.com/api/health', undefined, {
      fetchFn,
      label: 'API health check',
      maxAttempts: 3,
      retryDelayMs: 0,
    })

    expect(response.status).toBe(200)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('reports the final response after the retry limit', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 })

    await expect(fetchWithRetry('https://arc.example.com/api/health', undefined, {
      fetchFn,
      label: 'API health check',
      maxAttempts: 3,
      retryDelayMs: 0,
    })).rejects.toThrow('API health check returned 503 after 3 attempts')
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })
})

describe('checkLiveDeployment', () => {
  it('checks the Nginx health route and the API contract', async () => {
    const frontendOrigin = 'https://arc.example.com'
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(okResponse(undefined, {
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      }))
      .mockResolvedValueOnce(okResponse({ status: 'ok' }))
      .mockResolvedValueOnce(okResponse({ status: 'ok' }, {
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      }))
      .mockResolvedValueOnce(okResponse(undefined, {
        'access-control-allow-origin': frontendOrigin,
      }))

    await checkLiveDeployment({
      frontendUrl: frontendOrigin,
      apiUrl: frontendOrigin,
      fetchFn,
      maxAttempts: 1,
      retryDelayMs: 0,
    })

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      frontendOrigin,
      `${frontendOrigin}/healthz`,
      `${frontendOrigin}/api/health`,
      `${frontendOrigin}/api/agents`,
    ])
  })
})
