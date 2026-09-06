// Isolated loopback PG HTTP-handler races; no application environment or production data.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createFeedbackHandler } from '../netlify/functions/_shared/feedback-candidates/handler.ts'
import { createPostgresFeedbackBackend } from '../netlify/functions/_shared/feedback-candidates/postgres.ts'

const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
const port = Number(process.argv[2] ?? 5432)
assert(Number.isInteger(port) && port > 0 && port < 65536)
const schema = `feedback_identity_${randomUUID().replaceAll('-', '')}`
const connection = { host: '127.0.0.1', port, user: 'postgres', database: 'arc_identity_test', connectionTimeoutMillis: 5000 }
const admin = new Pool(connection)
const pool = new Pool({ ...connection, options: `-c search_path=${schema}`, statement_timeout: 10000 })
const identity = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))
function request(handler, auth, path, method, body) {
  return handler(new Request(`https://synthetic.invalid${path}`, { method,
    headers: { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
try {
  await admin.query(`CREATE SCHEMA ${schema}`)
  for (const name of ['20260904060000_create-arc-one-baseline', '20260904133000_create-identity-rate-limits']) {
    await pool.query(readFileSync(new URL(`../netlify/database/migrations/${name}/migration.sql`, import.meta.url), 'utf8'))
  }
  await pool.query("INSERT INTO organizations VALUES ('org','Synthetic','synthetic','active',now(),now())")
  await pool.query("INSERT INTO workspaces (id,organization_id,name,slug,status,created_at,updated_at) VALUES ('a','org','A','a','active',now(),now())")
  const auth = {}
  for (const id of ['manager', 'expert']) {
    const password = `Synthetic-${randomUUID()}!`
    await pool.query(`INSERT INTO users (id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,failed_login_count,created_at,updated_at)
      VALUES ($1,'org',$2,$2,$1,$3,'active',$4,0,now(),now())`, [id, `${id}@example.invalid`, await hashPassword(password), id === 'manager'])
    await pool.query("INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ($1,'a',$1,'viewer','active',now(),now())", [id])
    const response = await request(identity, { cookie: '', csrf: '' }, '/api/auth/login', 'POST', { email: `${id}@example.invalid`, password })
    assert.equal(response.status, 200)
    const cookie = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
    auth[id] = { cookie, csrf: decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1]) }
  }
  await pool.query("INSERT INTO reviewers (id,workspace_id,user_id,name,role,is_expert,is_active,created_at) VALUES ('reviewer','a','expert','Expert','expert',true,true,now())")
  await pool.query("INSERT INTO artifact_versions (id,workspace_id,artifact_id,version,content,created_by,created_at) VALUES ('modified','a','artifact',1,'after','system',now())")
  await pool.query(`INSERT INTO workflow_runs (id,workspace_id,kind,name,status,input_text,output_text,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at)
    VALUES ('run','a','workflow','Synthetic','完成','input','','',0,0,0,0,0,'','','',now())`)
  await pool.query(`INSERT INTO human_tasks (id,workspace_id,workflow_run_id,node_run_id,human_node_id,source_node_id,artifact_version_id,title,status,assignment_type,review_policy,required_approvals,participant_snapshot,due_at,escalation_at,sla_status,created_at,updated_at)
    VALUES ('task','a','run','node-run','human','node','modified','Synthetic','已通过','group_claim','any_one',1,'[]',now(),now(),'正常',now(),now())`)
  for (const scenario of ['self-reviewer', 'self-revoke-reviewer', 'self-disable-member', 'self-disable-user',
    'reviewer', 'revoke-reviewer', 'disable-member', 'disable-user']) {
    const self = scenario.startsWith('self-')
    const operation = self ? scenario.slice(5) : scenario
    await pool.query("UPDATE users SET is_organization_admin=$1 WHERE id='expert'", [self])
    await pool.query(`INSERT INTO feedback_candidates (id,workspace_id,human_task_id,decision_id,original_version_id,modified_version_id,diff_id,reason,tags,workflow_run_id,source_node_id,created_by,status,created_at)
      VALUES ($1,'a','task',$1,'modified','modified','diff','reason','[]','run','node','reviewer','待确认',now())`, [scenario])
    const reached = deferred(), release = deferred()
    let pid, intercepted = false
    const gatedPool = { async connect() {
      const client = await pool.connect()
      pid = (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid
      return { release: () => client.release(), async query(sql, values) {
        const result = await client.query(sql, values)
        const target = operation !== 'disable-user' ? sql.startsWith('SELECT status FROM users') : sql.includes('LIMIT 1 FOR UPDATE OF s')
        if (!intercepted && target) { intercepted = true; reached.resolve(); await release.promise }
        return result
      } }
    } }
    const feedback = createFeedbackHandler(createPostgresFeedbackBackend(gatedPool))
    const confirmation = request(feedback, auth.expert, `/api/workspaces/a/feedback-candidates/${scenario}/confirm`, 'POST', { reason: 'Confirmed', idempotencyKey: scenario })
    let gateTimeout
    try {
      await Promise.race([reached.promise, new Promise((_, reject) => {
        gateTimeout = setTimeout(() => reject(new Error(`${operation}: confirmation did not reach lock gate`)), 15000)
      })])
    } catch (error) {
      release.resolve()
      await confirmation
      throw error
    } finally { clearTimeout(gateTimeout) }
    const suffix = operation.includes('reviewer') ? 'reviewer' : operation === 'disable-user' ? 'user/disable' : 'disable'
    const method = operation === 'reviewer' ? 'PUT' : operation === 'revoke-reviewer' ? 'DELETE' : 'POST'
    const management = request(identity, self ? auth.expert : auth.manager, `/api/workspaces/a/members/expert/${suffix}`,
      method, operation === 'reviewer' ? { role: 'expert', isExpert: false } : undefined)
    let blockers = []
    try {
      for (let i = 0; i < 300; i++) {
        blockers = (await admin.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rows
        if (blockers.length) break
        await new Promise(r => setTimeout(r, 10))
      }
      assert(blockers.length > 0, 'actual management lock wait')
      console.log(JSON.stringify({ scenario, confirmationPid: pid, blockedManagement: blockers }))
    } finally { release.resolve() }
    const [confirmed, changed] = await Promise.all([confirmation, management])
    assert.equal(confirmed.status, 201, `${operation} confirmation should commit without deadlock`)
    const selfDisable = self && operation.startsWith('disable-')
    assert.equal(changed.status, selfDisable ? 409 : 200, `${scenario} management should resolve without deadlock`)
    if (selfDisable) {
      assert.equal((await changed.json()).detail, operation === 'disable-user' ? '不能停用自己的 User' : '不能停用自己的成员关系')
      assert.equal((await pool.query("SELECT status FROM users WHERE id='expert'")).rows[0].status, 'active')
      assert.equal((await pool.query("SELECT status FROM workspace_memberships WHERE id='expert'")).rows[0].status, 'active')
    }
    assert.equal((await pool.query('SELECT count(*)::int n FROM golden_samples WHERE candidate_id=$1', [scenario])).rows[0].n, 1)
    assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE event_type='golden_sample_confirmed' AND payload->>'candidateId'=$1", [scenario])).rows[0].n, 1)
    const replay = await request(createFeedbackHandler(createPostgresFeedbackBackend(pool)), auth.expert,
      `/api/workspaces/a/feedback-candidates/${scenario}/confirm`, 'POST', { reason: 'Replay', idempotencyKey: scenario })
    assert.equal(replay.status, selfDisable ? 201 : operation === 'disable-user' ? 401 : operation === 'disable-member' ? 404 : 403,
      'committed revocation rejects subsequent replay')
    if (operation.includes('reviewer')) await pool.query("UPDATE reviewers SET is_expert=true,is_active=true WHERE id='reviewer'")
    if (operation === 'disable-member') await pool.query("UPDATE workspace_memberships SET status='active' WHERE id='expert'")
  }
  console.log('PASS: eight actual qualification/member/user HTTP races including same-session self management, replay boundaries, samples and audits')
} finally {
  await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  assert.equal((await admin.query('SELECT nspname FROM pg_namespace WHERE nspname=$1', [schema])).rows.length, 0)
  console.log('PASS: isolated race schema cleanup independently verified')
  await admin.end()
}
