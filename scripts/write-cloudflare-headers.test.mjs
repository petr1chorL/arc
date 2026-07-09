import { describe, expect, it } from 'vitest'

import { renderCloudflareHeaders } from './write-cloudflare-headers.mjs'

describe('renderCloudflareHeaders', () => {
  it('tightens connect-src to the configured API origin', () => {
    const headers = renderCloudflareHeaders('https://api.example.com/v1')

    expect(headers).toContain("connect-src 'self' https://api.example.com;")
    expect(headers).not.toContain("connect-src 'self' https:;")
  })
})
