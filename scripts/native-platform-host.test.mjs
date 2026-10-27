import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitializedRuntimePool, createNativePlatformHost, normalizeNativeRequest } from '../netlify/functions/_shared/native/platform-host.ts'

test('all platform entrypoints are closed before accessing dependency getters', async () => {
  for (const mode of [undefined, '', 'off', 'Runtime', ' runtime ']) {
    const reads = []
    const host = createNativePlatformHost({
      readEnv: name => { reads.push(name); assert.equal(name, 'ARC_NATIVE_MODE'); return mode },
      get loadPool() { throw Error('must not access pool') },
      get initializeIdentity() { throw Error('must not access initializer') },
      get createSender() { throw Error('must not access sender') },
    })
    const request = new Request('https://synthetic.invalid/native-api/auth/session')
    for (const response of [await host.api(request, { ip: '192.0.2.1' }), await host.workload(request, {}), await host.scheduled()]) {
      assert.equal(response.status, 404)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    assert.deepEqual(reads, ['ARC_NATIVE_MODE', 'ARC_NATIVE_MODE', 'ARC_NATIVE_MODE'])
  }
})

test('normalization retains the original request stream and security headers', async () => {
  const request = new Request('https://synthetic.invalid/native-api/auth/login?next=%2Fw', { method: 'POST',
    headers: { Origin: 'https://synthetic.invalid', Cookie: 'synthetic=1', 'X-CSRF-Token': 'synthetic', 'Content-Type': 'application/json' }, body: '{"synthetic":true}' })
  const normalized = normalizeNativeRequest(request)
  assert.equal(normalized.url, 'https://synthetic.invalid/api/auth/login?next=%2Fw')
  assert.equal(normalized.method, 'POST'); assert.deepEqual([...normalized.headers], [...request.headers])
  assert.equal(await normalized.text(), '{"synthetic":true}')
  const unrelated = new Request('https://synthetic.invalid/foo/native-api/test')
  assert.equal(normalizeNativeRequest(unrelated), unrelated)
})

test('runtime mode without a fresh identity marker cannot reach old API data or scheduled work', async () => {
  const statements = [], reads = []
  let releases = 0, sends = 0
  const host = createNativePlatformHost({ readEnv: name => {
    reads.push(name)
    if (name === 'ARC_NATIVE_MODE') return 'runtime'
    if (name === 'ARC_INITIAL_ADMIN_EMAIL' || name === 'ARC_INITIAL_ADMIN_PASSWORD') throw Error('must not read bootstrap secrets')
  }, loadPool: () => ({ connect: async () => ({ query: async sql => {
    statements.push(sql)
    return { rows: sql.includes('RETURNING count') ? [{ count: 1 }] : [], rowCount: 0 }
  }, release() { releases++ } }) }), initializeIdentity: async (_pool, options) => { assert.equal(options.enabled, false) },
  createSender: () => { sends++; throw Error('must not send') },
  })
  for (const response of [await host.api(new Request('https://synthetic.invalid/native-api/auth/session'), { ip: '192.0.2.1' }), await host.scheduled()]) {
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { detail: '服务暂时不可用' })
  }
  assert.deepEqual(statements, ["SELECT id FROM native_bootstrap_state WHERE id='arc-one'", "SELECT id FROM native_bootstrap_state WHERE id='arc-one'"])
  assert.equal(releases, 2); assert.equal(sends, 0)
  assert.equal(reads.includes('ARC_INITIAL_ADMIN_PASSWORD'), false)
})

test('authenticated consumer storage port remains lazy and never lends business access without the marker', async () => {
  let loads = 0, connections = 0, released = 0
  const queries = []
  const pool = createInitializedRuntimePool(() => {
    loads++
    return { connect: async () => {
      connections++
      return { query: async sql => { queries.push(sql); return { rows: [], rowCount: 0 } }, release: () => { released++ } }
    } }
  })
  assert.equal(loads, 0)
  await assert.rejects(pool.connect(), /^Error: 运行存储暂时不可用$/)
  await assert.rejects(pool.connect(), /^Error: 运行存储暂时不可用$/)
  assert.equal(loads, 1); assert.equal(connections, 1); assert.equal(released, 1)
  assert.deepEqual(queries, ["SELECT id FROM native_bootstrap_state WHERE id='arc-one'"])
})

test('configuration and initialization failures are sanitized and the next request can recover', async () => {
  let config = '{', bootstrapFails = true, pools = 0, secretReads = 0
  const host = createNativePlatformHost({ readEnv: name => {
    if (name === 'ARC_NATIVE_MODE') return 'runtime'
    if (name === 'ARC_NATIVE_RUNTIME_CONFIG') return config
    if (name === 'ARC_FRESH_START') return 'enabled'
    if (name === 'ARC_INITIAL_ADMIN_EMAIL') return 'synthetic@example.invalid'
    if (name === 'ARC_INITIAL_ADMIN_PASSWORD') { secretReads++; return 'SYNTHETIC_PRIVATE_PASSWORD' }
  }, loadPool: () => { pools++; return { connect: async () => ({ query: async sql => ({ rows: sql.includes('native_bootstrap_state') ? [{ id: 'arc-one' }] : sql.includes('RETURNING count') ? [{ count: 1 }] : [], rowCount: 0 }), release() {} }) } },
  initializeIdentity: async (_pool, options) => {
    assert.equal(options.enabled, true)
    if (bootstrapFails) { options.loadConfig(); throw Error('SYNTHETIC_PRIVATE_PASSWORD') }
  } })
  const call = () => host.api(new Request('https://synthetic.invalid/native-api/auth/session'), { ip: '192.0.2.1' })
  assert.equal((await call()).status, 503); assert.equal(pools, 0); assert.equal(secretReads, 0)
  config = '{"bindings":[]}'
  const failed = await call(); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { detail: '服务暂时不可用' })
  assert.equal(secretReads, 1)
  bootstrapFails = false
  assert.equal((await call()).status, 401); assert.equal(secretReads, 1)
})

test('enabled workload uses SDK authentication before pool initialization or event sends', async () => {
  let pools = 0, sends = 0
  const host = createNativePlatformHost({ readEnv: name => name === 'ARC_NATIVE_MODE' ? 'runtime' : undefined,
    loadPool: () => { pools++; throw Error('must not initialize DB') },
    initializeIdentity: () => { throw Error('workload does not bootstrap') },
    createSender: () => { sends++; throw Error('must not create SDK sender') },
  })
  const response = await host.workload(new Request('https://synthetic.invalid/.netlify/functions/runtime-workload-background', {
    method: 'POST', body: JSON.stringify([{ eventName: 'arc-one:runtime', data: { operationId: '00000000-0000-4000-8000-000000000001' } }]),
  }), {})
  assert.equal(response.status, 400)
  assert.equal(response.headers.get('x-awl-reason'), 'missing valid api key')
  assert.equal(pools, 0); assert.equal(sends, 0)
})

test('scheduled host uses bounded tick and emits only stored Operation identities', async () => {
  let sends = 0, pools = 0
  const id = '00000000-0000-4000-8000-000000000001', statements = []
  const host = createNativePlatformHost({ readEnv: name => name === 'ARC_NATIVE_MODE' ? 'runtime' : undefined,
    loadPool: () => { pools++; return { connect: async () => ({ query: async (sql, values) => {
      statements.push({ sql, values })
      return { rows: sql.includes('native_bootstrap_state') ? [{ id: 'arc-one' }] : sql.includes('SELECT id,operation_id FROM runtime_event_outbox') ? [{ id: 'wake', operation_id: id }] : [], rowCount: 0 }
    }, release() {} }) } }, initializeIdentity: () => { throw Error('tick must not bootstrap') },
    createSender: () => async operationId => { sends++; assert.equal(operationId, id); return { sendStatus: 'succeeded', eventId: 'synthetic' } },
  })
  const response = await host.scheduled()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { schedules: 0, slaMilestones: 0, notificationWorkspaces: 0, considered: 1, sent: 1 })
  assert.equal(pools, 1); assert.equal(sends, 1)
  assert.ok(statements.some(s => s.sql.includes('LIMIT $1') && s.values?.[0] === 20))
})

test('enabled API normalizes only the native prefix and preserves request security and trusted IP', async () => {
  const statements = [], reads = []
  const pool = { connect: async () => ({ query: async (sql, values) => {
    statements.push({ sql, values })
    return { rows: sql.includes('native_bootstrap_state') ? [{ id: 'arc-one' }] : sql.includes('RETURNING count') ? [{ count: 1 }] : [], rowCount: 0 }
  }, release() {} }) }
  let initialized = 0
  const host = createNativePlatformHost({ readEnv: name => { reads.push(name); return name === 'ARC_NATIVE_MODE' ? 'runtime' : undefined },
    loadPool: () => pool, initializeIdentity: async (received, options) => {
      initialized++; assert.equal(received, pool); assert.equal(options.enabled, false)
    }, createSender: () => { throw Error('API must not create sender') },
  })
  for (const prefix of ['/api', '/native-api']) {
    const response = await host.api(new Request(`https://synthetic.invalid${prefix}/auth/session`, {
      headers: { 'X-Forwarded-For': '192.0.2.99' },
    }), { ip: '192.0.2.21' })
    assert.equal(response.status, 401)
  }
  const { digestToken } = await import('../netlify/functions/_shared/identity-workspace/security.ts')
  const values = JSON.stringify(statements.map(s => s.values))
  assert.ok(values.includes(await digestToken('192.0.2.21')))
  assert.ok(!values.includes(await digestToken('192.0.2.99')))
  assert.equal(initialized, 2)
  assert.equal(reads.includes('ARC_INITIAL_ADMIN_PASSWORD'), false)
  const denied = await host.api(new Request('https://synthetic.invalid/native-api/auth/login', {
    method: 'POST', headers: { Origin: 'https://other.invalid' }, body: JSON.stringify({ email: 'a', password: 'b' }),
  }), { ip: '192.0.2.22' })
  assert.equal(denied.status, 403)
  const invalidBody = await host.api(new Request('https://synthetic.invalid/native-api/auth/login', {
    method: 'POST', headers: { Origin: 'https://synthetic.invalid' }, body: '{',
  }), { ip: '192.0.2.22' })
  assert.equal(invalidBody.status, 422)
  const missing = await host.api(new Request('https://synthetic.invalid/native-api-extra/auth/session'), { ip: '192.0.2.22' })
  assert.equal(missing.status, 404)
})

test('public entry configuration exposes candidate API and SDK event subscription while default remains closed', async () => {
  const reads = []
  Object.defineProperty(globalThis, 'Netlify', { configurable: true, value: { env: { get: name => {
    reads.push(name); assert.equal(name, 'ARC_NATIVE_MODE'); return undefined
  } } } })
  try {
    const api = await import('../netlify/functions/runtime.mts')
    const worker = await import('../netlify/functions/runtime-workload-background.mts')
    const scheduled = await import('../netlify/functions/runtime-scheduled.mts')
    assert.deepEqual(reads, [])
    assert.deepEqual(api.config.path, ['/native-api/*'])
    assert.deepEqual(worker.asyncWorkloadConfig.events, ['arc-one:runtime'])
    assert.equal(worker.config.background, true)
    assert.equal(scheduled.config.schedule, '* * * * *')
    for (const entry of [api, worker, scheduled]) {
      assert.equal((await entry.default(new Request('https://synthetic.invalid/native-api/auth/session'), { ip: '192.0.2.1' })).status, 404)
    }
    assert.deepEqual(reads, ['ARC_NATIVE_MODE', 'ARC_NATIVE_MODE', 'ARC_NATIVE_MODE'])
  } finally { delete globalThis.Netlify }
})

test('SDK sender uses fixed event name and ID-only data and preserves failed acknowledgements', async () => {
  const { createOperationSender } = await import('../netlify/functions/_shared/native/platform-netlify.ts')
  const calls = [], id = '00000000-0000-4000-8000-000000000001'
  const send = createOperationSender({ send: async (...args) => { calls.push(args); return { sendStatus: 'failed', eventId: 'synthetic' } } })
  assert.deepEqual(await send(id), { sendStatus: 'failed', eventId: 'synthetic' })
  assert.deepEqual(calls, [['arc-one:runtime', { data: { operationId: id } }]])
})

test('scheduled storage failures are sanitized and sender rejection cannot acknowledge the outbox', async () => {
  let failStorage = true
  const updates = []
  const host = createNativePlatformHost({ readEnv: name => name === 'ARC_NATIVE_MODE' ? 'runtime' : undefined,
    loadPool: () => ({ connect: async () => {
      if (failStorage) throw Error('SYNTHETIC_PRIVATE_DATABASE_ADDRESS')
      return { query: async (sql, values) => {
        if (sql.includes('UPDATE runtime_event_outbox SET attempts')) updates.push(values)
        return { rows: sql.includes('native_bootstrap_state') ? [{ id: 'arc-one' }] : sql.includes('SELECT id,operation_id FROM runtime_event_outbox') ? [{ id: 'wake', operation_id: '00000000-0000-4000-8000-000000000001' }] : [], rowCount: 0 }
      }, release() {} }
    } }), initializeIdentity: () => { throw Error('not an API request') },
    createSender: () => { throw Error('SYNTHETIC_PRIVATE_SENDER') },
  })
  const failed = await host.scheduled(); assert.equal(failed.status, 503)
  assert.deepEqual(await failed.json(), { detail: '服务暂时不可用' })
  failStorage = false
  const recovered = await host.scheduled(); assert.equal(recovered.status, 200)
  assert.equal((await recovered.json()).sent, 0)
  assert.deepEqual(updates, [['wake', 'pending', null]])
})

test('native health checks the initialized database and sanitizes failures', async () => {
  let fail = false
  const host = createNativePlatformHost({ readEnv: name => name === 'ARC_NATIVE_MODE' ? 'runtime' : undefined,
    loadPool: () => ({ connect: async () => ({ query: async sql => {
      if (sql.includes('native_bootstrap_state')) return { rows: [{ id: 'arc-one' }], rowCount: 1 }
      assert.equal(sql, 'SELECT 1')
      if (fail) throw Error('SYNTHETIC_PRIVATE_DATABASE_ADDRESS')
      return { rows: [{ ready: 1 }], rowCount: 1 }
    }, release() {} }) }), initializeIdentity: async () => ({ status: 'already_initialized' }),
    createSender: () => { throw Error('health must not create sender') },
  })
  const request = () => host.api(new Request('https://synthetic.invalid/native-api/health'), { ip: '192.0.2.60' })
  const healthy = await request()
  assert.equal(healthy.status, 200)
  assert.deepEqual(await healthy.json(), { status: 'ok', backend: 'netlify-native' })
  fail = true
  const unavailable = await request()
  assert.equal(unavailable.status, 503)
  assert.deepEqual(await unavailable.json(), { detail: '服务暂时不可用' })
})

test('fresh database composes bootstrap, native login, guarded Tool acceptance and persistent tick', async () => {
  const { runtimeTestDatabase } = await import('./runtime-test-db.mjs')
  const { ensureFreshIdentity } = await import('../netlify/functions/_shared/native/bootstrap.ts')
  const db = await runtimeTestDatabase()
  try {
    let passwordReads = 0, bootstrapEnabled = false
    const sent = [], password = 'Synthetic-platform-only-123!'
    const host = createNativePlatformHost({ readEnv: name => {
      if (name === 'ARC_NATIVE_MODE') return 'runtime'
      if (name === 'ARC_FRESH_START') return bootstrapEnabled ? 'enabled' : undefined
      if (name === 'ARC_INITIAL_ADMIN_EMAIL') return 'platform@example.invalid'
      if (name === 'ARC_INITIAL_ADMIN_PASSWORD') { passwordReads++; return password }
    }, loadPool: () => db.pool, initializeIdentity: ensureFreshIdentity,
    createSender: () => async id => { sent.push(id); return { sendStatus: 'succeeded', eventId: 'synthetic-wake' } } })
    const call = (path, method = 'GET', body, headers = {}) => host.api(new Request(`https://synthetic.invalid/native-api/${path}`, {
      method, headers: { Origin: 'https://synthetic.invalid', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), { ip: '192.0.2.50' })
    assert.equal((await call('auth/login', 'POST', { email: 'platform@example.invalid', password })).status, 503)
    assert.equal((await host.scheduled()).status, 503)
    for (const table of ['organizations', 'users', 'sessions', 'identity_rate_limits', 'runtime_operations', 'runtime_effects', 'runtime_event_outbox']) {
      assert.equal((await db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0)
    }
    assert.deepEqual(sent, []); assert.equal(passwordReads, 0)
    bootstrapEnabled = true
    const login = await call('auth/login', 'POST', { email: 'platform@example.invalid', password })
    assert.equal(login.status, 200)
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const headers = { Cookie: cookie, 'X-CSRF-Token': decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1]) }
    assert.equal((await call('auth/session', 'GET', undefined, headers)).status, 200)
    assert.equal(passwordReads, 1)
    const costs = await call('workspaces/arc-one/observability/cost-usage', 'GET', undefined, headers)
    assert.equal(costs.status, 200); assert.equal((await costs.json()).costConfigured, false)
    const tool = { assetType: 'tool', name: 'TEST_ONLY_PLATFORM', adapterType: 'http', adapterConfig: { url: 'https://tools.example.invalid/test' } }
    assert.equal((await call('workspaces/arc-one/asset-library', 'POST', tool)).status, 401)
    assert.equal((await call('workspaces/arc-one/asset-library', 'POST', tool, { Cookie: cookie })).status, 403)
    const created = await call('workspaces/arc-one/asset-library', 'POST', tool, headers)
    assert.equal(created.status, 201)
    const asset = await created.json()
    const accepted = await call(`workspaces/arc-one/asset-library/${asset.id}/test-invocations`, 'POST', { parameters: { marker: 'TEST_ONLY' } },
      { ...headers, 'Idempotency-Key': 'TEST_ONLY_PLATFORM_OPERATION' })
    assert.equal(accepted.status, 202)
    const op = await accepted.json()
    assert.equal(op.kind, 'tool.test'); assert.equal(op.runId, undefined)
    const tick = await host.scheduled(); assert.equal(tick.status, 200)
    assert.equal((await tick.json()).sent, 1); assert.deepEqual(sent, [op.operationId])
    assert.equal((await db.pool.query('SELECT status FROM runtime_operations WHERE id=$1', [op.operationId])).rows[0].status, 'queued')
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM runtime_effects')).rows[0].n, 0)
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM workflow_runs')).rows[0].n, 0)
    assert.equal(passwordReads, 1)
  } finally { await db.close() }
})
