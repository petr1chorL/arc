import { describe, expect, it, vi } from 'vitest'

import { createPlatformHealthHandler } from '../netlify/functions/_shared/platform-health.ts'

describe('Netlify platform health function', () => {
  it('reports the database as ready after a successful query', async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined)
    const handler = createPlatformHealthHandler(checkDatabase)

    const response = await handler(new Request('https://preview.example/.netlify/functions/platform-health'))

    expect(checkDatabase).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      database: 'ready',
    })
  })

  it('fails closed without exposing the database error', async () => {
    const checkDatabase = vi.fn().mockRejectedValue(new Error('secret connection detail'))
    const handler = createPlatformHealthHandler(checkDatabase)

    const response = await handler(new Request('https://preview.example/.netlify/functions/platform-health'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      status: 'unavailable',
      database: 'unavailable',
    })
  })
})
