import { pathToFileURL } from 'node:url'

const DEFAULT_MAX_ATTEMPTS = 12
const DEFAULT_RETRY_DELAY_MS = 5_000

function normalizeOrigin(value, name) {
  if (!value) {
    throw new Error(`${name} is required`)
  }
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
}

function expectHeader(headers, name, expected) {
  const value = headers.get(name)
  if (value !== expected) {
    throw new Error(`Expected ${name}: ${expected}; received ${value ?? '<missing>'}`)
  }
}

function wait(delayMs) {
  return delayMs > 0
    ? new Promise((resolve) => setTimeout(resolve, delayMs))
    : Promise.resolve()
}

export async function fetchWithRetry(url, init, {
  fetchFn = fetch,
  label = 'Request',
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer')
  }

  let lastError
  let lastStatus
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchFn(url, init)
      if (response.ok) return response
      lastStatus = response.status
      lastError = undefined
    } catch (error) {
      lastError = error
      lastStatus = undefined
    }

    if (attempt < maxAttempts) {
      console.log(`${label} is not ready (${attempt}/${maxAttempts}); retrying...`)
      await wait(retryDelayMs)
    }
  }

  if (lastStatus !== undefined) {
    throw new Error(`${label} returned ${lastStatus} after ${maxAttempts} attempts`)
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`${label} failed after ${maxAttempts} attempts: ${detail}`)
}

async function main() {
  const frontendOrigin = normalizeOrigin(process.env.FRONTEND_URL, 'FRONTEND_URL')
  const apiOrigin = normalizeOrigin(process.env.API_URL, 'API_URL')

  const frontend = await fetchWithRetry(frontendOrigin, undefined, {
    label: 'Frontend',
  })
  expectHeader(frontend.headers, 'x-content-type-options', 'nosniff')
  expectHeader(frontend.headers, 'x-frame-options', 'DENY')
  const csp = frontend.headers.get('content-security-policy')
  if (!csp?.includes("frame-ancestors 'none'")) {
    throw new Error('Frontend CSP must include frame-ancestors none')
  }

  const health = await fetchWithRetry(`${apiOrigin}/api/health`, {
    headers: { Origin: frontendOrigin },
  }, {
    label: 'API health check',
  })
  const body = await health.json().catch(() => undefined)
  if (body?.status !== 'ok') {
    throw new Error('API health check must return {"status":"ok"}')
  }
  expectHeader(health.headers, 'x-content-type-options', 'nosniff')
  expectHeader(health.headers, 'x-frame-options', 'DENY')

  const cors = await fetchWithRetry(`${apiOrigin}/api/agents`, {
    method: 'OPTIONS',
    headers: {
      Origin: frontendOrigin,
      'Access-Control-Request-Method': 'GET',
    },
  }, {
    label: 'API CORS preflight',
  })
  expectHeader(cors.headers, 'access-control-allow-origin', frontendOrigin)

  console.log('Live deployment check passed.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
