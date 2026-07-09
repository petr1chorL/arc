import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiUrl, readJson } from './http'

afterEach(() => {
  vi.unstubAllEnvs()
})

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

describe('apiUrl', () => {
  it('keeps relative API paths in local development', () => {
    expect(apiUrl('/api/agents')).toBe('/api/agents')
  })

  it('prefixes API paths with the configured production API origin', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://arc-one-api.example.com/')

    expect(apiUrl('/api/agents')).toBe('https://arc-one-api.example.com/api/agents')
  })
})
