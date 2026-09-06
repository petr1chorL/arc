import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeApiDeployment, isNativeDeploymentEnabled } from '../netlify/functions/_shared/native/deployment.ts'
import { createNativeApiRouter } from '../netlify/functions/_shared/native/router.ts'
import { digestToken } from '../netlify/functions/_shared/identity-workspace/security.ts'

test('native deployment is opt-in and disabled mode does not initialize dependencies', async () => {
  for (const mode of [undefined, '', 'off', 'native', 'Runtime', ' runtime ', 'reference-assets']) {
    let loads = 0
    const handler = createNativeApiDeployment({ mode, loadPool: () => { loads++; throw Error('must not load dependencies') } })
    const result = await handler(new Request('https://app.example.invalid/api/auth/session'), {})
    assert.equal(isNativeDeploymentEnabled(mode), false)
    assert.equal(result.status, 404)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.equal(loads, 0)
  }
  assert.equal(isNativeDeploymentEnabled('runtime'), true)
})

test('enabled composition reaches authentication in identity and all nine existing business domains', async () => {
  const statements = []
  const pool = { connect: async () => ({ query: async sql => { statements.push(sql); return { rows: sql.includes('RETURNING count') ? [{ count: 1 }] : [], rowCount: 0 } }, release() {} }) }
  const handler = createNativeApiDeployment({ mode: 'runtime', loadPool: () => pool })
  const paths = ['/api/auth/session', ...[
    'model-providers', 'agents', 'data-objects', 'evaluations/rubrics', 'feedback-candidates', 'workflows',
    'operations', 'human-tasks', 'notification-channels',
  ].map(path => `/api/workspaces/synthetic/${path}`)]
  for (const path of paths) {
    const result = await handler(new Request(`https://app.example.invalid${path}`), {})
    assert.equal(result.status, 401, path)
  }
  assert.ok(statements.length > 0)
})

test('composition rejects unknown, fixture-control and malformed paths without a database connection', async () => {
  let connects = 0
  const router = createNativeApiRouter({ connect: async () => { connects++; throw Error('must not connect') } }, {})
  for (const [path, status] of [['/__tick', 404], ['/__shutdown', 404], ['/__ready', 404],
    ['/api/workspaces/synthetic/unknown', 404], ['/api/workspaces/%ZZ', 400]]) {
    const result = await router(new Request(`https://app.example.invalid${path}`))
    assert.equal(result.status, status, path)
    assert.equal(result.headers.get('cache-control'), 'no-store')
  }
  assert.equal(connects, 0)
})

test('composition preserves origin rejection across write domains before touching the database', async () => {
  const router = createNativeApiRouter({ connect: async () => { throw Error('must not connect') } }, {})
  const paths = ['/api/auth/login', ...[
    'model-providers', 'agents', 'data-objects', 'evaluations/rubrics', 'feedback-candidates/id/confirm',
    'workflows', 'workflows/id/runs', 'human-tasks/id/claim', 'notification-channels',
  ].map(path => `/api/workspaces/synthetic/${path}`)]
  for (const path of paths) {
    const result = await router(new Request(`https://app.example.invalid${path}`, { method: 'POST', headers: { Origin: 'https://foreign.example.invalid' }, body: '{}' }))
    assert.equal(result.status, 403, path)
    assert.equal((await result.json()).detail, 'Origin 校验失败')
  }
})

test('host options are per-request and client-supplied forwarding headers cannot override rate-limit identity', async () => {
  const keys = []
  const pool = { connect: async () => ({ query: async (sql, values) => {
    if (sql.includes('RETURNING count')) { keys.push(values[0]); return { rows: [{ count: 1 }], rowCount: 1 } }
    return { rows: [], rowCount: 0 }
  }, release() {} }) }
  const handler = createNativeApiDeployment({ mode: 'runtime', loadPool: () => pool })
  for (const clientAddress of ['192.0.2.10', '192.0.2.11']) {
    const result = await handler(new Request('https://app.example.invalid/api/workspaces/synthetic/agents', {
      method: 'POST', headers: { Origin: 'https://allowed.example.invalid', 'X-Forwarded-For': '192.0.2.99', 'X-Arc-Test-Client': '99' }, body: '{}',
    }), { clientAddress, allowedOrigins: ['https://allowed.example.invalid/'] })
    assert.equal(result.status, 401)
    assert.equal(keys.at(-1), `request:client:${await digestToken(clientAddress)}`)
  }
  assert.notEqual(keys[0], keys[1])
})

test('dependency initialization failures remain retryable and do not expose exception contents', async () => {
  let attempts = 0
  const handler = createNativeApiDeployment({ mode: 'runtime', loadPool: () => { attempts++; throw Error('SYNTHETIC_PRIVATE_DETAIL') } })
  for (let i = 0; i < 2; i++) {
    const result = await handler(new Request('https://app.example.invalid/api/auth/session'), {})
    assert.equal(result.status, 503)
    assert.deepEqual(await result.json(), { detail: '服务暂时不可用' })
    assert.equal(result.headers.get('cache-control'), 'no-store')
  }
  assert.equal(attempts, 2)
})
