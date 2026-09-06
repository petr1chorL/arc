// Fixed loopback database, random schema and synthetic identities only; no environment credentials.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createAgentsHandler } from '../netlify/functions/_shared/agents/handler.ts'
import { createPostgresAgentsBackend } from '../netlify/functions/_shared/agents/postgres.ts'
import { testAgentDependencyRaces } from './agent-dependency-race.mjs'

const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
const port = process.argv[2] ?? '5432'
if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid local test port')
const connectionString = `postgresql://postgres@127.0.0.1:${port}/arc_identity_test`
const schema = `agents_test_${randomUUID().replaceAll('-', '')}`
const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 })
const pool = new Pool({ connectionString, options: `-c search_path=${schema}`,
  connectionTimeoutMillis: 5000, statement_timeout: 10_000, max: 4 })
let checks = 0
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++ }
const base = '/api/workspaces/a/agents'
const data = { name: 'Synthetic Agent', role: 'Synthetic role', owner: 'Synthetic owner', model: 'synthetic-model' }
let cookie = '', csrf = ''
const identity = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))
const handler = createAgentsHandler(createPostgresAgentsBackend(pool))
function request(path, method = 'GET', body, token = csrf, selected = handler) {
  return selected(new Request(`https://synthetic.invalid${path}`, {
    method, headers: { Cookie: cookie, 'X-CSRF-Token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
}
try {
  await admin.query(`CREATE SCHEMA ${schema}`)
  for (const name of ['20260904060000_create-arc-one-baseline', '20260904133000_create-identity-rate-limits']) {
    await pool.query(readFileSync(new URL(`../netlify/database/migrations/${name}/migration.sql`, import.meta.url), 'utf8'))
  }
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
  for (const id of ['a', 'b']) await pool.query(`INSERT INTO workspace_memberships
    (id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ($1,$1,'actor','builder','active',$2,$2)`, [id, now])
  equal((await request(base)).status, 401, 'anonymous denied')
  const login = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password }, '', identity)
  equal(login.status, 200, 'same database login')
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  csrf = decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
  equal((await request(base, 'POST', data, '')).status, 403, 'CSRF required')
  const created = await request(base, 'POST', data)
  equal(created.status, 201, 'create Agent draft')
  const agent = await created.json()
  equal([agent.status, agent.version, agent.modelProviderId, agent.modelBaseUrl, agent.temperature,
    agent.maxOutputTokens, agent.tools, agent.skills, agent.runtimeManifest],
  ['调试中', 'v0.1.0', null, '', 0.2, 2000, [], [], {}], 'draft defaults')
  equal((await (await request(`${base}/${agent.id}`)).json()), agent, 'fresh detail matches create')
  equal((await (await request(base)).json()), [agent], 'fresh list persisted')
  // A separate pool reads the exact generated schema, independently of request connections.
  equal((await admin.query(`SELECT name FROM ${schema}.agents WHERE id=$1`, [agent.id])).rows[0].name, data.name, 'committed record')
  equal((await pool.query(`SELECT count(*)::int AS n FROM audit_events WHERE target_id=$1 AND action='agent.create' AND outcome='success'`,
    [agent.id])).rows[0].n, 1, 'one success audit')
  equal((await request(`/api/workspaces/b/agents/${agent.id}`)).status, 404, 'cross-workspace detail denied')
  equal((await request(`${base}/missing`)).status, 404, 'missing Agent')
  equal((await request(`${base}/${agent.id}/test-runs`, 'POST', {})).status, 404, 'execution stays closed')
  await pool.query(`UPDATE workspace_memberships SET role='viewer' WHERE id='a'`)
  equal((await request(base, 'POST', data)).status, 403, 'viewer cannot create')
  equal((await request(base)).status, 200, 'viewer may read')
  await pool.query(`UPDATE workspace_memberships SET role='builder' WHERE id='a'`)
  await pool.query(`ALTER TABLE audit_events ADD CONSTRAINT synthetic_audit_failure CHECK (action <> 'agent.create') NOT VALID`)
  equal((await request(base, 'POST', { ...data, name: 'Must roll back' })).status, 503, 'audit failure rejects create')
  equal((await pool.query(`SELECT count(*)::int AS n FROM agents WHERE name='Must roll back'`)).rows[0].n, 0, 'no partial Agent')
  await pool.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_audit_failure')
  await pool.query(`INSERT INTO model_providers
    (id,workspace_id,name,provider_type,base_url,default_model,secret_ref,status,created_by,created_at,updated_at)
    VALUES ('provider','a','Synthetic Provider','openai-compatible','https://models.example.invalid/v1',
      'bound-model','SYNTHETIC_KEY','draft','actor',$1,$1)`, [now])
  const boundResponse = await request(base, 'POST', { ...data, modelProviderId: 'provider' })
  equal(boundResponse.status, 201, 'draft provider may be bound')
  const bound = await boundResponse.json()
  equal([bound.modelProviderId, bound.modelBaseUrl, bound.model],
    ['provider', 'https://models.example.invalid/v1', 'bound-model'], 'provider configuration copied')
  equal(Object.hasOwn(bound, 'modelSecretRef'), false, 'live Agent excludes provider secret label')
  equal((await request('/api/workspaces/b/agents', 'POST', { ...data, modelProviderId: 'provider' })).status,
    404, 'cross-workspace provider rejected')
  equal((await request(base, 'POST', { ...data, modelProviderId: 'missing' })).status, 404, 'missing provider rejected')
  await pool.query(`UPDATE model_providers SET status='disabled' WHERE id='provider'`)
  equal((await request(base, 'POST', { ...data, modelProviderId: 'provider' })).status, 422, 'disabled provider rejects new binding')
  equal((await request(`${base}/${bound.id}`)).status, 200, 'disabled provider does not invalidate history')
  const aliasResponse = await request(base, 'POST', { ...data, name: ' Alias ', model_provider: 'custom',
    model_base_url: 'https://models.example.invalid', max_output_tokens: '120', temperature: '0.5',
    status: 'online', tools: ['ignored-at-create'], systemPrompt: 'ignored-at-create' })
  equal(aliasResponse.status, 201, 'create aliases and numeric coercion')
  const alias = await aliasResponse.json()
  equal([alias.name, alias.modelProvider, alias.temperature, alias.maxOutputTokens, alias.status, alias.tools, alias.systemPrompt],
    ['Alias', 'custom', 0.5, 120, '调试中', [], ''], 'create extras cannot alter governance state')
  for (const invalid of [{ name: null }, { name: ' ' }, { name: 'x'.repeat(81) }, { temperature: 'synthetic-private' },
    { runtimeManifest: { token: 'synthetic-private' } }, { modelBaseUrl: 'https://user:synthetic-private@models.example.invalid' }]) {
    const rejected = await request(base, 'POST', { ...data, ...invalid })
    equal(rejected.status, 422, 'invalid create body rejected')
    equal(await rejected.json(), { detail: 'Agent 请求字段不符合要求' }, 'fixed input error')
  }
  const storedBefore = (await pool.query('SELECT * FROM agents WHERE id=$1', [agent.id])).rows[0]
  await pool.query('UPDATE agents SET model_base_url=$1 WHERE id=$2', ['https://user:synthetic-private@models.example.invalid', agent.id])
  for (const path of [base, `${base}/${agent.id}`]) {
    const rejected = await request(path)
    equal(rejected.status, 409, 'unsafe historical config blocked')
    equal((await rejected.text()).includes('synthetic-private'), false, 'unsafe history not echoed')
  }
  equal((await pool.query('SELECT model_base_url FROM agents WHERE id=$1', [agent.id])).rows[0].model_base_url,
    'https://user:synthetic-private@models.example.invalid', 'history not rewritten')
  await pool.query('UPDATE agents SET model_base_url=$1,model_provider_id=$2 WHERE id=$3', [storedBefore.model_base_url, 'missing', agent.id])
  equal((await request(`${base}/${agent.id}`)).status, 409, 'missing historical provider blocked')
  equal((await request(`${base}/${alias.id}/deactivate`, 'POST')).status, 403, 'builder cannot deactivate Agent')
  const restoredDraft = await request(`${base}/${alias.id}/activate`, 'POST')
  equal(restoredDraft.status, 200, 'builder may restore Agent')
  equal((await restoredDraft.json()).status, '调试中', 'no versions restores debugging state')
  await pool.query(`UPDATE workspace_memberships SET role='workspace_admin' WHERE id='a'`)
  const deactivated = await request(`${base}/${alias.id}/deactivate`, 'POST')
  equal(deactivated.status, 200, 'admin deactivates Agent')
  equal((await deactivated.json()).status, '已停用', 'deactivation uses approved status')
  equal((await request(`${base}/${alias.id}/deactivate`, 'POST')).status, 200, 'repeated deactivation preserved')
  equal((await request(`/api/workspaces/b/agents/${alias.id}/deactivate`, 'POST')).status, 403, 'capability checked before cross-workspace mutation')
  await pool.query(`UPDATE workspace_memberships SET role='workspace_admin' WHERE id='b'`)
  equal((await request(`/api/workspaces/b/agents/${alias.id}/deactivate`, 'POST')).status, 404, 'cross-workspace Agent concealed from admin')
  const frozen = { ...alias, status: '调试中' }
  await pool.query(`INSERT INTO agent_versions VALUES ('frozen-version','a',$1,'v1.0.0',$2,'synthetic',$3)`, [alias.id, frozen, now])
  const restoredPublished = await request(`${base}/${alias.id}/activate`, 'POST')
  equal(restoredPublished.status, 200, 'restore published Agent')
  equal((await restoredPublished.json()).status, '在线', 'published history restores online')
  equal((await pool.query(`SELECT snapshot FROM agent_versions WHERE id='frozen-version'`)).rows[0].snapshot, frozen, 'lifecycle leaves frozen snapshot unchanged')
  for (const operation of ['deactivate', 'activate']) {
    const before = (await admin.query(`SELECT status,updated_at FROM ${schema}.agents WHERE id=$1`, [alias.id])).rows[0]
    await pool.query(`ALTER TABLE audit_events ADD CONSTRAINT synthetic_lifecycle_failure CHECK (action <> 'agent.${operation}') NOT VALID`)
    equal((await request(`${base}/${alias.id}/${operation}`, 'POST')).status, 503, 'lifecycle audit failure rejects write')
    equal((await admin.query(`SELECT status,updated_at FROM ${schema}.agents WHERE id=$1`, [alias.id])).rows[0], before, 'lifecycle state and time rolled back')
    await pool.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_lifecycle_failure')
  }
  equal((await request(`${base}/${agent.id}/deactivate`, 'POST')).status, 409, 'unsafe history cannot be echoed by deactivate')
  equal((await request(`${base}/${agent.id}/activate`, 'POST')).status, 409, 'unsafe history cannot be echoed by activate')
  const versionResponse = await request(`${base}/${alias.id}/versions`)
  equal(versionResponse.status, 200, 'read persisted versions')
  const versions = await versionResponse.json()
  equal(versions.length, 1, 'one frozen version')
  equal(versions[0].snapshot, frozen, 'version response retains exact snapshot')
  equal(Object.keys(versions[0]).sort(), ['id', 'version', 'snapshot', 'note', 'createdAt'].sort(), 'version public contract')
  equal((await request(`${base}/missing/versions`)).status, 404, 'version lookup requires Agent')
  await pool.query(`INSERT INTO agent_versions VALUES ('foreign-version','b',$1,'v9.0.0',$2,'synthetic',$3)`, [alias.id, frozen, now])
  equal((await (await request(`${base}/${alias.id}/versions`)).json()).length, 1, 'foreign workspace version excluded')
  for (const snapshot of [null, { ...frozen, runtimeManifest: { token: 'synthetic-private' } },
    { ...frozen, modelBaseUrl: 'https://user:synthetic-private@models.example.invalid' },
    { ...frozen, modelProviderId: 'missing' }, { ...frozen, modelSecretRef: 'synthetic-private' }]) {
    await pool.query(`UPDATE agent_versions SET snapshot=$1 WHERE id='frozen-version'`, [JSON.stringify(snapshot)])
    const rejected = await request(`${base}/${alias.id}/versions`)
    equal(rejected.status, 409, 'unsafe snapshot rejected')
    equal((await rejected.text()).includes('synthetic-private'), false, 'unsafe snapshot not echoed')
    equal((await admin.query(`SELECT snapshot FROM ${schema}.agent_versions WHERE id='frozen-version'`)).rows[0].snapshot,
      snapshot, 'snapshot source untouched')
  }
  await pool.query(`UPDATE agent_versions SET snapshot=$1 WHERE id='frozen-version'`, [JSON.stringify(frozen)])
  const editedResponse = await request(`${base}/${alias.id}`, 'PATCH', { name: 'Edited draft', systemPrompt: ' Keep spaces ' })
  equal(editedResponse.status, 200, 'edit draft')
  const edited = await editedResponse.json()
  equal([edited.name, edited.systemPrompt, edited.model, edited.status], ['Edited draft', ' Keep spaces ', alias.model, '在线'], 'patch preserves missing fields and prompt spaces')
  equal((await pool.query(`SELECT snapshot FROM agent_versions WHERE id='frozen-version'`)).rows[0].snapshot, frozen, 'editing does not rewrite version')
  for (const field of ['name', 'role', 'owner', 'model', 'modelProvider', 'modelBaseUrl', 'temperature',
    'maxOutputTokens', 'systemPrompt', 'tools', 'skills', 'runtimeManifest']) {
    equal((await request(`${base}/${alias.id}`, 'PATCH', { [field]: null })).status, 422, 'nonnullable patch rejects null')
  }
  await pool.query(`UPDATE model_providers SET status='draft' WHERE id='provider'`)
  const rebound = await request(`${base}/${alias.id}`, 'PATCH', { modelProviderId: 'provider' })
  equal(rebound.status, 200, 'patch binds provider')
  const detached = await request(`${base}/${alias.id}`, 'PATCH', { modelProviderId: null })
  equal(detached.status, 200, 'explicit null detaches provider')
  const detachedBody = await detached.json()
  equal([detachedBody.modelProviderId, detachedBody.model, detachedBody.modelBaseUrl],
    [null, 'bound-model', 'https://models.example.invalid/v1'], 'detach keeps copied configuration')
  await pool.query(`INSERT INTO tool_skill_assets
    (id,workspace_id,asset_type,name,description,parameter_schema,adapter_type,adapter_config,status,created_by,created_at,updated_at)
    VALUES ('tool','a','tool','Synthetic tool','','{}','manual','{}','active','actor',$1,$1)`, [now])
  const toolBoundResponse = await request(`${base}/${alias.id}`, 'PATCH', { tools: ['Synthetic tool', 'Synthetic tool'] })
  equal(toolBoundResponse.status, 200, 'bind repeated Tool names')
  const toolBound = await toolBoundResponse.json()
  equal(toolBound.toolAssetRefs.map(ref => ref.assetId), ['tool', 'tool'], 'stable refs preserve order and duplicates')
  await pool.query(`UPDATE tool_skill_assets SET status='disabled' WHERE id='tool'`)
  equal((await request(`${base}/${alias.id}`, 'PATCH', { name: 'Must not save' })).status, 422, 'disabled dependency blocks draft save')
  equal((await admin.query(`SELECT name FROM ${schema}.agents WHERE id=$1`, [alias.id])).rows[0].name, 'Edited draft', 'failed dependency saves no name change')
  equal((await request(`${base}/${alias.id}`, 'PATCH', { tools: [] })).status, 200, 'explicit detach repairs disabled dependency')
  for (const status of ['已停用', '宸插仠鐢?']) {
    await pool.query('UPDATE agents SET status=$1 WHERE id=$2', [status, alias.id])
    equal((await request(`${base}/${alias.id}`, 'PATCH', { name: 'Must not save' })).status, 409, 'both disabled states block editing')
  }
  await request(`${base}/${alias.id}/activate`, 'POST')
  const publishHandler = createAgentsHandler(createPostgresAgentsBackend(pool), { clientAddress: '192.0.2.10' })
  const publishRequest = (path, method = 'POST', body) => request(path, method, body, csrf, publishHandler)
  const publishDraft = await (await publishRequest(base, 'POST', { ...data, name: 'Publish draft' })).json()
  const publishPath = `${base}/${publishDraft.id}`
  const firstPublish = await publishRequest(`${publishPath}/publish`, 'POST', { note: ' First ' })
  equal(firstPublish.status, 201, 'publish creates a version')
  const firstVersion = await firstPublish.json()
  equal([firstVersion.version, firstVersion.note, firstVersion.snapshot.status, firstVersion.snapshot.version],
    ['v1.0.0', 'First', '调试中', 'v0.1.0'], 'snapshot captured before publish state changes')
  equal((await (await publishRequest(publishPath, 'GET')).json()).status, '在线', 'publish updates live Agent')
  const secondLogin = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password }, '', identity)
  equal(secondLogin.status, 200, 'independent session for concurrency test')
  const secondCookie = secondLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  equal(secondCookie === cookie, false, 'concurrent writers use distinct auth sessions')
  const secondCsrf = decodeURIComponent(secondCookie.match(/arc_one_csrf=([^;]+)/)[1])
  const parallelVersions = await Promise.all([publishRequest(`${publishPath}/publish`),
    publishHandler(new Request(`https://synthetic.invalid${publishPath}/publish`, {
      method: 'POST', headers: { Cookie: secondCookie, 'X-CSRF-Token': secondCsrf },
    }))])
  equal(parallelVersions.map(response => response.status), [201, 201], 'concurrent publish succeeds serially')
  const bodies = await Promise.all(parallelVersions.map(response => response.json()))
  equal(bodies.map(body => body.version).sort(), ['v1.1.0', 'v1.2.0'], 'concurrent publish gets distinct versions')
  equal((await admin.query(`SELECT snapshot FROM ${schema}.agent_versions WHERE id=$1`, [firstVersion.id])).rows[0].snapshot,
    firstVersion.snapshot, 'old version persists unchanged')
  const beforePublishFailure = (await admin.query(`SELECT status,version,updated_at FROM ${schema}.agents WHERE id=$1`, [publishDraft.id])).rows[0]
  await pool.query(`ALTER TABLE audit_events ADD CONSTRAINT synthetic_publish_failure CHECK (action <> 'agent.publish') NOT VALID`)
  equal((await publishRequest(`${publishPath}/publish`)).status, 503, 'audit failure rejects publish')
  equal((await admin.query(`SELECT status,version,updated_at FROM ${schema}.agents WHERE id=$1`, [publishDraft.id])).rows[0],
    beforePublishFailure, 'failed publish rolls back live state')
  equal((await pool.query('SELECT count(*)::int AS n FROM agent_versions WHERE agent_id=$1', [publishDraft.id])).rows[0].n, 3, 'failed publish leaves no version')
  await pool.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_publish_failure')
  await pool.query('UPDATE agent_versions SET version=$1 WHERE id=$2', ['v1.3.0', firstVersion.id])
  equal((await publishRequest(`${publishPath}/publish`)).status, 409, 'count-based candidate collision rejected')
  equal((await pool.query('SELECT count(*)::int AS n FROM agent_versions WHERE agent_id=$1', [publishDraft.id])).rows[0].n, 3, 'collision leaves no partial version')
  for (const status of ['已停用', '宸插仠鐢?']) {
    await pool.query('UPDATE agents SET status=$1 WHERE id=$2', [status, publishDraft.id])
    equal((await publishRequest(`${publishPath}/publish`)).status, 409, 'disabled state blocks publish')
  }
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/agent-create-requests.json', import.meta.url), 'utf8'))
  const python = spawnSync(process.argv[3] ?? 'python', ['scripts/agent-create-contract-python.py'], {
    input: JSON.stringify(fixture), encoding: 'utf8', timeout: 60000,
  })
  equal(python.status, 0, 'Python synthetic API replay exits successfully')
  const expected = JSON.parse(python.stdout)
  for (const [index, testCase] of fixture.cases.entries()) {
    const response = await request(base, 'POST', { ...fixture.base, ...testCase.patch })
    const actual = { name: testCase.name, status: response.status, body: await response.json() }
    if (testCase.followUps) {
      actual.followUps = []
      for (const followUp of testCase.followUps) {
        const followResponse = await request(`${base}/${actual.body.id}${followUp.suffix}`, followUp.method, followUp.body)
        actual.followUps.push({ status: followResponse.status, body: await followResponse.json() })
      }
    }
    equal(normalize(actual),
      normalize(expected[index]), `shared create contract: ${testCase.name}`)
  }
  // Restore only this test's deliberately corrupted synthetic row before testing successful list access.
  await pool.query('UPDATE agents SET model_provider_id=$1 WHERE id=$2', [storedBefore.model_provider_id, agent.id])
  const matrixHandler = createAgentsHandler(createPostgresAgentsBackend(pool), { clientAddress: '192.0.2.20' })
  const matrixRequest = (path, method = 'GET', body) => request(path, method, body, csrf, matrixHandler)
  const matrixAgentResponse = await matrixRequest(base, 'POST', { ...data, name: 'Role matrix' })
  equal(matrixAgentResponse.status, 201, 'prepare role matrix Agent')
  const matrixAgent = await matrixAgentResponse.json()
  const routes = [
    ['GET', '', undefined, 'read', 200], ['POST', '', data, 'write', 201],
    ['GET', `/${matrixAgent.id}`, undefined, 'read', 200], ['PATCH', `/${matrixAgent.id}`, { name: 'Role matrix' }, 'write', 200],
    ['GET', `/${matrixAgent.id}/versions`, undefined, 'read', 200], ['POST', `/${matrixAgent.id}/publish`, undefined, 'write', 201],
    ['POST', `/${matrixAgent.id}/deactivate`, undefined, 'admin', 200], ['POST', `/${matrixAgent.id}/activate`, undefined, 'write', 200],
  ]
  let roleRouteChecks = 0
  for (const role of ['viewer', 'operator', 'builder', 'workspace_admin']) {
    await pool.query('UPDATE workspace_memberships SET role=$1 WHERE id=$2', [role, 'a'])
    for (const [method, suffix, body, permission, success] of routes) {
      const allowed = permission === 'read' || role === 'workspace_admin' || (permission === 'write' && role === 'builder')
      const before = (await admin.query(`SELECT status,version,name,updated_at FROM ${schema}.agents WHERE id=$1`, [matrixAgent.id])).rows[0]
      const response = await matrixRequest(base + suffix, method, body)
      equal(response.status, allowed ? success : 403, `${role} ${method} ${suffix}`)
      roleRouteChecks++
      if (!allowed) equal((await admin.query(`SELECT status,version,name,updated_at FROM ${schema}.agents WHERE id=$1`,
        [matrixAgent.id])).rows[0], before, 'denied route leaves target unchanged')
    }
  }
  await testAgentDependencyRaces({ pool, admin, schema, cookie, csrf, equal })
  const referenceFields = { assetId: 'tool', assetType: 'tool', assetName: 'Synthetic tool', status: 'active', adapterType: 'manual' }
  const historicalReference = { ...referenceFields, metadata: { token: 'synthetic-private' } }
  await pool.query('UPDATE agents SET tool_asset_refs=$1 WHERE id=$2', [JSON.stringify([historicalReference]), matrixAgent.id])
  const projectedAgent = await matrixRequest(`${base}/${matrixAgent.id}`)
  equal(projectedAgent.status, 200, 'valid historical reference can be read')
  equal((await projectedAgent.json()).toolAssetRefs, [referenceFields], 'live reference projects only public contract fields')
  equal((await admin.query(`SELECT tool_asset_refs FROM ${schema}.agents WHERE id=$1`, [matrixAgent.id])).rows[0].tool_asset_refs,
    [historicalReference], 'reference projection does not rewrite source metadata')
  for (const field of ['assetName', 'status', 'adapterType']) {
    for (const missing of [true, false]) {
      const ref = { ...referenceFields }
      if (missing) delete ref[field]
      else ref[field] = { synthetic: 'private' }
      await pool.query('UPDATE agents SET tool_asset_refs=$1 WHERE id=$2', [JSON.stringify([ref]), matrixAgent.id])
      const rejected = await matrixRequest(`${base}/${matrixAgent.id}`)
      equal(rejected.status, 409, 'historical reference required strings rejected')
      equal(await rejected.json(), { detail: '存在不符合当前安全规则的历史 Agent 或版本，需先完成治理' }, 'historical shape uses fixed error')
      equal((await admin.query(`SELECT tool_asset_refs FROM ${schema}.agents WHERE id=$1`, [matrixAgent.id])).rows[0].tool_asset_refs,
        [ref], 'malformed reference source not rewritten')
    }
  }
  // Confirmed integer-value semantics, preserving raw JSON literals in both HTTP stacks.
  const rawTimeoutStatuses = []
  const remote = fixture.cases.find(item => item.name === 'valid-remote').patch.runtimeManifest
  for (const literal of ['30', '30.0', '3e1', '30.5', 'true', '"30"', '0', '61']) {
    const body = JSON.stringify({ ...data, runtimeManifest: remote }).replace('"timeoutSeconds":30', `"timeoutSeconds":${literal}`)
    const response = await handler(new Request(`https://synthetic.invalid${base}`, {
      method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body,
    }))
    rawTimeoutStatuses.push({ literal, status: response.status })
    equal(response.status, ['30', '30.0', '3e1'].includes(literal) ? 201 : 422, `raw timeout ${literal}`)
  }
  const timeoutPython = spawnSync(process.argv[3] ?? 'python', ['scripts/inspect-agent-timeout-python.py'], {
    encoding: 'utf8', timeout: 60000,
  })
  equal(timeoutPython.status, 0, 'Python raw timeout assertions pass')
  equal(rawTimeoutStatuses, JSON.parse(timeoutPython.stdout), 'raw timeout HTTP contracts match')
  console.log(JSON.stringify({ rawTimeoutStatuses, postgresAgentChecks: checks, roleRouteChecks, dependencyRaceTypes: 3, sharedCreateRequests: fixture.cases.length,
    sharedLifecycleFollowUps: fixture.cases.reduce((count, item) => count + (item.followUps?.length ?? 0), 0),
    sharedCreateContract: 'matched', implemented: ['create', 'list', 'get', 'update', 'versions', 'publish', 'deactivate', 'activate'], productionRouting: 'unchanged' }))
} finally {
  await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  equal((await admin.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1', [schema])).rows[0].n, 0, 'own synthetic schema removed')
  await admin.end()
}

function normalize(value, key = '') {
  if (Array.isArray(value)) return value.map(item => normalize(item))
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([field, item]) => [field, normalize(item, field)]))
  if (key === 'id') return '<id>'
  if (key === 'createdAt' || key === 'updatedAt') return '<timestamp>'
  return value
}
