import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export function renderCloudflareHeaders(apiBaseUrl = '') {
  const connectSource = resolveApiOrigin(apiBaseUrl) ?? 'https:'

  return `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ${connectSource}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
`
}

function resolveApiOrigin(apiBaseUrl) {
  if (!apiBaseUrl) {
    return undefined
  }
  try {
    return new URL(apiBaseUrl).origin
  } catch {
    return undefined
  }
}

function writeCloudflareHeaders() {
  const outputPath = process.argv[2] ?? 'dist/_headers'
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, renderCloudflareHeaders(process.env.VITE_API_BASE_URL), 'utf8')
  console.log(`Wrote Cloudflare headers to ${outputPath}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeCloudflareHeaders()
}
