import { describe, expect, it } from 'vitest'
import { ApiError, readJson } from './http'

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
