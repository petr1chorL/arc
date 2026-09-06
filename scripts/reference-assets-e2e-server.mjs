// Disposable loopback fixture; no environment files or production connection strings.
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { applyTestMigrations } from './runtime-test-db.mjs'
import { createRequire } from 'node:module'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { resolveIdentityWorkspaceRoute } from '../netlify/functions/_shared/identity-workspace/routes.ts'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
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

const port = process.argv[2] ?? '5432'
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid local PG port')
const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
const connectionString = `postgresql://postgres@127.0.0.1:${port}/arc_identity_test`
const schema = `assets_browser_${randomUUID().replaceAll('-', '')}`
const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 })
const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 })
const identityBackend = createPostgresIdentityWorkspaceBackend(pool)
const assetsBackend = createPostgresReferenceAssetsBackend(pool)
const agentsBackend = createPostgresAgentsBackend(pool)
const dataObjectsBackend = createPostgresDataObjectsBackend(pool)
const rubricsBackend = createPostgresRubricsBackend(pool)
const feedbackBackend = createPostgresFeedbackBackend(pool)
const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.url === '/__ready') {
      outgoing.setHeader('Content-Type', 'application/json')
      outgoing.end(JSON.stringify({ service: 'synthetic-reference-assets', schema, port }))
      return
    }
    if (incoming.url === '/__shutdown' && incoming.method === 'POST'
      && incoming.headers['x-arc-synthetic-shutdown'] === '1' && !incoming.headers.origin) {
      outgoing.end('stopping')
      setImmediate(() => { void close().then(() => process.exit(0)) })
      return
    }
    const url = new URL(incoming.url, 'http://127.0.0.1:48273')
    const method = incoming.method ?? 'GET'
    // Test-only allowlist simulates separate browser clients; production never reads this header.
    const testClients = { provider: '192.0.2.1', tool: '192.0.2.2', references: '192.0.2.3', agents: '192.0.2.4', 'data-objects': '192.0.2.5', workflows: '192.0.2.6' }
    const clientAddress = testClients[incoming.headers['x-arc-test-client']] ?? '192.0.2.254'
    const handler = resolveIdentityWorkspaceRoute(method, url.pathname)
      ? createIdentityWorkspaceHandler(identityBackend, { clientAddress })
      : resolveReferenceAssetRoute(method, url.pathname) ? createReferenceAssetsHandler(assetsBackend, { clientAddress })
        : resolveAgentRoute(method, url.pathname) ? createAgentsHandler(agentsBackend, { clientAddress })
          : resolveDataObjectRoute(method, url.pathname) ? createDataObjectsHandler(dataObjectsBackend, { clientAddress })
            : resolveRubricRoute(method, url.pathname) ? createRubricsHandler(rubricsBackend, { clientAddress })
              : resolveFeedbackRoute(method, url.pathname) ? createFeedbackHandler(feedbackBackend, { clientAddress })
                : resolveWorkflowRoute(method, url.pathname) ? createWorkflowsHandler(createPostgresWorkflowsBackend(pool), { clientAddress }) : null
    if (!handler) { outgoing.writeHead(501, { 'Content-Type': 'application/json' }); outgoing.end('{"detail":"接口尚未迁移"}'); return }
    const request = new Request(url, { method, headers: incoming.headers,
      ...(!['GET','HEAD'].includes(method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) })
    const response = await handler(request)
    outgoing.statusCode = response.status
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') outgoing.setHeader(key, value) })
    const cookies = response.headers.getSetCookie()
    if (cookies.length) outgoing.setHeader('set-cookie', cookies)
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    outgoing.writeHead(503); outgoing.end('Synthetic service failure')
  }
})
let closing = false
async function close() {
  if (closing) return
  closing = true
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  await admin.end()
}
try {
  await admin.query(`CREATE SCHEMA ${schema}`)
  await applyTestMigrations(pool)
  const now = new Date()
  await pool.query(`INSERT INTO organizations VALUES ('org','Synthetic','synthetic','active',$1,$1)`, [now])
  await pool.query(`INSERT INTO workspaces (id,organization_id,name,slug,status,created_at,updated_at)
    VALUES ('browser','org','Synthetic','synthetic','active',$1,$1)`, [now])
  await pool.query(`INSERT INTO users (id,organization_id,email,normalized_email,display_name,password_hash,
    status,is_organization_admin,failed_login_count,created_at,updated_at)
    VALUES ('browser','org','browser@example.invalid','browser@example.invalid','Synthetic',$1,'active',true,0,$2,$2)`,
  [await hashPassword('Synthetic browser password 42!'), now])
  await pool.query(`INSERT INTO model_providers VALUES
    ('reference-provider','browser','Referenced provider','openai-compatible','https://models.example.invalid',
     'synthetic','SYNTHETIC_KEY','draft','browser',$1,$1)`, [now])
  await pool.query(`INSERT INTO tool_skill_assets VALUES
    ('reference-tool','browser','tool','Referenced tool','','{}','manual','{}','active','browser',$1,$1)`, [now])
  await pool.query(`INSERT INTO agents
    (id,workspace_id,name,role,owner,model,model_provider_id,model_provider,model_base_url,temperature,
     max_output_tokens,status,version,pass_rate,runs,tools,skills,tool_asset_refs,skill_asset_refs,
     system_prompt,runtime_manifest,created_at,updated_at)
    VALUES ('reference-agent','browser','Referenced Agent','','','synthetic','reference-provider',
    'openai-compatible','',0,100,'draft','v1',0,0,'[]','[]',$1,'[]','','{}',$2,$2)`,
  [JSON.stringify([{ assetId: 'reference-tool', assetType: 'tool', assetName: 'Referenced tool', status: 'active', adapterType: 'manual' }]), now])
  await pool.query(`INSERT INTO agent_versions VALUES
    ('reference-version','browser','reference-agent','v1',$1,'',$2)`,
  [{ id: 'reference-agent', name: 'Referenced Agent', modelProviderId: 'reference-provider',
    modelSecretRef: 'SYNTHETIC_KEY', toolAssetRefs: [{ assetId: 'reference-tool', assetType: 'tool', assetName: 'Referenced tool', status: 'active', adapterType: 'manual' }] }, now])
  await pool.query(`INSERT INTO tool_skill_asset_invocations VALUES
    ('reference-invocation','browser','reference-tool','tool','Referenced tool','reference-agent','v1',NULL,NULL,
    'succeeded','synthetic-private-input','synthetic-private-output','',12,$1)`, [now])
  await seedFeedback(now)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(48200, '127.0.0.1', resolve) })
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { void close().then(() => process.exit(0)) })
} catch (error) {
  await close()
  throw error
}

async function seedFeedback(now) {
  await pool.query(`INSERT INTO users (id,organization_id,email,normalized_email,display_name,password_hash,
    status,is_organization_admin,failed_login_count,created_at,updated_at)
    VALUES ('nonexpert','org','nonexpert@example.invalid','nonexpert@example.invalid','Nonexpert',$1,'active',false,0,$2,$2)`,
  [await hashPassword('Synthetic browser password 42!'), now])
  for (const id of ['browser', 'nonexpert']) {
    await pool.query(`INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status,created_at,updated_at)
      VALUES ($1,'browser',$1,'viewer','active',$2,$2)`, [id, now])
    await pool.query(`INSERT INTO reviewers (id,workspace_id,user_id,name,role,is_expert,is_active,created_at)
      VALUES ($1,'browser',$1,$1,'reviewer',$2,true,$3)`, [id, id === 'browser', now])
  }
  for (const [id, content] of [['original', 'Synthetic original'], ['modified', 'Synthetic revised']]) {
    await pool.query(`INSERT INTO artifact_versions (id,workspace_id,artifact_id,version,content,created_by,created_at)
      VALUES ($1,'browser','artifact',1,$2,'browser',$3)`, [id, content, now])
  }
  await pool.query(`INSERT INTO artifact_diffs
    (id,workspace_id,human_task_id,from_version_id,to_version_id,old_content,new_content,unified_diff,created_at)
    VALUES ('diff','browser','task','original','modified','Synthetic original','Synthetic revised','-original\n+revised',$1)`, [now])
  await pool.query(`INSERT INTO workflow_runs
    (id,workspace_id,kind,name,status,input_text,output_text,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at)
    VALUES ('run','browser','workflow','Synthetic','完成','Synthetic source input','','',0,0,0,0,0,'','','',$1)`, [now])
  await pool.query(`INSERT INTO human_tasks
    (id,workspace_id,workflow_run_id,node_run_id,human_node_id,source_node_id,artifact_version_id,title,status,assignment_type,review_policy,
     required_approvals,participant_snapshot,due_at,escalation_at,sla_status,created_at,updated_at)
    VALUES ('task','browser','run','node-run','human','node','modified','Synthetic','已通过','group_claim','any_one',1,'[]',$1,$1,'正常',$1,$1)`, [now])
  for (const id of ['candidate-expert', 'candidate-denied']) await pool.query(`INSERT INTO feedback_candidates
    (id,workspace_id,human_task_id,decision_id,original_version_id,modified_version_id,diff_id,reason,tags,workflow_run_id,source_node_id,created_by,status,created_at)
    VALUES ($1,'browser','task',$1,'original','modified','diff','Synthetic correction','["synthetic"]','run','node','browser','待确认',$2)`, [id, now])
}
