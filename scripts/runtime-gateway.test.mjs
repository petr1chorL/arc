import test from 'node:test'
import assert from 'node:assert/strict'
test('model transport rejects unbound endpoints before secrets and validates controlled response', async () => {
  const { createRuntimeGateway } = await import('../netlify/functions/_shared/runtime/gateway.ts')
  let secrets = 0, sends = 0
  const gateway = createRuntimeGateway({ allowedBindings: [{ workspaceId: 'a', host: 'model.example.invalid', secretRef: 'TEST_REF' }],
    resolveSecret: () => { secrets++; return 'synthetic-only' }, fetch: async (_url, init) => {
      sends++; assert.equal(init.redirect, 'error'); assert.equal(JSON.parse(init.body).messages[1].content, 'input')
      return Response.json({ choices: [{ message: { content: 'output' } }], model: 'test', usage: { prompt_tokens: 10, completion_tokens: 5 } })
    } })
  const request = { workspaceId: 'a', baseUrl: 'https://model.example.invalid/v1', secretRef: 'TEST_REF', model: 'test', systemPrompt: 'system', userInput: 'input', temperature: 0.2, maxOutputTokens: 200 }
  await assert.rejects(gateway.complete({ ...request, workspaceId: 'other' }))
  await assert.rejects(gateway.complete({ ...request, baseUrl: 'http://model.example.invalid' }))
  assert.equal(secrets, 0); assert.equal(sends, 0)
  const output = await gateway.complete(request)
  assert.equal(output.content, 'output'); assert.equal(output.promptTokens, 10); assert.equal(output.completionTokens, 5)
  assert.equal(sends, 1)
})

test('remote adapter accepts exact arc-agent-v1 contract, not invented status/model fields', async () => {
  const { createRuntimeGateway } = await import('../netlify/functions/_shared/runtime/gateway.ts')
  const gateway = createRuntimeGateway({ allowedBindings: [{ workspaceId: 'a', host: 'agent.example.invalid', secretRef: 'TEST_REF' }],
    resolveSecret: () => 'synthetic', fetch: async () => Response.json({ protocolVersion: 'arc-agent-v1', invocationId: 'fixed',
      output: 'remote output', usage: { model: 'remote-model', promptTokens: 2, completionTokens: 3, costUsd: 0.1 }, toolCalls: [] }) })
  const result = await gateway.remote({ workspaceId: 'a', endpointUrl: 'https://agent.example.invalid/run', secretRef: 'TEST_REF',
    invocationId: 'fixed', runId: 'run', timeoutSeconds: 30, payload: {} })
  assert.equal(result.content, 'remote output'); assert.equal(result.costUsd, 0.1)
})

test('invalid billing/model configuration is rejected before transport and absent usage is not fabricated as zero',async()=>{
  const {createRuntimeGateway}=await import('../netlify/functions/_shared/runtime/gateway.ts')
  const request={workspaceId:'a',baseUrl:'https://model.example.invalid/v1',secretRef:'TEST_REF',model:'test',systemPrompt:'system',userInput:'input',temperature:0.2,maxOutputTokens:100}
  let sends=0,secrets=0
  const options={allowedBindings:[{workspaceId:'a',host:'model.example.invalid',secretRef:'TEST_REF'}],resolveSecret:()=>{secrets++;return 'synthetic'},fetch:async()=>{sends++;return Response.json({choices:[{message:{content:'output'}}],model:'test'})}}
  await assert.rejects(createRuntimeGateway({...options,inputCostPerMillion:-1}).complete(request))
  assert.equal(sends,0);assert.equal(secrets,0)
  await assert.rejects(createRuntimeGateway(options).complete({...request,model:' '}))
  assert.equal(sends,0)
  await assert.rejects(createRuntimeGateway(options).complete(request))
  assert.equal(sends,1)
})

test('deadline covers both transport and streaming even when an injected receiver ignores abort',async()=>{
  const {createRuntimeGateway}=await import('../netlify/functions/_shared/runtime/gateway.ts')
  const request={workspaceId:'a',baseUrl:'https://model.example.invalid/v1',secretRef:'TEST_REF',model:'test',systemPrompt:'system',userInput:'input',temperature:0.2,maxOutputTokens:100}
  const options={allowedBindings:[{workspaceId:'a',host:'model.example.invalid',secretRef:'TEST_REF'}],resolveSecret:()=> 'synthetic',requestTimeoutMs:15}
  const guard=(promise)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('test guard: deadline absent')),250))])
  await assert.rejects(guard(createRuntimeGateway({...options,fetch:async()=>new Promise(()=>{})}).complete(request)),/外部请求超时/)
  await assert.rejects(guard(createRuntimeGateway({...options,fetch:async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{})}),{headers:{'Content-Type':'application/json'}})}).complete(request)),/外部请求超时/)
})
