import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeApiHost } from '../netlify/functions/_shared/native/api-host.ts'
import { runtimeTestDatabase } from './runtime-test-db.mjs'
import { digestToken, hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'

test('disabled internal API host never reads any dependency getter', async () => {
  for (const mode of [undefined, '', 'off', 'Runtime', ' runtime ']) {
    const ports = { mode,
      get loadConfig() { throw Error('configuration getter must remain untouched') },
      get loadPool() { throw Error('pool getter must remain untouched') },
      get resolveSecret() { throw Error('secret getter must remain untouched') },
      get fetch() { throw Error('transport getter must remain untouched') },
    }
    const handler = createNativeApiHost(ports)
    const response = await handler(new Request('https://app.example.invalid/api/auth/session'), {})
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
})

test('configuration failure is sanitized before pool initialization and a later request can recover', async () => {
  let valid = false, pools = 0, secrets = 0
  const handler = createNativeApiHost({ mode: 'runtime',
    loadConfig: () => { if (!valid) throw Error('SYNTHETIC_PRIVATE_CONFIG'); return { bindings: [] } },
    resolveSecret: () => { secrets++; throw Error('must not resolve') },
    loadPool: () => { pools++; return { connect: async () => ({ query: async sql => ({ rows: sql.includes('RETURNING count') ? [{ count: 1 }] : [], rowCount: 0 }), release() {} }) } },
  })
  const failed = await handler(new Request('https://app.example.invalid/api/auth/session'), {})
  assert.equal(failed.status, 503)
  assert.deepEqual(await failed.json(), { detail: '服务暂时不可用' })
  assert.equal(pools, 0); assert.equal(secrets, 0)
  valid = true
  const recovered = await handler(new Request('https://app.example.invalid/api/auth/session'), {})
  assert.equal(recovered.status, 401)
  assert.equal(pools, 1); assert.equal(secrets, 0)
})

test('real composed backends receive cost and bound provider options after session, CSRF and role checks', async () => {
  const db = await runtimeTestDatabase()
  try {
    await db.pool.query("INSERT INTO organizations VALUES('org','Synthetic','synthetic','active',now(),now())")
    await db.pool.query("INSERT INTO workspaces(id,organization_id,name,slug,status,created_at,updated_at) VALUES('a','org','Synthetic','synthetic','active',now(),now())")
    await db.pool.query(`INSERT INTO users(id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,failed_login_count,created_at,updated_at)
      VALUES('actor','org','actor@example.invalid','actor@example.invalid','Synthetic',$1,'active',false,0,now(),now())`, [await hashPassword('Synthetic-only-test-123!')])
    await db.pool.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status,created_at,updated_at) VALUES('member','a','actor','builder','active',now(),now())")
    await db.pool.query("INSERT INTO model_providers VALUES('provider','a','Synthetic','openai-compatible','https://models.example.invalid/v1','synthetic','SYNTHETIC_REF','draft','actor',now(),now())")
    let config = { bindings: [] }, secrets = 0
    const handler = createNativeApiHost({ mode: 'runtime', loadConfig: () => config, loadPool: () => db.pool,
      resolveSecret: ref => { assert.equal(ref, 'SYNTHETIC_REF'); secrets++; return 'SYNTHETIC_ONLY' },
      fetch: async () => { throw Error('API must not execute models') } })
    const login = await handler(new Request('https://app.example.invalid/api/auth/login', { method: 'POST',
      body: JSON.stringify({ email: 'actor@example.invalid', password: 'Synthetic-only-test-123!' }) }), { clientAddress: '192.0.2.20' })
    assert.equal(login.status, 200)
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const csrf = decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
    const request = (suffix, method = 'GET', headers = {}, clientAddress = '192.0.2.21') => handler(new Request(`https://app.example.invalid/api/workspaces/a/${suffix}`, {
      method, headers: { Cookie: cookie, 'X-CSRF-Token': csrf, ...headers }, ...(method === 'POST' ? { body: '{}' } : {}),
    }), { clientAddress })
    const costs = () => request('observability/cost-usage')
    let response = await costs()
    assert.equal(response.status, 200); assert.equal((await response.json()).costConfigured, false)
    for (const [inputCostPerMillion, outputCostPerMillion] of [[0, 0], [1, 2]]) {
      config = { bindings: [], inputCostPerMillion, outputCostPerMillion }
      response = await costs()
      assert.equal(response.status, 200); assert.equal((await response.json()).costConfigured, true)
    }
    config = { bindings: [{ workspaceId: 'a', host: 'models.example.invalid', secretRef: 'SYNTHETIC_REF' }] }
    assert.equal((await request('model-providers/provider/test', 'POST', { Cookie: '' })).status, 401)
    assert.equal((await request('model-providers/provider/test', 'POST', { 'X-CSRF-Token': '' })).status, 403)
    await db.pool.query("UPDATE workspace_memberships SET role='viewer' WHERE id='member'")
    assert.equal((await request('model-providers/provider/test', 'POST')).status, 403)
    assert.equal(secrets, 0)
    await db.pool.query("UPDATE workspace_memberships SET role='builder' WHERE id='member'")
    config = { bindings: [{ workspaceId: 'other', host: 'models.example.invalid', secretRef: 'SYNTHETIC_REF' }] }
    response = await request('model-providers/provider/test', 'POST')
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'missing_secret'); assert.equal(secrets, 0)
    config = { bindings: [{ workspaceId: 'a', host: 'models.example.invalid', secretRef: 'SYNTHETIC_REF' }] }
    response = await request('model-providers/provider/test', 'POST')
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'ready'); assert.equal(secrets, 1)
    await request('observability/cost-usage', 'GET', { 'X-Forwarded-For': '192.0.2.99' }, '192.0.2.22')
    const rateKeys = (await db.pool.query('SELECT bucket_key FROM identity_rate_limits')).rows.map(row => row.bucket_key)
    assert.ok(rateKeys.includes(`request:client:${await digestToken('192.0.2.21')}`))
    assert.ok(rateKeys.includes(`request:client:${await digestToken('192.0.2.22')}`))
    assert.ok(!rateKeys.includes(`request:client:${await digestToken('192.0.2.99')}`))
  } finally { await db.close() }
})
