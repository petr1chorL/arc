import { describe, expect, it, vi } from 'vitest'

import { createSchemaRehearsalHandler } from '../netlify/functions/_shared/schema-rehearsal.ts'


describe('Netlify schema rehearsal handler', () => {
  it('fails closed outside a Deploy Preview', async () => {
    const loadReport = vi.fn()
    const handler = createSchemaRehearsalHandler(loadReport)

    const response = await handler(
      new Request('https://example.test/.netlify/functions/schema-rehearsal-status'),
      { deploy: { context: 'production' } },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ status: 'not-found' })
    expect(loadReport).not.toHaveBeenCalled()
  })
})
