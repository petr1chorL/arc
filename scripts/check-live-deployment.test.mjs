import { describe, expect, it, vi } from 'vitest'

import { fetchWithRetry } from './check-live-deployment.mjs'

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
