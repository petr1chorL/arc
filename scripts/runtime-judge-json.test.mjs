import test from 'node:test'
import assert from 'node:assert/strict'
import { createGatewayJudgeTransport, createClosureExecutor } from '../netlify/functions/_shared/runtime-closure/evaluation.ts'
import { createNativeRuntimeDependencies } from '../netlify/functions/_shared/native/runtime-dependencies.ts'
import { createAcceptanceFetch } from '../netlify/functions/_shared/native/acceptance-budget.ts'
import { NotSentError } from '../netlify/functions/_shared/runtime/types.ts'

const binding = { workspaceId: 'arc-one', host: 'maas.qianwenaiapi.com', secretRef: 'ARC_QWEN_API_KEY' }
const model = { workspaceId: 'arc-one', baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1', secretRef: binding.secretRef,
  model: 'qwen3.8-flash', systemPrompt: 'Return JSON.', userInput: 'Synthetic input', temperature: 0, maxOutputTokens: 128 }
function fixture(check) {
  let reservations = 0, sends = 0
  const pool = { async connect() { return { async query(sql) {
    if (sql.includes('FROM model_providers')) return { rows: [{ base_url: model.baseUrl, secret_ref: model.secretRef }] }
    if (sql.includes('INSERT INTO native_acceptance_budget')) return { rows: [{ reserved_calls: ++reservations }] }
    throw Error('unexpected synthetic query')
  }, release() {} } } }
  const runtime = createNativeRuntimeDependencies({ mode: 'runtime', loadConfig: () => ({ bindings: [binding], acceptanceProfile: 'qwen-flash-1cny' }),
    resolveSecret: () => 'synthetic-only', loadAcceptancePool: () => pool, fetch: async (_url, init) => {
      sends++; check(JSON.parse(init.body))
      return Response.json({ model: model.model, choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    } })
  return { pool, runtime, count: () => ({ reservations, sends }) }
}
test('Judge JSON contract reaches the real gateway and bounded acceptance wire body', async () => {
  const state = fixture(body => {
    assert.deepEqual(body.response_format, { type: 'json_object' })
    assert.equal(body.enable_thinking, false); assert.equal(body.max_completion_tokens, 512)
  })
  const result = await createGatewayJudgeTransport(state.pool, state.runtime.dependencies.complete)({ workspaceId: 'arc-one',
    providerId: 'provider', model: model.model, responseFormat: { type: 'json_object' },
    messages: [{ role: 'system', content: 'Return JSON.' }, { role: 'user', content: 'Synthetic input' }] })
  assert.equal(result.content, '{}'); assert.deepEqual(state.count(), { reservations: 1, sends: 1 })
})

test('ordinary Agent requests retain their existing wire format and lower output limit', async () => {
  const state = fixture(body => {
    assert.equal(Object.hasOwn(body, 'response_format'), false)
    assert.equal(body.max_completion_tokens, 128)
  })
  await state.runtime.dependencies.complete(model)
  assert.deepEqual(state.count(), { reservations: 1, sends: 1 })
})

test('unsupported response formats are rejected before budget or gateway invocation', async () => {
  const state = fixture(() => { throw Error('must not send') })
  for (const responseFormat of [null, [], 'json', { type: 'text' }, { type: 'json_schema' },
    { type: 'json_object', tools: [] }]) {
    await assert.rejects(state.runtime.dependencies.complete({ ...model, responseFormat }), error => error instanceof NotSentError)
  }
  assert.deepEqual(state.count(), { reservations: 0, sends: 0 })
})

test('raw acceptance requests cannot bypass exact JSON-format validation', async () => {
  let connections = 0, sends = 0
  const bounded = createAcceptanceFetch(() => { connections++; throw Error('must not reserve') }, async () => { sends++; throw Error('must not send') })
  for (const format of [null, [], { type: 'text' }, { type: 'json_object', schema: {} }]) {
    await assert.rejects(bounded(model.baseUrl + '/chat/completions', { method: 'POST', redirect: 'error', body: JSON.stringify({
      model: model.model, messages: [{ role: 'system', content: 'Return JSON.' }, { role: 'user', content: 'test' }],
      temperature: 0, max_tokens: 128, response_format: format,
    }) }), error => error instanceof NotSentError)
  }
  assert.equal(connections, 0); assert.equal(sends, 0)
})

test('JSON mode does not turn malformed JSON content into a successful assessment', async () => {
  let writes = 0
  const closure = createClosureExecutor({ judge: async () => ({ content: '```json\n{}\n```', model: 'synthetic',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, costUsd: 0 }) })
  const context = { transaction: async fn => fn({ async query(sql) {
    if (sql.startsWith('SELECT * FROM evaluations')) return { rows: [] }
    writes++; throw Error('must not write a successful record')
  } }), effect: async (_key, _input, send) => send() }
  await assert.rejects(closure({ id: 'operation', kind: 'evaluation.run', workspace_id: 'arc-one', input: {
    artifactText: 'test', snapshot: { judgeType: 'llm', judgeModel: model.model, modelProviderId: 'provider', passScore: 60,
      dimensions: [{ id: 'quality', name: 'Quality', weight: 100 }] },
  } }, context), /评分响应不是有效 JSON/)
  assert.equal(writes, 0)
})
