import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeRuntimeDependencies, parseNativeRuntimeConfig } from '../netlify/functions/_shared/native/runtime-dependencies.ts'

const binding = { workspaceId: 'synthetic', host: 'models.example.invalid', secretRef: 'SYNTHETIC_REF' }

test('disabled runtime never reads configuration or secret ports', () => {
  for (const mode of [undefined, '', 'native', 'Runtime', ' runtime ', 'off']) {
    const ports = { mode, loadConfig: () => { throw Error('must not load configuration') },
      get resolveSecret() { throw Error('must not initialize secret resolver') },
      get fetch() { throw Error('must not initialize transport') } }
    assert.equal(createNativeRuntimeDependencies(ports), null)
  }
})

test('explicit configuration is validated and detached from caller mutations', () => {
  const source = { bindings: [{ ...binding, host: 'MODELS.example.invalid' }], inputCostPerMillion: 1, outputCostPerMillion: 2, requestTimeoutMs: 5000 }
  const config = parseNativeRuntimeConfig(source)
  assert.deepEqual(config, { bindings: [binding], inputCostPerMillion: 1, outputCostPerMillion: 2, requestTimeoutMs: 5000, costConfigured: true })
  source.bindings[0].workspaceId = 'other'
  assert.equal(config.bindings[0].workspaceId, 'synthetic')
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.bindings) && Object.isFrozen(config.bindings[0]))
  assert.equal(parseNativeRuntimeConfig({ bindings: [] }).costConfigured, false)
  assert.equal(parseNativeRuntimeConfig({ bindings: [], inputCostPerMillion: 0, outputCostPerMillion: 0 }).costConfigured, true)
  for (const bad of [null, 'not-json', [], {}, { bindings: [binding], secret: 'SYNTHETIC_PRIVATE' },
    { bindings: [binding, binding] }, { bindings: [binding], inputCostPerMillion: 1 },
    { bindings: [binding], inputCostPerMillion: -1, outputCostPerMillion: 2 },
    { bindings: [binding], inputCostPerMillion: NaN, outputCostPerMillion: 2 },
    { bindings: [binding], inputCostPerMillion: Infinity, outputCostPerMillion: 2 },
    { bindings: [binding], inputCostPerMillion: Number.MAX_VALUE, outputCostPerMillion: 2 },
    { bindings: [binding], inputCostPerMillion: '1', outputCostPerMillion: 2 },
    { bindings: [binding], requestTimeoutMs: 60001 },
    { bindings: [binding], requestTimeoutMs: null },
    ...['https://models.example.invalid', 'models.example.invalid:443', '127.0.0.1', '127.1', '999.999', '[::1]', '*.example.invalid', 'localhost', 'models.example.invalid.', 'models..invalid']
      .map(host => ({ bindings: [{ ...binding, host }] })),
    { bindings: [{ ...binding, workspaceId: 'other/workspace' }] }, { bindings: [{ ...binding, secretRef: 'invalid-ref' }] },
  ]) assert.throws(() => parseNativeRuntimeConfig(bad), /运行依赖配置无效/)
})

test('gateway construction is lazy about secrets and transport and preserves configured costs', async () => {
  let secrets = 0, sends = 0
  const runtime = createNativeRuntimeDependencies({ mode: 'runtime', loadConfig: () => ({ bindings: [binding], inputCostPerMillion: 2, outputCostPerMillion: 4 }),
    resolveSecret: ref => { assert.equal(ref, 'SYNTHETIC_REF'); secrets++; return 'SYNTHETIC_ONLY' },
    fetch: async (url, options) => { sends++; assert.equal(url, 'https://models.example.invalid/v1/chat/completions'); assert.equal(options.redirect, 'error');
      return Response.json({ model: 'synthetic', choices: [{ message: { content: 'synthetic result' } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }) } })
  assert.equal(secrets, 0); assert.equal(sends, 0)
  assert.deepEqual(runtime.closureOptions, { costConfigured: true })
  assert.equal(runtime.dependencies.notificationAdapters, undefined)
  assert.equal(runtime.dependencies.toolOptions, undefined)
  const request = { workspaceId: binding.workspaceId, baseUrl: 'https://models.example.invalid/v1', secretRef: binding.secretRef,
    model: 'synthetic', systemPrompt: 'test', userInput: 'test', temperature: 0, maxOutputTokens: 100 }
  for (const changed of [{ workspaceId: 'other' }, { baseUrl: 'https://other.example.invalid' }, { secretRef: 'OTHER_REF' }, { baseUrl: 'http://models.example.invalid' }]) {
    await assert.rejects(runtime.dependencies.complete({ ...request, ...changed }))
  }
  assert.equal(secrets, 0); assert.equal(sends, 0)
  assert.equal((await runtime.dependencies.complete(request)).costUsd, 0.004)
  assert.equal(secrets, 1); assert.equal(sends, 1)
})

test('provider presence checks require the exact approved binding before secret resolution', async () => {
  let secrets = 0, sends = 0
  const source = { bindings: [{ ...binding }] }
  const runtime = createNativeRuntimeDependencies({ mode: 'runtime', loadConfig: () => source,
    resolveSecret: () => { secrets++; return 'SYNTHETIC_ONLY' }, fetch: async () => { sends++; throw Error('must not send') } })
  assert.deepEqual(runtime.closureOptions, { costConfigured: false })
  const request = { workspaceId: binding.workspaceId, providerId: 'synthetic-provider', baseUrl: 'https://models.example.invalid/v1', secretRef: binding.secretRef }
  source.bindings[0].workspaceId = 'other'
  for (const changed of [{ workspaceId: 'other' }, { secretRef: 'OTHER_REF' },
    ...['https://other.example.invalid', 'http://models.example.invalid', 'https://models.example.invalid:444/v1',
      'https://user:pass@models.example.invalid/v1', 'https://models.example.invalid/v1?secret=ref', 'https://models.example.invalid/v1#part', 'not-url']
      .map(baseUrl => ({ baseUrl })),
  ]) assert.equal(await runtime.providerOptions.secretPresence({ ...request, ...changed }), false)
  assert.equal(secrets, 0); assert.equal(sends, 0)
  assert.equal(await runtime.providerOptions.secretPresence(request), true)
  assert.equal(secrets, 1); assert.equal(sends, 0)
})

test('bad configuration and missing or failed secret resolution cannot send or leak details', async () => {
  let secrets = 0, sends = 0
  const options = { mode: 'runtime', loadConfig: () => ({ bindings: [binding] }),
    resolveSecret: () => { secrets++; return undefined }, fetch: async () => { sends++; throw Error('must not send') } }
  for (const loadConfig of [() => ({ bindings: [binding], inputCostPerMillion: 1 }), () => { throw Error('SYNTHETIC_PRIVATE_ERROR') }]) {
    assert.throws(() => createNativeRuntimeDependencies({ ...options, loadConfig }), error => error.message === '运行依赖配置无效')
  }
  assert.equal(secrets, 0); assert.equal(sends, 0)
  const request = { workspaceId: binding.workspaceId, providerId: 'synthetic-provider', baseUrl: 'https://models.example.invalid/v1', secretRef: binding.secretRef,
    model: 'synthetic', systemPrompt: 'test', userInput: 'test', temperature: 0, maxOutputTokens: 100 }
  const missing = createNativeRuntimeDependencies(options)
  assert.equal(await missing.providerOptions.secretPresence(request), false)
  await assert.rejects(missing.dependencies.complete(request), /外部服务凭证未配置/)
  for (const resolveSecret of [() => { throw Error('SYNTHETIC_PRIVATE_ERROR') }, () => 'bad\r\nSYNTHETIC', () => ' ']) {
    const failed = createNativeRuntimeDependencies({ ...options, resolveSecret })
    await assert.rejects(failed.dependencies.complete(request), error => error.message === '外部服务凭证解析失败，未发送')
  }
  assert.equal(sends, 0)
})

test('Tool hosts require their own immutable Workspace binding and never borrow model credentials', async () => {
  const source = { bindings: [binding], toolBindings: [{ workspaceId: 'synthetic', host: 'TOOLS.example.invalid' }] }
  let secrets = 0, sends = 0
  const runtime = createNativeRuntimeDependencies({ mode: 'runtime', loadConfig: () => source,
    resolveSecret: () => { secrets++; throw Error('Tool must not resolve model secrets') },
    fetch: async () => { sends++; return Response.json({ ok: true }) } })
  assert.deepEqual(runtime.dependencies.toolOptions.allowedBindings, [{ workspaceId: 'synthetic', host: 'tools.example.invalid' }])
  source.toolBindings[0].host = 'changed.example.invalid'
  assert.ok(Object.isFrozen(runtime.dependencies.toolOptions.allowedBindings[0]))
  const { invokeHttpTool } = await import('../netlify/functions/_shared/runtime/http-tool-transport.ts')
  for (const [workspaceId, host] of [['other', 'tools.example.invalid'], ['synthetic', binding.host]]) {
    await assert.rejects(invokeHttpTool({ url: `https://${host}/test`, method: 'POST' }, {}, workspaceId, 'synthetic', runtime.dependencies.toolOptions))
  }
  assert.equal(sends, 0)
  await invokeHttpTool({ url: 'https://tools.example.invalid/test', method: 'POST' }, {}, 'synthetic', 'synthetic', runtime.dependencies.toolOptions)
  assert.equal(sends, 1); assert.equal(secrets, 0)
  for (const toolBindings of [null, {}, [{ workspaceId: 'synthetic', host: '127.0.0.1' }],
    [{ workspaceId: 'synthetic', host: 'tools.example.invalid', secretRef: 'FORBIDDEN' }],
    [{ workspaceId: 'synthetic', host: 'tools.example.invalid' }, { workspaceId: 'synthetic', host: 'TOOLS.example.invalid' }]]) {
    assert.throws(() => parseNativeRuntimeConfig({ bindings: [], toolBindings }), /运行依赖配置无效/)
  }
})
