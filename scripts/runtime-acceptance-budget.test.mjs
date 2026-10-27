import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeRuntimeDependencies } from '../netlify/functions/_shared/native/runtime-dependencies.ts'
import { createAcceptanceFetch, ACCEPTANCE_BUDGET_ID } from '../netlify/functions/_shared/native/acceptance-budget.ts'

const binding = { workspaceId: 'arc-one', host: 'maas.qianwenaiapi.com', secretRef: 'ARC_QWEN_API_KEY' }
const config = { bindings: [binding], acceptanceProfile: 'qwen-flash-1cny' }
const request = { workspaceId: 'arc-one', baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
  secretRef: 'ARC_QWEN_API_KEY', model: 'qwen3.8-flash', systemPrompt: 'Reply briefly.', userInput: 'Hello', temperature: 0, maxOutputTokens: 1000 }

test('acceptance limits output and reserves a durable slot before sending', async () => {
  const events = []
  const runtime = createNativeRuntimeDependencies({ mode: 'runtime', loadConfig: () => config,
    resolveSecret: () => 'synthetic-not-a-secret',
    loadAcceptancePool: () => ({ connect: async () => ({ query: async () => { events.push('reserve'); return { rows: [{ reserved_calls: 1 }] } }, release: () => events.push('release') }) }),
    fetch: async (url, init) => { events.push('send'); const body = JSON.parse(init.body)
      assert.equal(url, request.baseUrl + '/chat/completions')
      assert.equal(body.max_completion_tokens, 512); assert.equal(body.enable_thinking, false); assert.equal(body.stream, false)
      assert.equal(body.max_tokens, undefined)
      return Response.json({ model: request.model, choices: [{ message: { content: 'Hello' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }) },
  })
  assert.deepEqual(events, [])
  await runtime.dependencies.complete(request)
  assert.deepEqual(events, ['reserve', 'release', 'send'])
})

function syntheticPool() {
  let count = 0
  return { get count() { return count }, connect: async () => ({
    async query(sql, values) {
      assert.match(sql, /ON CONFLICT/); assert.match(sql, /reserved_calls<20/)
      assert.deepEqual(values, [ACCEPTANCE_BUDGET_ID])
      return { rows: count < 20 ? [{ reserved_calls: ++count }] : [] }
    }, release() {},
  }) }
}
function assembly(pool, overrides = {}) {
  return createNativeRuntimeDependencies({ mode: 'runtime', loadConfig: () => config,
    resolveSecret: () => 'synthetic-not-a-secret', loadAcceptancePool: () => pool,
    fetch: async () => Response.json({ model: request.model, choices: [{ message: { content: 'Hello' } }],
      usage: { prompt_tokens: 5, completion_tokens: 1 } }), ...overrides })
}

test('twenty reservations exhaust the allowance across reconstructed assemblies', async () => {
  const pool = syntheticPool()
  for (let i = 0; i < 20; i++) await assembly(pool).dependencies.complete(request)
  await assert.rejects(assembly(pool).dependencies.complete(request), /预算不可用或已用尽/)
  assert.equal(pool.count, 20)
})

test('failed or ambiguous transport keeps its reservation and never retries internally', async () => {
  const pool = syntheticPool(); let sends = 0
  const runtime = assembly(pool, { fetch: async () => { sends++; throw Error('synthetic transport failed') } })
  await assert.rejects(runtime.dependencies.complete(request))
  assert.equal(sends, 1); assert.equal(pool.count, 1)
})

test('invalid model, endpoint, workspace, secret, oversize and multimodal input never reserve or send', async () => {
  const pool = syntheticPool(); let sends = 0
  const runtime = assembly(pool, { fetch: async () => { sends++; throw Error('must not send') } })
  for (const patch of [{ model: 'other' }, { baseUrl: request.baseUrl + '/other' },
    { baseUrl: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1' }, { workspaceId: 'other' },
    { secretRef: 'OTHER' }, { userInput: '字'.repeat(4000) }, { systemPrompt: [] },
    { userInput: [{ type: 'image_url', image_url: 'https://example.invalid/photo' }] }]) {
    await assert.rejects(runtime.dependencies.complete({ ...request, ...patch }))
  }
  assert.equal(pool.count, 0); assert.equal(sends, 0)
})

test('profile rejects additional bindings and all remote or tool external execution', async () => {
  for (const patch of [{ acceptanceProfile: 'other' }, { acceptanceProfile: null },
    { bindings: [{ ...binding, workspaceId: 'other' }] }, { bindings: [{ ...binding, secretRef: 'OTHER' }] },
    { bindings: [{ ...binding, host: 'other.invalid' }] }, { toolBindings: [{ workspaceId: 'arc-one', host: 'tools.invalid' }] }]) {
    assert.throws(() => assembly(syntheticPool(), { loadConfig: () => ({ ...config, ...patch }) }))
  }
  const pool = syntheticPool(); const runtime = assembly(pool)
  await assert.rejects(runtime.dependencies.remote({}), /验收期间不允许/)
  assert.deepEqual(runtime.dependencies.toolOptions.allowedBindings, [])
  assert.equal(pool.count, 0)
})

test('database connection, query and release errors are credential-free and prevent send', async () => {
  for (const kind of ['connect', 'query', 'release']) {
    let sends = 0
    const fail = () => { throw Error('SYNTHETIC_PRIVATE_DB_SENTINEL') }
    const pool = { connect: kind === 'connect' ? fail : async () => ({
      query: kind === 'query' ? fail : async () => ({ rows: [{ reserved_calls: 1 }] }),
      release: kind === 'release' ? fail : () => {},
    }) }
    await assert.rejects(assembly(pool, { fetch: async () => { sends++; throw Error('must not send') } }).dependencies.complete(request),
      { message: '验收预算不可用或已用尽，未发送' })
    assert.equal(sends, 0)
  }
})

test('profile absent or runtime off does not access budget pool', async () => {
  const forbidden = () => { throw Error('must not load budget') }
  const runtime = assembly(undefined, { loadConfig: () => ({ bindings: [binding] }), loadAcceptancePool: forbidden })
  await runtime.dependencies.complete(request)
  assert.equal(createNativeRuntimeDependencies({ mode: 'disabled', loadConfig: forbidden,
    get loadAcceptancePool() { throw Error('must not read budget port') } }), null)
  const profile = assembly(undefined, { loadAcceptancePool: undefined })
  await assert.rejects(profile.dependencies.complete(request), /未发送/)
})

test('lower requested output cap is retained and extra paid request features are rejected', async () => {
  const pool = syntheticPool(); let sentBody
  const bounded = createAcceptanceFetch(() => pool, async (_url, init) => { sentBody = JSON.parse(init.body); return Response.json({}) })
  const body = { model: request.model, temperature: 0, max_tokens: 10,
    messages: [{ role: 'system', content: 'test' }, { role: 'user', content: 'test' }] }
  for (const patch of [{ tools: [] }, { enable_search: true }, { n: 4 }, { stream: true },
    { messages: [{ role: 'user', content: 'test' }] }]) {
    await assert.rejects(bounded(request.baseUrl + '/chat/completions', { method: 'POST', redirect: 'error', body: JSON.stringify({ ...body, ...patch }) }))
  }
  assert.equal(pool.count, 0)
  await bounded(request.baseUrl + '/chat/completions', { method: 'POST', redirect: 'error', body: JSON.stringify(body) })
  assert.equal(sentBody.max_completion_tokens, 10); assert.equal(pool.count, 1)
})

test('cancellation during reservation consumes slot but never reaches transport', async () => {
  const controller = new AbortController(); let sends = 0
  const bounded = createAcceptanceFetch(() => ({ connect: async () => ({
    query: async () => { controller.abort(); return { rows: [{ reserved_calls: 1 }] } }, release() {},
  }) }), async () => { sends++; return Response.json({}) })
  const body = { model: request.model, temperature: 0, max_tokens: 10,
    messages: [{ role: 'system', content: 'test' }, { role: 'user', content: 'test' }] }
  await assert.rejects(bounded(request.baseUrl + '/chat/completions', { method: 'POST', redirect: 'error',
    signal: controller.signal, body: JSON.stringify(body) }), /已取消/)
  assert.equal(sends, 0)
})

