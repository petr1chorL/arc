// Synthetic loopback-only database; never reads application environment or production credentials.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createFeedbackHandler } from '../netlify/functions/_shared/feedback-candidates/handler.ts'
import { createPostgresFeedbackBackend } from '../netlify/functions/_shared/feedback-candidates/postgres.ts'

const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
const port = process.argv[2] ?? '5432'
if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid local test port')
const connectionString = `postgresql://postgres@127.0.0.1:${port}/arc_identity_test`
const schema = `feedback_test_${randomUUID().replaceAll('-', '')}`
const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 })
const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000, statement_timeout: 10000 })
const identity = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))
const handler = createFeedbackHandler(createPostgresFeedbackBackend(pool))
let cookie = '', csrf = '', checks = 0
const base = '/api/workspaces/a/feedback-candidates'
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
function request(path, method = 'GET', body, selected = handler, token = csrf) {
  return selected(new Request(`https://synthetic.invalid${path}`, { method,
    headers: { Cookie: cookie, 'X-CSRF-Token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
}
try {
  await admin.query(`CREATE SCHEMA ${schema}`)
  for (const name of ['20260904060000_create-arc-one-baseline', '20260904133000_create-identity-rate-limits']) {
    await pool.query(readFileSync(new URL(`../netlify/database/migrations/${name}/migration.sql`, import.meta.url), 'utf8'))
  }
  const now = new Date()
  await pool.query("INSERT INTO organizations VALUES ('org','Synthetic','synthetic','active',$1,$1)", [now])
  for (const id of ['a', 'b']) await pool.query(`INSERT INTO workspaces
    (id,organization_id,name,slug,status,created_at,updated_at) VALUES ($1,'org',$1,$1,'active',$2,$2)`, [id, now])
  const password = `Synthetic-${randomUUID()}!`
  await pool.query(`INSERT INTO users
    (id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,failed_login_count,created_at,updated_at)
    VALUES ('actor','org','actor@example.invalid','actor@example.invalid','Synthetic',$1,'active',false,0,$2,$2)`, [await hashPassword(password), now])
  await pool.query(`INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('member','a','actor','viewer','active',$1,$1)`, [now])
  equal((await request(base)).status, 401, 'anonymous rejected')
  const login = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password }, identity)
  equal(login.status, 200, 'real login')
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  csrf = decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
  equal(await (await request(base)).json(), [], 'empty workspace')
  for (const [id, content] of [['original', 'before'], ['modified', 'after']]) {
    await pool.query(`INSERT INTO artifact_versions
      (id,workspace_id,artifact_id,version,content,created_by,created_at) VALUES ($1,'a','artifact',1,$2,'system',$3)`, [id, content, now])
  }
  await pool.query(`INSERT INTO artifact_diffs
    (id,workspace_id,human_task_id,from_version_id,to_version_id,old_content,new_content,unified_diff,created_at)
    VALUES ('diff','a','task','original','modified','before','after','-before\n+after',$1)`, [now])
  for (const [id, workspace, date] of [['old', 'a', new Date(now.getTime() - 1000)], ['candidate', 'a', now], ['foreign', 'b', now]]) {
    await pool.query(`INSERT INTO feedback_candidates
      (id,workspace_id,human_task_id,decision_id,original_version_id,modified_version_id,diff_id,reason,tags,
       workflow_run_id,source_node_id,created_by,status,created_at)
      VALUES ($1,$2,'task',$1,'original','modified','diff','reason','["tag"]','run','node','reviewer','待确认',$3)`, [id, workspace, date])
  }
  for (const role of ['viewer', 'operator', 'builder', 'workspace_admin']) {
    await pool.query('UPDATE workspace_memberships SET role=$1 WHERE id=$2', [role, 'member'])
    const list = await request(base)
    equal(list.status, 200, `${role} list`)
    equal((await list.json()).map(row => row.id), ['candidate', 'old'], 'scope and descending order')
    equal((await request(`${base}/candidate`)).status, 200, `${role} detail`)
  }
  const detail = await (await request(`${base}/candidate`)).json()
  equal([detail.originalContent, detail.modifiedContent, detail.unifiedDiff], ['before', 'after', '-before\n+after'], 'source content')
  equal([detail.workflowId, detail.agentId, detail.confirmedAt], [null, null, null], 'explicit nulls')
  equal(Object.keys(detail).sort(), ['id','humanTaskId','originalVersionId','modifiedVersionId','originalContent','modifiedContent',
    'unifiedDiff','reason','tags','workflowRunId','workflowId','agentId','sourceNodeId','createdBy','status','createdAt','confirmedAt'].sort(), 'public fields only')
  equal((await request(`${base}/foreign`)).status, 404, 'foreign candidate')
  equal((await request(`${base}/missing`)).status, 404, 'missing candidate')
  for (const [table, id] of [['artifact_versions', 'original'], ['artifact_versions', 'modified'], ['artifact_diffs', 'diff']]) {
    for (const workspace of ['b', null]) {
      await pool.query(`UPDATE ${table} SET workspace_id=$1 WHERE id=$2`, [workspace, id])
      for (const path of [base, `${base}/candidate`]) {
        const response = await request(path)
        equal(response.status, 409, `${table}/${id} unowned source`)
        equal(await response.json(), { detail: '反馈候选来源不完整，需先完成治理' }, 'fixed source error')
      }
      equal((await pool.query(`SELECT workspace_id FROM ${table} WHERE id=$1`, [id])).rows[0].workspace_id, workspace, 'no source repair')
    }
    await pool.query(`UPDATE ${table} SET workspace_id='a' WHERE id=$1`, [id])
  }
  for (const [column, value] of [['original_version_id', 'original'], ['modified_version_id', 'modified'], ['diff_id', 'diff']]) {
    await pool.query(`UPDATE feedback_candidates SET ${column}='missing' WHERE id='candidate'`)
    for (const path of [base, `${base}/candidate`]) {
      const response = await request(path)
      equal(response.status, 409, `${column} missing source`)
      equal(await response.json(), { detail: '反馈候选来源不完整，需先完成治理' }, 'fixed missing source error')
    }
    equal((await pool.query(`SELECT ${column} FROM feedback_candidates WHERE id='candidate'`)).rows[0][column], 'missing', 'no candidate repair')
    await pool.query(`UPDATE feedback_candidates SET ${column}=$1 WHERE id='candidate'`, [value])
  }
  await pool.query("UPDATE workspace_memberships SET status='disabled' WHERE id='member'")
  equal((await request(base)).status, 404, 'revoked member denied')
  await pool.query("UPDATE workspace_memberships SET status='active' WHERE id='member'")
  equal((await request(`${base}/candidate/confirm`, 'POST', { reason: 'reason', idempotencyKey: 'key' }, handler, '')).status, 403, 'confirmation CSRF')
  equal((await request(`${base}/candidate/confirm`, 'POST', { reason: 'reason', idempotencyKey: 'key' })).status, 403, 'administrator without review qualification denied')
  equal((await pool.query('SELECT count(*)::int AS n FROM golden_samples')).rows[0].n, 0, 'reads did not create samples')
  await pool.query(`INSERT INTO reviewers (id,workspace_id,user_id,name,role,is_expert,is_active,created_at)
    VALUES ('reviewer','a','actor','Synthetic expert','expert',true,true,$1)`, [now])
  await pool.query(`INSERT INTO workflow_runs
    (id,workspace_id,kind,name,status,input_text,output_text,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at)
    VALUES ('run','a','workflow','Synthetic','完成','source input','','',0,0,0,0,0,'','','',$1)`, [now])
  await pool.query(`INSERT INTO human_tasks
    (id,workspace_id,workflow_run_id,node_run_id,human_node_id,source_node_id,artifact_version_id,title,status,assignment_type,review_policy,
     required_approvals,participant_snapshot,due_at,escalation_at,sla_status,created_at,updated_at)
    VALUES ('task','a','run','node-run','human','node','modified','Synthetic','已通过','group_claim','any_one',1,'[]',$1,$1,'正常',$1,$1)`, [now])
  const confirmed = await request(`${base}/candidate/confirm`, 'POST', { reason: 'expert reason', idempotencyKey: 'key' })
  equal(confirmed.status, 201, 'expert confirms controlled sources')
  const sample = await confirmed.json()
  equal([sample.input, sample.expectedOutput, sample.candidateId, sample.reviewerId], ['source input', 'after', 'candidate', 'reviewer'], 'source-derived sample')
  equal((await pool.query("SELECT status FROM feedback_candidates WHERE id='candidate'")).rows[0].status, '已确认', 'candidate committed')
  const audit = (await pool.query("SELECT * FROM audit_events WHERE event_type='golden_sample_confirmed'")).rows
  equal(audit.length, 1, 'human task audit committed')
  equal([audit[0].actor_user_id, audit[0].actor_id, audit[0].human_task_id, audit[0].after_status, audit[0].payload],
    ['actor', 'reviewer', 'task', '已通过', { candidateId: 'candidate', goldenSampleId: sample.id }], 'original audit contract')
  const replay = await request(`${base}/candidate/confirm`, 'POST', { reason: 'must not replace', idempotencyKey: 'key' })
  equal(replay.status, 201, 'idempotent replay')
  equal(await replay.json(), sample, 'replay preserves original sample')
  equal((await request(`${base}/candidate/confirm`, 'POST', { reason: 'r', idempotencyKey: 'other' })).status, 409, 'candidate already confirmed')
  equal((await request(`${base}/old/confirm`, 'POST', { reason: 'r', idempotencyKey: 'key' })).status, 409, 'key belongs to another candidate')
  await pool.query("UPDATE reviewers SET is_expert=false WHERE id='reviewer'")
  equal((await request(`${base}/candidate/confirm`, 'POST', { reason: 'r', idempotencyKey: 'key' })).status, 403, 'replay rechecks expert qualification')
  await pool.query("UPDATE reviewers SET is_expert=true,is_active=false WHERE id='reviewer'")
  equal((await request(`${base}/candidate/confirm`, 'POST', { reason: 'r', idempotencyKey: 'key' })).status, 403, 'replay rechecks active reviewer')
  await pool.query("UPDATE reviewers SET is_active=true WHERE id='reviewer'")
  for (const [table, id] of [['artifact_versions', 'modified'], ['workflow_runs', 'run'], ['human_tasks', 'task']]) {
    await pool.query(`UPDATE ${table} SET workspace_id='b' WHERE id=$1`, [id])
    const rejected = await request(`${base}/old/confirm`, 'POST', { reason: 'r', idempotencyKey: 'old-key' })
    equal(rejected.status, 422, `${table} foreign source rejected`)
    equal(await rejected.json(), { detail: '黄金样本来源不完整，需先完成治理' }, 'confirmation fixed source error')
    equal((await pool.query("SELECT status FROM feedback_candidates WHERE id='old'")).rows[0].status, '待确认', 'rejection left candidate unchanged')
    await pool.query(`UPDATE ${table} SET workspace_id='a' WHERE id=$1`, [id])
  }
  await pool.query(`CREATE FUNCTION reject_sample_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event_type='golden_sample_confirmed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`)
  await pool.query('CREATE TRIGGER reject_sample_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_sample_audit()')
  equal((await request(`${base}/old/confirm`, 'POST', { reason: 'r', idempotencyKey: 'old-key' })).status, 503, 'audit failure rolls back')
  equal((await pool.query('SELECT count(*)::int AS n FROM golden_samples')).rows[0].n, 1, 'no partial second sample')
  equal((await pool.query("SELECT status,confirmed_at FROM feedback_candidates WHERE id='old'")).rows[0],
    { status: '待确认', confirmed_at: null }, 'no partial candidate update')
  equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE event_type='golden_sample_confirmed'")).rows[0].n, 1, 'only original audit exists')
  await pool.query('DROP TRIGGER reject_sample_audit ON audit_events')
  const secondLogin = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password }, identity)
  equal(secondLogin.status, 200, 'independent concurrent session')
  await verifyConfirmationRace(secondLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; '))
  for (const id of ['key-first', 'key-second']) await pool.query(`INSERT INTO feedback_candidates
    (id,workspace_id,human_task_id,decision_id,original_version_id,modified_version_id,diff_id,reason,tags,
     workflow_run_id,source_node_id,created_by,status,created_at)
    VALUES ($1,'a','task',$1,'original','modified','diff','reason','[]','run','node','reviewer','待确认',$2)`, [id, now])
  await verifyConfirmationRace(secondLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; '), true)
  await verifyDependencyLocks(now)
  await verifySharedHttp(now)
  console.log(JSON.stringify({ status: 'passed', checks, scope: 'candidate governance; synthetic sources, not source generation' }))
} finally {
  await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  assert.equal((await admin.query('SELECT nspname FROM pg_namespace WHERE nspname=$1', [schema])).rows.length, 0)
  await admin.end()
  console.log('Synthetic schema cleanup independently verified')
}

async function verifyConfirmationRace(otherCookie, crossCandidate = false) {
  const firstId = crossCandidate ? 'key-first' : 'old'
  const secondId = crossCandidate ? 'key-second' : 'old'
  const key = crossCandidate ? 'cross-candidate-key' : 'race-key'
  let unlock, ready, attempting, firstPid, secondPid, attempts = 0
  const released = new Promise(resolve => { unlock = resolve })
  const locked = new Promise(resolve => { ready = resolve })
  const attempted = new Promise(resolve => { attempting = resolve })
  const observingPool = { async connect() {
    const client = await pool.connect()
    return { release() { client.release() }, async query(sql, values) {
      if (crossCandidate ? sql.startsWith('INSERT INTO golden_samples')
        : sql.startsWith('SELECT * FROM feedback_candidates') && sql.includes('FOR UPDATE')) {
        const turn = ++attempts
        const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
        if (turn === 2) { secondPid = pid; attempting() }
        const result = await client.query(sql, values)
        if (turn === 1) { firstPid = pid; ready(); await released }
        return result
      }
      return client.query(sql, values)
    } }
  } }
  const racing = createFeedbackHandler(createPostgresFeedbackBackend(observingPool))
  const pending = []
  try {
    pending.push(request(`${base}/${firstId}/confirm`, 'POST', { reason: 'concurrent reason', idempotencyKey: key }, racing))
    await bounded(locked, 'first confirmation acquired candidate lock')
    pending.push(racing(new Request(`https://synthetic.invalid${base}/${secondId}/confirm`, { method: 'POST',
      headers: { Cookie: otherCookie, 'X-CSRF-Token': decodeURIComponent(otherCookie.match(/arc_one_csrf=([^;]+)/)[1]) },
      body: JSON.stringify({ reason: 'must not replace concurrent reason', idempotencyKey: key }) })))
    await bounded(attempted, 'second confirmation attempted candidate lock')
    const deadline = Date.now() + 3000
    let blocked = false
    while (Date.now() < deadline) {
      if ((await admin.query('SELECT pg_blocking_pids($1) AS pids', [secondPid])).rows[0].pids.includes(firstPid)) { blocked = true; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    equal(blocked, true, crossCandidate ? 'unique key insertion actually waits for first transaction' : 'second session actually waits on first candidate lock')
  } finally {
    unlock()
    await Promise.allSettled(pending)
  }
  equal((await pending[0]).status, 201, 'first confirmation commits')
  if (crossCandidate) {
    equal((await pending[1]).status, 409, 'losing unique-key transaction rejected')
    equal(await (await pending[1]).json(), { detail: '黄金样本确认冲突，请刷新后重试' }, 'known unique constraint mapped')
    equal((await pool.query('SELECT status,confirmed_at FROM feedback_candidates WHERE id=$1', [secondId])).rows[0],
      { status: '待确认', confirmed_at: null }, 'losing candidate unchanged')
    equal((await pool.query('SELECT count(*)::int AS n FROM golden_samples WHERE candidate_id=$1', [secondId])).rows[0].n, 0, 'no losing sample')
    equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE event_type='golden_sample_confirmed' AND payload->>'candidateId'=$1", [secondId])).rows[0].n, 0, 'no losing audit')
  } else {
    equal((await pending[1]).status, 201, 'second confirmation replays')
    equal(await (await pending[0]).json(), await (await pending[1]).json(), 'concurrent responses same immutable sample')
  }
  equal((await pool.query('SELECT count(*)::int AS n FROM golden_samples WHERE candidate_id=$1', [firstId])).rows[0].n, 1, 'one concurrent sample')
  equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE event_type='golden_sample_confirmed' AND payload->>'candidateId'=$1", [firstId])).rows[0].n, 1, 'one concurrent audit')
}

function bounded(promise, label) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 5000) })])
    .finally(() => clearTimeout(timer))
}

async function verifyDependencyLocks(now) {
  for (const [table, sourceId] of [['reviewers', 'reviewer'], ['artifact_versions', 'modified'], ['workflow_runs', 'run'], ['human_tasks', 'task']]) {
    const candidateId = `lock-${table}`
    await pool.query(`INSERT INTO feedback_candidates
      (id,workspace_id,human_task_id,decision_id,original_version_id,modified_version_id,diff_id,reason,tags,
       workflow_run_id,source_node_id,created_by,status,created_at)
      VALUES ($1,'a','task',$1,'original','modified','diff','reason','[]','run','node','reviewer','待确认',$2)`, [candidateId, now])
    let unlock, ready, publisherPid
    const released = new Promise(resolve => { unlock = resolve })
    const locked = new Promise(resolve => { ready = resolve })
    const observer = { async connect() {
      const client = await pool.connect()
      return { release() { client.release() }, async query(sql, values) {
        if (sql.startsWith('INSERT INTO golden_samples')) {
          publisherPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
          ready(); await released
        }
        return client.query(sql, values)
      } }
    } }
    const racing = createFeedbackHandler(createPostgresFeedbackBackend(observer))
    const writer = await pool.connect()
    const writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const pending = []
    try {
      pending.push(request(`${base}/${candidateId}/confirm`, 'POST', { reason: 'locked source', idempotencyKey: candidateId }, racing))
      await bounded(locked, 'confirmation reached source-locked insertion')
      pending.push(writer.query(table === 'reviewers' ? 'UPDATE reviewers SET is_expert=false WHERE id=$1'
        : `UPDATE ${table} SET workspace_id=workspace_id WHERE id=$1`, [sourceId]))
      const deadline = Date.now() + 3000
      let blocked = false
      while (Date.now() < deadline) {
        if ((await admin.query('SELECT pg_blocking_pids($1) AS pids', [writerPid])).rows[0].pids.includes(publisherPid)) { blocked = true; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      equal(blocked, true, `${table} mutation blocked by confirmation shared lock`)
    } finally {
      unlock()
      await Promise.allSettled(pending)
      writer.release()
    }
    equal((await pending[0]).status, 201, `${table} protected confirmation commits`)
    equal((await pending[1]).rowCount, 1, `${table} mutation completes afterwards`)
    equal((await pool.query('SELECT count(*)::int AS n FROM golden_samples WHERE candidate_id=$1', [candidateId])).rows[0].n, 1, 'protected sample persisted')
    if (table === 'reviewers') {
      equal((await request(`${base}/${candidateId}/confirm`, 'POST', { reason: 'replay', idempotencyKey: candidateId })).status, 403,
        'revoked expert cannot replay after revocation committed')
      await pool.query("UPDATE reviewers SET is_expert=true WHERE id='reviewer'")
    }
  }
}

async function verifySharedHttp(now) {
  await pool.query(`INSERT INTO feedback_candidates
    (id,workspace_id,human_task_id,decision_id,original_version_id,modified_version_id,diff_id,reason,tags,
     workflow_run_id,source_node_id,created_by,status,created_at)
    VALUES ('shared','a','task','shared','original','modified','diff','shared reason','["shared"]','run','node','reviewer','待确认',$1)`, [now])
  const tables = {}
  // Give each synthetic row a distinct timestamp so list order is a contract assertion, not a tie-breaking assumption.
  const ordered = (await pool.query('SELECT id FROM feedback_candidates ORDER BY id')).rows
  for (const [index, row] of ordered.entries()) await pool.query('UPDATE feedback_candidates SET created_at=$1 WHERE id=$2',
    [new Date(now.getTime() + index * 1000), row.id])
  for (const table of ['artifact_versions', 'artifact_diffs', 'workflow_runs', 'human_tasks', 'feedback_candidates', 'golden_samples', 'reviewers']) {
    tables[table] = (await pool.query(`SELECT * FROM ${table}`)).rows
  }
  const cases = [
    { method: 'GET', suffix: '', status: 200 },
    { method: 'GET', suffix: '/shared', status: 200 },
    { method: 'GET', suffix: '/missing', status: 404 },
    { method: 'GET', suffix: '/foreign', status: 404 },
    { method: 'POST', suffix: '/shared/confirm', body: { reason: '', idempotencyKey: 'shared-key' }, status: 422 },
    { method: 'POST', suffix: '/shared/confirm', body: { reason: 'r', idempotencyKey: 'key' }, status: 409 },
    { method: 'POST', suffix: '/missing/confirm', body: { reason: 'r', idempotencyKey: 'shared-key' }, status: 422 },
    { method: 'POST', suffix: '/shared/confirm', body: { reason: ' shared reason ', idempotency_key: ' shared-key ' }, status: 201 },
    { method: 'GET', suffix: '/shared', status: 200 },
    { method: 'POST', suffix: '/shared/confirm', body: { reason: 'do not replace', idempotencyKey: ' shared-key ' }, status: 201 },
    { method: 'POST', suffix: '/shared/confirm', body: { reason: 'r', idempotencyKey: 'different-shared-key' }, status: 409 },
    { method: 'POST', suffix: '/shared/confirm', body: { reason: 'r', idempotencyKey: 'x', expectedOutput: 'forbidden' }, status: 422 },
  ]
  const python = spawnSync(process.argv[3] ?? 'python', ['scripts/feedback-http-python.py'], {
    input: JSON.stringify({ tables, cases }), encoding: 'utf8', timeout: 60000, windowsHide: true,
  })
  assert.equal(python.status, 0, python.stderr)
  const expected = JSON.parse(python.stdout)
  const actual = []
  for (const step of cases) {
    const response = await request(base + step.suffix, step.method, step.body)
    equal(response.status, step.status, `shared HTTP ${step.method} ${step.suffix}`)
    actual.push({ status: response.status, body: await response.json() })
  }
  const normalize = responses => {
    const sampleIds = new Map()
    const visit = body => {
      if (Array.isArray(body)) return body.map(visit)
      return Object.fromEntries(Object.entries(body).map(([key, value]) => {
      if (['createdAt', 'confirmedAt'].includes(key)) return [key, value === null ? null : '<timestamp>']
      if (key === 'id' && Object.hasOwn(body, 'expectedOutput')) {
        if (!sampleIds.has(value)) sampleIds.set(value, `sample-${sampleIds.size}`)
        return [key, sampleIds.get(value)]
      }
      return [key, value]
      }))
    }
    return responses.map(({ status, body }) => ({ status, body: visit(body) }))
  }
  equal(normalize(actual), normalize(expected), 'complete candidate HTTP response contract')
}
