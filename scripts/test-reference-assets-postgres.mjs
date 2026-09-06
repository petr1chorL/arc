// Synthetic fixtures only. No production configuration or credentials are read.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { applyTestMigrations } from './runtime-test-db.mjs'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createReferenceAssetsHandler } from '../netlify/functions/_shared/reference-assets/handler.ts'
import { createPostgresReferenceAssetsBackend } from '../netlify/functions/_shared/reference-assets/postgres.ts'

const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
const port = process.argv[2] ?? '5432'
if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('Local PostgreSQL test port must be an integer between 1 and 65535')
}
const connectionString = `postgresql://postgres@127.0.0.1:${port}/arc_identity_test`
const schema = `assets_test_${randomUUID().replaceAll('-', '')}`
const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 })
const pool = new Pool({ connectionString, options: `-c search_path=${schema}`,
  connectionTimeoutMillis: 5000, statement_timeout: 10_000, max: 4 })
let checks = 0
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++ }
const base = '/api/workspaces/a/model-providers'
const data = { name: 'Synthetic provider', baseUrl: 'https://models.example.invalid/v1',
  defaultModel: 'synthetic', secretRef: 'SYNTHETIC_MODEL_KEY' }
let cookie = '', csrf = ''
const identity = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))
const handler = createReferenceAssetsHandler(createPostgresReferenceAssetsBackend(pool))
function request(path, method = 'GET', body, token = csrf, selected = handler) {
  return selected(new Request(`https://synthetic.invalid${path}`, {
    method, headers: { Cookie: cookie, 'X-CSRF-Token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
}
try {
  await admin.query(`CREATE SCHEMA ${schema}`)
  await applyTestMigrations(pool)
  const now = new Date()
  await pool.query(`INSERT INTO organizations VALUES ('org','Synthetic','synthetic','active',$1,$1)`, [now])
  for (const id of ['a', 'b']) await pool.query(`INSERT INTO workspaces
    (id,organization_id,name,slug,status,created_at,updated_at) VALUES ($1,'org',$1,$1,'active',$2,$2)`, [id, now])
  const password = `Synthetic-${randomUUID()}!`
  await pool.query(`INSERT INTO users
    (id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,
     failed_login_count,created_at,updated_at)
    VALUES ('actor','org','actor@example.invalid','actor@example.invalid','Synthetic',$1,'active',false,0,$2,$2)`,
  [await hashPassword(password), now])
  await pool.query(`INSERT INTO workspace_memberships
    (id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('aa','a','actor','builder','active',$1,$1)`, [now])
  equal((await request(base)).status, 401, 'anonymous denied')
  const login = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password }, '', identity)
  equal(login.status, 200, 'same database real login')
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  csrf = decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
  equal((await request(base, 'POST', data, '')).status, 403, 'CSRF required')
  const created = await request(base, 'POST', data)
  equal(created.status, 201, 'create provider')
  const provider = await created.json()
  equal(provider.status, 'draft', 'provider default remains draft')
  equal(provider.providerType, 'openai-compatible', 'default type')
  equal(provider.createdBy, 'actor', 'authenticated creator')
  equal(Object.keys(provider).sort(), ['id','name','providerType','baseUrl','defaultModel','secretRef',
    'status','createdBy','createdAt','updatedAt'].sort(), 'public projection excludes workspace and internals')
  equal((await request(base, 'POST', data)).status, 409, 'unique name conflict')
  equal((await (await request(base)).json()).length, 1, 'persisted list')
  equal((await request(`${base}/${provider.id}`, 'PATCH', { name: 'Renamed' })).status, 200, 'edit')
  equal((await request(`${base}/${provider.id}`, 'PATCH', { name: null })).status, 422, 'null rejected')
  equal((await request(`${base}/${provider.id}`, 'PATCH', { baseUrl: 'https://user:sentinel@example.invalid' })).status,
    422, 'URL credentials rejected')
  equal((await request(`/api/workspaces/b/model-providers/${provider.id}`, 'PATCH', { name: 'leak' })).status,
    404, 'nonmember workspace concealed')
  await pool.query(`INSERT INTO workspace_memberships
    (id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('ab','b','actor','builder','active',$1,$1)`, [now])
  equal((await request(`/api/workspaces/b/model-providers/${provider.id}`, 'PATCH', { name: 'leak' })).status,
    404, 'asset scope enforced even with membership in both workspaces')
  equal((await request(`${base}/${provider.id}/deactivate`, 'POST')).status, 200, 'builder may deactivate provider')
  equal((await request(`${base}/${provider.id}/deactivate`, 'POST')).status, 200, 'repeated deactivate retained')
  equal((await pool.query(`SELECT status FROM model_providers WHERE id=$1`, [provider.id])).rows[0].status,
    'disabled', 'deactivation persists')
  equal((await pool.query(`SELECT count(*)::int AS n FROM audit_events
    WHERE target_id=$1 AND outcome='success'`, [provider.id])).rows[0].n, 4,
  'only successful create/edit/two deactivations have success audits')
  const parallel = await Promise.all([request(base, 'POST', { ...data, name: 'Concurrent' }),
    request(base, 'POST', { ...data, name: 'Concurrent' })])
  equal(parallel.map(response => response.status).sort(), [201, 409], 'concurrent name uniqueness')
  equal((await pool.query(`SELECT count(*)::int AS n FROM model_providers WHERE name='Concurrent'`)).rows[0].n,
    1, 'concurrent requests persist only one record')
  await pool.query(`ALTER TABLE audit_events ADD CONSTRAINT synthetic_audit_failure
    CHECK (action <> 'model_provider.create') NOT VALID`)
  equal((await request(base, 'POST', { ...data, name: 'Audit failure' })).status, 503, 'audit failure rejects write')
  equal((await pool.query(`SELECT count(*)::int AS n FROM model_providers WHERE name='Audit failure'`)).rows[0].n,
    0, 'asset insert rolls back when audit insert fails')
  await pool.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_audit_failure')
  const aliases = await request(base, 'POST', { name: ' Alias ', provider_type: 'anthropic-compatible',
    base_url: data.baseUrl, default_model: data.defaultModel, secret_ref: data.secretRef, status: 'active' })
  equal(aliases.status, 201, 'snake case accepted')
  equal((await aliases.json()).status, 'draft', 'extra status cannot override default')
  for (const invalid of [{ name: 'x'.repeat(121) }, { secretRef: 'raw-secret-sentinel' },
    { providerType: 'other' }, { name: ' ' }, { name: 17 }]) {
    const rejected = await request(base, 'POST', { ...data, ...invalid })
    equal(rejected.status, 422, 'invalid provider field rejected')
    equal((await rejected.text()).includes('raw-secret-sentinel'), false, 'no raw input reflected')
  }
  const assets = '/api/workspaces/a/asset-library'
  const toolInput = { assetType: 'tool', name: 'Synthetic tool' }
  const toolResponse = await request(assets, 'POST', toolInput)
  equal(toolResponse.status, 201, 'create tool')
  const tool = await toolResponse.json()
  equal([tool.status, tool.adapterType, tool.adapterConfig, tool.parameterSchema, tool.description],
    ['active', 'manual', {}, {}, ''], 'tool defaults preserved')
  equal((await request(assets, 'POST', toolInput)).status, 409, 'tool name conflict')
  equal((await request(assets, 'POST', { ...toolInput, assetType: 'skill' })).status, 201, 'same name different type allowed')
  equal((await (await request(assets)).json()).length, 2, 'list persisted tool and skill')
  equal((await request(`${assets}/${tool.id}`, 'PATCH', { adapterType: 'http' })).status, 422,
    'validate final type/config combination')
  equal((await request(`${assets}/${tool.id}`, 'PATCH', { adapterType: 'http',
    adapterConfig: { url: 'https://tools.example.invalid/run' } })).status, 200, 'configure safe HTTP registration')
  const patched = await (await request(`${assets}/${tool.id}`, 'PATCH', { name: null })).json()
  equal(patched.name, tool.name, 'tool null patch skips field')
  equal(patched.adapterConfig, { url: 'https://tools.example.invalid/run' }, 'implicit POST not inserted in response')
  equal((await request(`${assets}/${tool.id}`, 'PATCH', { assetType: 'skill' })).status, 422, 'patch extra forbidden')
  equal((await request(`${assets}/${tool.id}/deactivate`, 'POST')).status, 403, 'builder cannot deactivate tool')
  equal((await request(`/api/workspaces/b/asset-library/${tool.id}`, 'PATCH', { name: 'leak' })).status,
    404, 'tool workspace isolation')
  await pool.query(`UPDATE workspace_memberships SET role='workspace_admin' WHERE id='aa'`)
  equal((await request(`${assets}/${tool.id}/deactivate`, 'POST')).status, 200, 'admin deactivates tool')
  equal((await request(`${assets}/${tool.id}/deactivate`, 'POST')).status, 200, 'repeated tool deactivate')
  equal((await pool.query(`SELECT count(*)::int AS n FROM audit_events
    WHERE target_id=$1 AND outcome='success'`, [tool.id])).rows[0].n, 5, 'tool writes and audits atomic')
  for (const workspace of ['a', 'b']) {
    await pool.query(`INSERT INTO agents
      (id,workspace_id,name,role,owner,model,model_provider_id,model_provider,model_base_url,temperature,
       max_output_tokens,status,version,pass_rate,runs,tools,skills,tool_asset_refs,skill_asset_refs,
       system_prompt,runtime_manifest,created_at,updated_at)
      VALUES ($1,$2,'Synthetic agent','','','synthetic',$3,'openai-compatible','',0,100,'draft','v1',0,0,
      '[]','[]',$4,'[]','','{}',$5,$5)`,
    [`agent-${workspace}`, workspace, provider.id, JSON.stringify([{ assetId: tool.id }]), now])
    await pool.query(`INSERT INTO agent_versions VALUES ($1,$2,$3,'v1',$4,'',$5)`,
      [`version-${workspace}`, workspace, `agent-${workspace}`, { id: `agent-${workspace}`, name: 'Synthetic agent',
        modelProviderId: provider.id, modelSecretRef: data.secretRef, tools: [tool.name] }, now])
  }
  for (const path of [`${base}/${provider.id}`, `${assets}/${tool.id}`]) {
    const impactResponse = await request(`${path}/impact`)
    equal(impactResponse.status, 200, 'nonempty impact response')
    const impact = await impactResponse.json()
    equal(impact.totals, { draftAgents: 1, publishedVersions: 1 }, 'scope-filtered nonempty counts')
    equal(impact.draftAgents[0].agentId, 'agent-a', 'draft scoped')
    equal(impact.publishedVersions[0].versionId, 'version-a', 'version scoped')
  }
  await pool.query(`UPDATE agent_versions SET snapshot=$1 WHERE id='version-a'`,
    [{ id: 'agent-a', modelProviderId: provider.id, modelSecretRef: 'raw-secret-marker' }])
  const unsafeImpact = await request(`${base}/${provider.id}/impact`)
  equal(unsafeImpact.status, 409, 'snapshot credential blocked')
  equal((await unsafeImpact.text()).includes('raw-secret-marker'), false, 'snapshot credential not echoed')
  await pool.query(`UPDATE agent_versions SET snapshot=$1 WHERE id='version-a'`,
    [{ id: 'agent-a', modelProviderId: provider.id, modelSecretRef: null }])
  equal((await request(`${base}/${provider.id}/impact`)).status, 409, 'explicit null historical secret is not absence')
  await pool.query(`INSERT INTO tool_skill_asset_invocations
    VALUES ('invocation','a',$1,'tool','synthetic-secret-name','agent-a','secret-version',NULL,NULL,
    'succeeded','synthetic-secret-input','synthetic-secret-output','',12,$2)`, [tool.id, new Date()])
  const invocationsResponse = await request(`${assets}/invocations?assetId=${tool.id}&status=succeeded`)
  equal(invocationsResponse.status, 200, 'invocation history implemented')
  const invocations = await invocationsResponse.json()
  equal(invocations.length, 1, 'nonempty filtered invocation history')
  equal(invocations[0].inputSummary, '内容已隐藏（迁移安全策略）', 'summary hidden')
  equal(invocations[0].error, '', 'empty error remains empty')
  equal((await (await request(`${assets}/invocations?status=failed`)).json()).length, 0, 'status filter')
  const toolAuditResponse = await request(`${assets}/${tool.id}/audit-events`)
  equal(toolAuditResponse.status, 200, 'tool audit implemented')
  const toolAudit = await toolAuditResponse.json()
  equal(toolAudit[0].eventType, 'tool_skill_asset.invocation', 'invocations merged by timestamp')
  equal(toolAudit[0].metadata.inputSummary, '内容已隐藏（迁移安全策略）', 'audit summaries hidden')
  const providerAudit = await request(`${base}/${provider.id}/audit-events?limit=2`)
  equal(providerAudit.status, 200, 'provider audit implemented')
  equal((await providerAudit.json()).length, 2, 'provider audit limit')
  equal((await request(`${base}/${provider.id}/audit-events?limit=51`)).status, 422, 'provider limit validation')
  equal((await request(`${assets}/${tool.id}/audit-events?limit=0`)).status, 422, 'tool limit validation')
  const historyHandler = createReferenceAssetsHandler(createPostgresReferenceAssetsBackend(pool), {
    clientAddress: '192.0.2.89',
  })
  const auditRow = (await pool.query(`SELECT * FROM audit_events WHERE target_id=$1
    AND outcome='success' ORDER BY created_at DESC LIMIT 1`, [provider.id])).rows[0]
  for (const [column, value] of [['outcome', 'synthetic-private-state'], ['target_type', 'synthetic-private-type'],
    ['target_id', 'synthetic-missing-target'], ['metadata', []], ['metadata', false], ['metadata', 0],
    ['metadata', { reason: null }]]) {
    await pool.query(`UPDATE audit_events SET metadata=$1 WHERE id=$2`,
      [JSON.stringify({ sourceProviderId: provider.id }), auditRow.id])
    await pool.query(`UPDATE audit_events SET ${column}=$1 WHERE id=$2`,
      [column === 'metadata' ? JSON.stringify(value) : value, auditRow.id])
    const rejected = await request(`${base}/${provider.id}/audit-events`, 'GET', undefined, csrf, historyHandler)
    equal(rejected.status, 409, `invalid audit ${column} rejected`)
    equal(await rejected.json(), { detail: '存在不符合当前安全规则的历史资产或记录，需先完成治理' },
      'audit error contains no original value')
    equal((await pool.query(`SELECT ${column} FROM audit_events WHERE id=$1`, [auditRow.id])).rows[0][column],
      value, 'audit source remains unchanged')
    await pool.query(`UPDATE audit_events SET outcome=$1,target_type=$2,target_id=$3,metadata=$4 WHERE id=$5`,
      [auditRow.outcome, auditRow.target_type, auditRow.target_id, JSON.stringify(auditRow.metadata), auditRow.id])
  }
  for (const snapshot of [[], null, 'synthetic-private-snapshot']) {
    await pool.query(`UPDATE agent_versions SET snapshot=$1 WHERE id='version-a'`, [JSON.stringify(snapshot)])
    for (const path of [`${base}/${provider.id}`, `${assets}/${tool.id}`]) {
      equal((await request(`${path}/impact`, 'GET', undefined, csrf, historyHandler)).status,
        409, 'malformed version JSON fails closed in both impact routes')
    }
  }
  const historyTime = new Date(Date.now() + 60_000)
  for (const [id, action] of [['ordered-a', 'tool_skill_asset.update'], ['ordered-z', 'synthetic-unknown-action']]) {
    await pool.query(`INSERT INTO audit_events
      (id,workspace_id,action,target_type,target_id,outcome,reason,metadata,created_at,before_status,after_status,payload,trace_id)
      VALUES ($1,'a',$2,'tool_skill_asset',$3,'success','synthetic-private-reason',$4,$5,'','','{}','')`,
    [id, action, tool.id, { token: 'synthetic-private-metadata' }, historyTime])
  }
  await pool.query(`UPDATE tool_skill_asset_invocations SET created_at=$1 WHERE id='invocation'`, [historyTime])
  const ordered = await (await request(`${assets}/${tool.id}/audit-events?limit=3`, 'GET', undefined, csrf, historyHandler)).json()
  equal(ordered.map(event => event.id), ['ordered-z', 'ordered-a', 'invocation'], 'equal timestamps use descending IDs')
  equal(ordered[0].eventType, 'unsupported_event', 'unknown action keeps position without raw action')
  equal(ordered[0].metadata, {}, 'unknown metadata is not exposed')
  equal(ordered[0].reason, '内容已隐藏（迁移安全策略）', 'unknown reason hidden')
  equal(JSON.stringify(ordered).includes('synthetic-private'), false, 'no historical sentinel in merged audit')
  const limited = await (await request(`${assets}/${tool.id}/audit-events?limit=2`, 'GET', undefined, csrf, historyHandler)).json()
  equal(limited.map(event => event.id), ['ordered-z', 'ordered-a'], 'limit applies after audit/invocation merge')
  const windowIds = Array.from({ length: 201 }, (_, index) => `window-${index}`)
  await pool.query(`INSERT INTO audit_events
    (id,workspace_id,action,target_type,target_id,outcome,metadata,created_at,reason,before_status,after_status,payload,trace_id)
    SELECT id,'a','unrelated','workspace','a','success','{}'::json,$2,'','','','{}'::json,''
    FROM unnest($1::text[]) AS id`, [windowIds, historyTime])
  equal(await (await request(`${base}/${provider.id}/audit-events`, 'GET', undefined, csrf, historyHandler)).json(),
    [], 'provider relevance filtering occurs after the latest 200 workspace events')
  await pool.query('DELETE FROM audit_events WHERE id=ANY($1::text[])', [windowIds])
  await pool.query(`UPDATE tool_skill_asset_invocations SET agent_id='agent-b' WHERE id='invocation'`)
  equal((await request(`${assets}/invocations`)).status, 409, 'cross-workspace invocation reference blocked')
  await pool.query(`UPDATE tool_skill_asset_invocations SET agent_id='agent-a' WHERE id='invocation'`)
  equal((await pool.query(`SELECT input_summary FROM tool_skill_asset_invocations WHERE id='invocation'`))
    .rows[0].input_summary, 'synthetic-secret-input', 'historical source unchanged')
  await pool.query(`UPDATE tool_skill_assets SET adapter_config=$1 WHERE id=$2`,
    [{ url: 'https://tools.example.invalid/run', apiKey: 'synthetic-historical-marker' }, tool.id])
  const unsafeTools = await request(assets)
  equal(unsafeTools.status, 409, 'unsafe tool history blocked')
  equal((await unsafeTools.text()).includes('synthetic-historical-marker'), false, 'tool history not reflected')
  equal((await request(`${assets}/${tool.id}/deactivate`, 'POST')).status, 409, 'unsafe tool cannot be deactivated and echoed')
  await pool.query(`UPDATE workspace_memberships SET role='viewer' WHERE id='aa'`)
  equal((await request(base)).status, 200, 'viewer reads')
  equal((await request(base, 'POST', { ...data, name: 'Forbidden' })).status, 403, 'viewer cannot write')
  equal((await pool.query(`SELECT count(*)::int AS n FROM audit_events
    WHERE action='model_provider.create' AND outcome='denied'`)).rows[0].n, 1, 'denial audit committed')
  await pool.query(`UPDATE model_providers SET base_url='https://user:historical@example.invalid' WHERE id=$1`, [provider.id])
  const unsafe = await request(base)
  equal(unsafe.status, 409, 'unsafe historical configuration fails closed')
  equal((await unsafe.text()).includes('historical'), false, 'historical payload never reflected')
  await pool.query(`INSERT INTO workspaces
    (id,organization_id,name,slug,status,created_at,updated_at)
    VALUES ('contract','org','Contract','contract','active',$1,$1)`, [now])
  await pool.query(`INSERT INTO workspace_memberships
    (id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('ac','contract','actor','workspace_admin','active',$1,$1)`, [now])
  const cases = JSON.parse(readFileSync(new URL('../fixtures/reference-assets-requests.json', import.meta.url), 'utf8'))
  const legacy = spawnSync(process.argv[3] ?? 'python', ['scripts/reference-assets-contract-python.py'],
    { encoding: 'utf8', timeout: 90_000 })
  equal(legacy.status, 0, `Python asset replay: ${legacy.stderr}`)
  const expected = JSON.parse(legacy.stdout)
  const ids = {}
  for (const [index, testCase] of cases.entries()) {
    let path = testCase.path
    for (const [key, value] of Object.entries(ids)) path = path.replaceAll(`{${key}}`, value)
    const response = await request(`/api/workspaces/contract${path}`, testCase.method, testCase.body)
    const body = await response.json()
    if (testCase.save) ids[testCase.save] = body.id
    equal({ name: testCase.name, status: response.status, body: normalize(body) }, expected[index], testCase.name)
  }
  const permissionsHandler = createReferenceAssetsHandler(createPostgresReferenceAssetsBackend(pool), { clientAddress: '192.0.2.88' })
  for (const role of ['viewer', 'operator', 'builder', 'workspace_admin']) {
    await pool.query(`UPDATE workspace_memberships SET role=$1 WHERE id='ac'`, [role])
    const canWrite = ['builder', 'workspace_admin'].includes(role)
    const canAdmin = role === 'workspace_admin'
    for (const [resource, id, createBody, deactivateAllowed] of [
      ['model-providers', ids.provider, { ...data, name: `${role} provider` }, canWrite],
      ['asset-library', ids.tool, { assetType: 'tool', name: `${role} tool` }, canAdmin],
    ]) {
      const path = `/api/workspaces/contract/${resource}`
      for (const [method, suffix, body, status] of [
        ['GET', '', undefined, 200], ['POST', '', createBody, canWrite ? 201 : 403],
        ['PATCH', `/${id}`, {}, canWrite ? 200 : 403],
        ['POST', `/${id}/deactivate`, undefined, deactivateAllowed ? 200 : 403],
        ['GET', `/${id}/impact`, undefined, 200],
        ['GET', `/${id}/audit-events`, undefined, canAdmin ? 200 : 403],
      ]) equal((await request(path + suffix, method, body, csrf, permissionsHandler)).status,
        status, `${role} ${method} ${resource}${suffix}`)
    }
    equal((await request('/api/workspaces/contract/asset-library/invocations', 'GET', undefined, csrf, permissionsHandler)).status,
      200, `${role} invocation read`)
  }
  await pool.query(`UPDATE workspace_memberships SET status='disabled' WHERE id='ac'`)
  equal((await request('/api/workspaces/contract/model-providers', 'GET', undefined, csrf, permissionsHandler)).status,
    404, 'disabled member cannot read assets')
  await pool.query(`UPDATE workspace_memberships SET status='active' WHERE id='ac'`)
  await pool.query(`INSERT INTO organizations VALUES ('foreign','Foreign','foreign','active',$1,$1)`, [now])
  await pool.query(`INSERT INTO workspaces (id,organization_id,name,slug,status,created_at,updated_at)
    VALUES ('foreign','foreign','Foreign','foreign','active',$1,$1)`, [now])
  equal((await request('/api/workspaces/foreign/model-providers', 'GET', undefined, csrf, permissionsHandler)).status,
    404, 'foreign organization is concealed')
  console.log(JSON.stringify({ postgresReferenceAssetChecks: checks, roleRouteChecks: 52, sharedRequestCases: cases.length,
    sharedRequestsContract: 'matched', productionRouting: 'unchanged' }))
} finally {
  await pool.end()
  // Only this run's generated schema in the fixed loopback fixture database.
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  await admin.end()
}

function normalize(value, key = '') {
  if (Array.isArray(value)) return value.map(item => normalize(item))
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([field, item]) => [field, normalize(item, field)]))
  if (value !== null && ['id','createdBy','actorId','providerId','assetId','targetId'].includes(key)) return '<id>'
  if (value !== null && ['createdAt','updatedAt'].includes(key)) return '<timestamp>'
  return value
}
