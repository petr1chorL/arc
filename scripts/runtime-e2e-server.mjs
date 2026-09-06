// Test-only, disposable loopback PostgreSQL fixture. No environment files, secrets or real providers.
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { runtimeTestDatabase } from './runtime-test-db.mjs'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { resolveIdentityWorkspaceRoute } from '../netlify/functions/_shared/identity-workspace/routes.ts'
import { createReferenceAssetsHandler } from '../netlify/functions/_shared/reference-assets/handler.ts'
import { createPostgresReferenceAssetsBackend } from '../netlify/functions/_shared/reference-assets/postgres.ts'
import { resolveReferenceAssetRoute } from '../netlify/functions/_shared/reference-assets/routes.ts'
import { createAgentsHandler } from '../netlify/functions/_shared/agents/handler.ts'
import { createPostgresAgentsBackend } from '../netlify/functions/_shared/agents/postgres.ts'
import { resolveAgentRoute } from '../netlify/functions/_shared/agents/routes.ts'
import { createDataObjectsHandler } from '../netlify/functions/_shared/data-objects/handler.ts'
import { createPostgresDataObjectsBackend } from '../netlify/functions/_shared/data-objects/postgres.ts'
import { resolveDataObjectRoute } from '../netlify/functions/_shared/data-objects/routes.ts'
import { createRubricsHandler } from '../netlify/functions/_shared/rubrics/handler.ts'
import { createPostgresRubricsBackend } from '../netlify/functions/_shared/rubrics/postgres.ts'
import { resolveRubricRoute } from '../netlify/functions/_shared/rubrics/routes.ts'
import { createFeedbackHandler } from '../netlify/functions/_shared/feedback-candidates/handler.ts'
import { createPostgresFeedbackBackend } from '../netlify/functions/_shared/feedback-candidates/postgres.ts'
import { resolveFeedbackRoute } from '../netlify/functions/_shared/feedback-candidates/routes.ts'
import { createWorkflowsHandler } from '../netlify/functions/_shared/workflows/handler.ts'
import { createPostgresWorkflowsBackend } from '../netlify/functions/_shared/workflows/postgres.ts'
import { resolveWorkflowRoute } from '../netlify/functions/_shared/workflows/routes.ts'
import { createRuntimeHandler, resolveRuntimeRoute } from '../netlify/functions/_shared/runtime/handler.ts'
import { createPostgresRuntimeBackend } from '../netlify/functions/_shared/runtime/postgres.ts'
import { createRuntimeClosureHandler, resolveRuntimeClosureRoute } from '../netlify/functions/_shared/runtime-closure/handler.ts'
import { createPostgresRuntimeClosureBackend } from '../netlify/functions/_shared/runtime-closure/postgres.ts'
import { createRuntimeDeliveryHandler } from '../netlify/functions/_shared/runtime-delivery/handler.ts'
import { resolveRuntimeDeliveryRoute } from '../netlify/functions/_shared/runtime-delivery/routes.ts'
import { createPostgresRuntimeDeliveryBackend } from '../netlify/functions/_shared/runtime-delivery/postgres.ts'
import { createRuntimeGateway } from '../netlify/functions/_shared/runtime/gateway.ts'
import { processRuntimeOperation } from '../netlify/functions/_shared/runtime/service.ts'

const db = await runtimeTestDatabase(), pool = db.pool
let closing = false, providerCalls = 0, toolCalls = 0
const uncertain = new Set()
const gateway = createRuntimeGateway({ allowedBindings: [{ workspaceId: 'runtime', host: 'models.example.invalid', secretRef: 'TEST_ONLY' }],
  resolveSecret: ref => ref === 'TEST_ONLY' ? 'TEST_ONLY_SYNTHETIC' : undefined,
  inputCostPerMillion: 1, outputCostPerMillion: 2,
  fetch: async (url, init) => {
    if (url !== 'https://models.example.invalid/v1/chat/completions') throw Error('Unexpected synthetic destination')
    const body = JSON.parse(init.body), text = body.messages[1].content
    providerCalls++
    if (text.includes('TEST_ONLY_UNCERTAIN') && !uncertain.has(text)) { uncertain.add(text); throw Error('TEST_ONLY transport interrupted after send') }
    const content = body.messages[0].content.includes('dimensionScores')
      ? JSON.stringify({ dimensionScores: [{ dimensionId: 'quality', name: '质量', score: 90, reason: 'TEST_ONLY 受控来源核对' }], rationale: 'TEST_ONLY 受控 Judge 响应' })
      : `TEST_ONLY Agent 产出：${text}`
    return new Response(JSON.stringify({ model: 'synthetic-model', choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { headers: { 'Content-Type': 'application/json' } })
  },
})
// Explicit synthetic transport: no fallback to global fetch or real tool endpoint.
const runtimeDependencies = { ...gateway, toolOptions: {
  allowedBindings: [{ workspaceId: 'runtime', host: 'tools.example.invalid' }],
  fetch: async (url, init) => {
    if (String(url) !== 'https://tools.example.invalid/lookup' || init.method !== 'POST') throw Error('Unexpected synthetic Tool destination')
    const parameters = JSON.parse(init.body)
    toolCalls++
    if (parameters.sku === 'TEST_ONLY_TOOL_UNCERTAIN' && !uncertain.has('tool-uncertain')) {
      uncertain.add('tool-uncertain')
      throw Error('TEST_ONLY Tool response lost after send')
    }
    return new Response('TEST_ONLY_PRIVATE_TOOL_OUTPUT', { headers: { 'Content-Type': 'text/plain' } })
  },
} }
const factories = [
  [resolveIdentityWorkspaceRoute, createIdentityWorkspaceHandler, createPostgresIdentityWorkspaceBackend],
  [resolveRuntimeRoute, createRuntimeHandler, createPostgresRuntimeBackend],
  [resolveRuntimeClosureRoute, createRuntimeClosureHandler, createPostgresRuntimeClosureBackend],
  [resolveRuntimeDeliveryRoute, createRuntimeDeliveryHandler, createPostgresRuntimeDeliveryBackend],
  [resolveReferenceAssetRoute, createReferenceAssetsHandler, createPostgresReferenceAssetsBackend],
  [resolveAgentRoute, createAgentsHandler, createPostgresAgentsBackend],
  [resolveDataObjectRoute, createDataObjectsHandler, createPostgresDataObjectsBackend],
  [resolveRubricRoute, createRubricsHandler, createPostgresRubricsBackend],
  [resolveFeedbackRoute, createFeedbackHandler, createPostgresFeedbackBackend],
  [resolveWorkflowRoute, createWorkflowsHandler, createPostgresWorkflowsBackend],
].map(([resolve, handler, backend]) => [resolve, handler, backend(pool)])
const server = createServer(async (incoming, outgoing) => {
  try {
    if (closing) { outgoing.writeHead(503); outgoing.end('TEST_ONLY closing'); return }
    if (incoming.url === '/__ready') { outgoing.setHeader('Content-Type', 'application/json'); outgoing.end(JSON.stringify({ synthetic: true, externalNetworkCalls: 0 })); return }
    if (incoming.method === 'POST' && incoming.headers['x-arc-synthetic-control'] === 'TEST_ONLY' && !incoming.headers.origin) {
      if (incoming.url === '/__shutdown') {
        closing = true
        await db.close()
        outgoing.end('runtime schema removed and verified')
        setImmediate(() => { server.closeAllConnections(); server.close(() => process.exit(0)) })
        return
      }
      if (incoming.url === '/__tick') {
        let processed = 0
        for (let step = 0; step < 12; step++) {
          const rows = (await pool.query("SELECT id FROM runtime_operations WHERE status='queued' AND available_at<=now() ORDER BY created_at LIMIT 30")).rows
          if (!rows.length) break
          for (const row of rows) { await processRuntimeOperation(pool, row.id, runtimeDependencies); processed++ }
        }
        outgoing.setHeader('Content-Type', 'application/json'); outgoing.end(JSON.stringify({ processed, providerCalls, toolCalls, externalNetworkCalls: 0 })); return
      }
    }
    const url = new URL(incoming.url, 'http://127.0.0.1:5175'), method = incoming.method ?? 'GET'
    const factory = factories.find(([resolve]) => resolve(method, url.pathname))
    if (!factory) { outgoing.writeHead(404, { 'Content-Type': 'application/json' }); outgoing.end('{"detail":"TEST_ONLY 路由不存在"}'); return }
    const [_, createHandler, backend] = factory
    const client = String(incoming.headers['x-arc-test-client'] ?? '1')
    const handler = createHandler(backend, { clientAddress: `192.0.2.${/^\d{1,2}$/.test(client) ? client : '1'}` })
    const response = await handler(new Request(url, { method, headers: incoming.headers,
      ...(!['GET', 'HEAD'].includes(method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) }))
    outgoing.statusCode = response.status
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') outgoing.setHeader(key, value) })
    const cookies = response.headers.getSetCookie(); if (cookies.length) outgoing.setHeader('set-cookie', cookies)
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) { console.error('Synthetic runtime request failed', error.code ?? '', error.message); outgoing.writeHead(503); outgoing.end('TEST_ONLY service failed') }
})
async function close() {
  if (closing) return
  closing = true
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await db.close()
  console.log('Runtime synthetic schema removed and verified')
}

async function seed() {
  await pool.query("INSERT INTO organizations VALUES('org','TEST_ONLY','test-only','active',now(),now())")
  await pool.query("INSERT INTO workspaces(id,organization_id,name,slug,status,created_at,updated_at) VALUES('runtime','org','TEST_ONLY Runtime','runtime','active',now(),now()),('foreign','org','TEST_ONLY Other','foreign','active',now(),now())")
  for (const [id, role] of [['admin','workspace_admin'],['builder','builder'],['reviewer','operator'],['viewer','viewer']]) {
    await pool.query(`INSERT INTO users(id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,failed_login_count,created_at,updated_at)
      VALUES($1,'org',$2,$2,$1,$3,'active',false,0,now(),now())`, [id, `${id}@example.invalid`, await hashPassword('TEST_ONLY Runtime password 42!')])
    await pool.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status,created_at,updated_at) VALUES($1,'runtime',$1,$2,'active',now(),now())", [id,role])
    if (id === 'admin' || id === 'reviewer') await pool.query("INSERT INTO reviewers VALUES($1,'runtime',$1,$1,'reviewer',true,true,now())",[id])
  }
  await pool.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status,created_at,updated_at) VALUES('admin-foreign','foreign','admin','workspace_admin','active',now(),now())")
  await pool.query("INSERT INTO model_providers VALUES('provider','runtime','TEST_ONLY Provider','openai-compatible','https://models.example.invalid/v1','synthetic-model','TEST_ONLY','active','admin',now(),now())")
  await pool.query(`INSERT INTO tool_skill_assets(id,workspace_id,asset_type,name,description,parameter_schema,adapter_type,adapter_config,status,created_by,created_at,updated_at)
    VALUES('test-http-tool','runtime','tool','TEST_ONLY HTTP Tool','','{}','http',$1,'active','admin',now(),now())`,
  [{ url: 'https://tools.example.invalid/lookup', method: 'POST' }])
  const rubric = { id:'rubric',name:'TEST_ONLY 质量量规',artifact:'text',version:'v1.0.0',judgeType:'llm',judgeModel:'synthetic-model',modelProviderId:'provider',passScore:80,gate:'质量',dimensions:[{id:'quality',name:'质量',weight:100,criteria:'有明确证据'}] }
  await pool.query("INSERT INTO rubrics VALUES('rubric','runtime',$1,'text',$2,'质量',80,'llm','synthetic-model','provider','v1.0.0','active',0,now(),now())",[rubric.name,JSON.stringify(rubric.dimensions)])
  await pool.query("INSERT INTO rubric_versions VALUES('rv','runtime','rubric','v1.0.0',$1,now())",[JSON.stringify(rubric)])
  const snapshot = { id:'human-loop',name:'TEST_ONLY 人工闭环',version:'v1.0.0',inputSchema:{},outputSchema:{},
    nodes:[{id:'start',type:'trigger',position:{x:0,y:0},data:{label:'输入',kind:'trigger'}},{id:'human',type:'human',position:{x:300,y:0},data:{label:'人工审核',kind:'human',reviewerIds:['admin','reviewer'],reviewPolicy:'any_one',requiredApprovals:1,assignmentType:'group_claim'}},{id:'end',type:'end',position:{x:600,y:0},data:{label:'完成',kind:'end'}}],
    edges:[{id:'e1',source:'start',target:'human'},{id:'e2',source:'human',target:'end'}] }
  await pool.query("INSERT INTO workflows VALUES('human-loop','runtime',$1,'已发布','v1.0.0',$2,$3,'{}','{}',now(),now())",[snapshot.name,JSON.stringify(snapshot.nodes),JSON.stringify(snapshot.edges)])
  await pool.query("INSERT INTO workflow_versions VALUES('wv','runtime','human-loop','v1.0.0',$1,'TEST_ONLY',now())",[JSON.stringify(snapshot)])
}
try { await seed(); await new Promise((resolve,reject) => { server.once('error',reject); server.listen(48275,'127.0.0.1',resolve) }) }
catch (error) { await close(); throw error }
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => void close().then(() => process.exit(0)))
