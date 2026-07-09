const frontendUrl = process.env.FRONTEND_URL
const apiUrl = process.env.API_URL

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function normalizeOrigin(value, name) {
  if (!value) {
    fail(`${name} is required`)
    return undefined
  }
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    fail(`${name} must be a valid URL`)
    return undefined
  }
}

function expectHeader(headers, name, expected) {
  const value = headers.get(name)
  if (value !== expected) {
    fail(`Expected ${name}: ${expected}; received ${value ?? '<missing>'}`)
  }
}

const frontendOrigin = normalizeOrigin(frontendUrl, 'FRONTEND_URL')
const apiOrigin = normalizeOrigin(apiUrl, 'API_URL')

if (process.exitCode) {
  process.exit()
}

const frontend = await fetch(frontendOrigin)
if (!frontend.ok) {
  fail(`Frontend returned ${frontend.status}`)
} else {
  expectHeader(frontend.headers, 'x-content-type-options', 'nosniff')
  expectHeader(frontend.headers, 'x-frame-options', 'DENY')
  const csp = frontend.headers.get('content-security-policy')
  if (!csp?.includes("frame-ancestors 'none'")) {
    fail('Frontend CSP must include frame-ancestors none')
  }
}

const health = await fetch(`${apiOrigin}/api/health`, {
  headers: { Origin: frontendOrigin },
})
if (!health.ok) {
  fail(`API health check returned ${health.status}`)
} else {
  const body = await health.json().catch(() => undefined)
  if (body?.status !== 'ok') {
    fail('API health check must return {"status":"ok"}')
  }
  expectHeader(health.headers, 'x-content-type-options', 'nosniff')
  expectHeader(health.headers, 'x-frame-options', 'DENY')
}

const cors = await fetch(`${apiOrigin}/api/agents`, {
  method: 'OPTIONS',
  headers: {
    Origin: frontendOrigin,
    'Access-Control-Request-Method': 'GET',
  },
})
if (!cors.ok) {
  fail(`API CORS preflight returned ${cors.status}`)
} else {
  expectHeader(cors.headers, 'access-control-allow-origin', frontendOrigin)
}

if (process.exitCode) {
  process.exit()
}

console.log('Live deployment check passed.')
