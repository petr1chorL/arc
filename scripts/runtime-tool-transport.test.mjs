import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { invokeHttpTool, toolQueryParameters } from '../netlify/functions/_shared/runtime/http-tool-transport.ts'

const config = { url: 'https://tools.example.invalid/lookup', method: 'POST' }
const options = { allowedBindings: [{ workspaceId: 'a', host: 'tools.example.invalid' }] }
const invoke = (fetch, parameters = {}, extra = {}) => invokeHttpTool(config, parameters, 'a', 'test-only', { ...options, fetch, ...extra })

test('GET scalar, repeated and nested parameters agree with the installed Python httpx contract', () => {
  const parameters = { flag: true, no: false, nil: null, values: [1, true, null, 'a b'],
    nested: { ok: true, nil: null, list: ['a', false], quote: "it's", control: '\n\u0001' }, arrays: [[1, false], { k: 'v' }] }
  const localPython = 'apps/api/.venv/Scripts/python.exe'
  const python = spawnSync(existsSync(localPython) ? localPython : 'python', ['-I', '-c',
    'import httpx,json,sys; print(json.dumps(list(httpx.QueryParams(json.load(sys.stdin)).multi_items())))'],
  { input: JSON.stringify(parameters), encoding: 'utf8', timeout: 10000, windowsHide: true })
  assert.equal(python.status, 0, python.stderr || python.error?.message)
  assert.deepEqual([...toolQueryParameters(parameters)], JSON.parse(python.stdout))
  // Numeric JSON values are deliberately normalized, not lexical Python 1.0 / 1 preservation.
  assert.equal(toolQueryParameters({ n: 1.0 }).get('n'), '1')
})

test('POST preserves the parameter object and GET has no body; send identity and redirects are fixed', async () => {
  const parameters = { sku: 'A001', filters: { enabled: true }, ids: [1, 2] }
  await invoke(async (url, init) => {
    assert.equal(url, config.url); assert.deepEqual(JSON.parse(init.body), parameters)
    assert.equal(init.headers['Idempotency-Key'], 'test-only'); assert.equal(init.redirect, 'error')
    return Response.json({ ok: true })
  }, parameters)
  await invokeHttpTool({ ...config, method: 'GET' }, { input: 'a b' }, 'a', 'test-only', { ...options, fetch: async (url, init) => {
    assert.equal(new URL(url).searchParams.get('input'), 'a b'); assert.equal(init.body, undefined)
    return new Response('ok')
  } })
})

test('unauthorized Workspace and invalid timeouts fail before any send', async () => {
  let sends = 0
  const fetch = async () => { sends++; return new Response('ok') }
  await assert.rejects(invoke(fetch, {}, { allowedBindings: [{ workspaceId: 'b', host: 'tools.example.invalid' }] }))
  for (const requestTimeoutMs of [0, 10001, NaN]) await assert.rejects(invoke(fetch, {}, { requestTimeoutMs }))
  assert.equal(sends, 0)
})

test('4xx is a cached business failure while redirects and 5xx remain uncertain', async () => {
  assert.equal((await invoke(async () => new Response('private failure', { status: 400 }))).status, 'failed')
  for (const status of [302, 500, 503]) await assert.rejects(invoke(async () => new Response('private failure', { status })), /不确定/)
})

test('timeout bounds transport and body reading even when the injected sender ignores abort', async () => {
  let signal
  const before = Date.now()
  await assert.rejects(invoke(async (_url, init) => { signal = init.signal; return new Promise(() => {}) }, {}, { requestTimeoutMs: 20 }), /待核对/)
  assert.equal(signal.aborted, true)
  await assert.rejects(invoke(async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}) } })), {}, { requestTimeoutMs: 20 }), /待核对/)
  assert.ok(Date.now() - before < 1500)
})

test('oversize, truncated UTF-8 and malformed JSON are unknown; successful summaries are bounded', async () => {
  for (const response of [new Response('x'.repeat(65537)), new Response(new Uint8Array([0xc3])),
    new Response('{', { headers: { 'Content-Type': 'application/json' } })]) {
    await assert.rejects(invoke(async () => response))
  }
  assert.equal((await invoke(async () => new Response('x'.repeat(2000)))).outputSummary.length, 1000)
})

test('empty or whitespace output cannot be reported as a successful Tool result', async () => {
  for (const body of ['', ' \r\n\t']) await assert.rejects(invoke(async () => new Response(body)), /空输出/)
  for (const body of ['""', '"   "']) await assert.rejects(invoke(async () => new Response(body, { headers: { 'Content-Type': 'application/json' } })), /空输出/)
})
