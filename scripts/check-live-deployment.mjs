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

export async function checkLiveDeployment({
  frontendUrl,
  apiUrl,
  fetchFn = fetch,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  const frontendOrigin = normalizeOrigin(frontendUrl, 'FRONTEND_URL')
  const apiOrigin = normalizeOrigin(apiUrl, 'API_URL')
  const retryOptions = { fetchFn, maxAttempts, retryDelayMs }

  const frontend = await fetchWithRetry(frontendOrigin, undefined, {
    ...retryOptions,
    label: 'Frontend',
  })
  expectHeader(frontend.headers, 'x-content-type-options', 'nosniff')
  expectHeader(frontend.headers, 'x-frame-options', 'DENY')
  const csp = frontend.headers.get('content-security-policy')
  if (!csp?.includes("frame-ancestors 'none'")) {
    throw new Error('Frontend CSP must include frame-ancestors none')
  }

  const gatewayHealth = await fetchWithRetry(`${frontendOrigin}/healthz`, undefined, {
    ...retryOptions,
    label: 'Gateway health check',
  })
  const gatewayBody = await gatewayHealth.json().catch(() => undefined)
  if (gatewayBody?.status !== 'ok') {
    throw new Error('Gateway health check must return {"status":"ok"}')
  }

  const health = await fetchWithRetry(`${apiOrigin}/api/health`, {
    headers: { Origin: frontendOrigin },
  }, {
    ...retryOptions,
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
    ...retryOptions,
    label: 'API CORS preflight',
  })
  expectHeader(cors.headers, 'access-control-allow-origin', frontendOrigin)

  console.log('Live deployment check passed.')
}

async function main() {
  await checkLiveDeployment({
    frontendUrl: process.env.FRONTEND_URL,
    apiUrl: process.env.API_URL,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
