import { describe, expect, it } from 'vitest'

import { renderCloudflareHeaders } from './write-cloudflare-headers.mjs'

describe('renderCloudflareHeaders', () => {
  it('uses same-origin connect-src when API base URL is not configured', () => {
    const headers = renderCloudflareHeaders()

    expect(headers).toContain("connect-src 'self';")
  })

  it('tightens connect-src to the configured API origin', () => {
    const headers = renderCloudflareHeaders('https://api.example.com/v1')

    expect(headers).toContain("connect-src 'self' https://api.example.com;")
    expect(headers).not.toContain("connect-src 'self' https:;")
  })

  it('allows the configured web font stylesheet and font files', () => {
    const headers = renderCloudflareHeaders('https://api.example.com')

    expect(headers).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;")
    expect(headers).toContain("font-src 'self' data: https://fonts.gstatic.com;")
  })
})
