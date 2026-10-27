import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureFreshIdentity } from '../netlify/functions/_shared/native/bootstrap.ts'
import { verifyPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { runtimeTestDatabase } from './runtime-test-db.mjs'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'

const config = { email: 'Admin@example.invalid', password: 'Synthetic-only-password-47!' }

test('disabled bootstrap touches neither configuration nor database', async () => {
  const forbidden = () => { throw new Error('disabled dependency accessed') }
  const pool = new Proxy({}, { get: forbidden })
  assert.deepEqual(await ensureFreshIdentity(pool, { enabled: false, loadConfig: forbidden }), { status: 'disabled' })
})

test('fresh bootstrap writes hashed identity, membership, audit and completion in one transaction', async () => {
  const calls = []
  const client = {
    async query(sql, values) { calls.push({ sql, values }); return { rows: [] } },
    release() { calls.push({ sql: 'release' }) },
  }
  assert.deepEqual(await ensureFreshIdentity({ connect: async () => client }, { enabled: true, loadConfig: () => config }),
    { status: 'initialized' })
  for (const table of ['organizations', 'users', 'workspaces', 'workspace_memberships', 'audit_events', 'native_bootstrap_state']) {
    assert.equal(calls.filter(call => call.sql.startsWith(`INSERT INTO ${table}`)).length, 1)
  }
  const insertedUser = calls.find(call => call.sql.startsWith('INSERT INTO users'))
  const hash = insertedUser.values.find(value => typeof value === 'string' && value.startsWith('$argon2'))
  assert.ok(await verifyPassword(config.password, hash))
  assert.ok(!JSON.stringify(calls).includes(config.password))
  assert.deepEqual(calls.slice(-2).map(call => call.sql), ['COMMIT', 'release'])
})

test('completed bootstrap does not reload credentials and commits before releasing its client', async () => {
  const calls = []
  const client = {
    async query(sql) { calls.push(sql); return { rows: sql.includes('SELECT') && sql.includes('native_bootstrap_state') ? [{ id: 'arc-one' }] : [] } },
    release() { calls.push('release') },
  }
  const result = await ensureFreshIdentity({ connect: async () => client }, {
    enabled: true, loadConfig() { throw new Error('completed bootstrap read credentials') },
  })
  assert.deepEqual(result, { status: 'already_initialized' })
  assert.equal(calls[0], 'BEGIN')
  assert.ok(calls[1].includes('pg_advisory_xact_lock'))
  assert.deepEqual(calls.slice(-2), ['COMMIT', 'release'])
})

test('connection failures cannot expose credential-bearing driver errors', async () => {
  await assert.rejects(ensureFreshIdentity({ connect: async () => { throw new Error(config.password) } },
    { enabled: true, loadConfig: () => config }), { message: 'Fresh identity initialization failed' })
})

test('release failure is sanitized after commit and a retry retains the completed identity', async () => {
  const calls = []
  let completed = false, releases = 0
  const pool = { async connect() { return {
    async query(sql) {
      calls.push(sql)
      if (sql.startsWith('INSERT INTO native_bootstrap_state')) completed = true
      return { rows: sql.startsWith('SELECT id FROM native_bootstrap_state') && completed ? [{ id: 'arc-one' }] : [] }
    },
    release() { if (++releases === 1) throw new Error('SYNTHETIC_RELEASE_SECRET_SENTINEL') },
  } } }
  await assert.rejects(ensureFreshIdentity(pool, { enabled: true, loadConfig: () => config }),
    { message: 'Fresh identity initialization failed' })
  assert.equal(calls.at(-1), 'COMMIT')
  assert.equal(calls.includes('ROLLBACK'), false)
  assert.equal(completed, true)
  assert.deepEqual(await ensureFreshIdentity(pool, { enabled: true, loadConfig() { throw new Error('credentials reloaded') } }),
    { status: 'already_initialized' })
  assert.equal(calls.filter(sql => sql.startsWith('INSERT INTO users')).length, 1)
})

const identityTables = ['organizations', 'users', 'workspaces', 'workspace_memberships', 'audit_events', 'native_bootstrap_state']
async function counts(pool) {
  return Promise.all(identityTables.map(async table => Number((await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n)))
}

test('PG fresh identity supports real login and session without granting expert qualification or resetting password', async () => {
  const db = await runtimeTestDatabase()
  try {
    assert.deepEqual(await ensureFreshIdentity(db.pool, { enabled: true, loadConfig: () => config }), { status: 'initialized' })
    assert.deepEqual(await counts(db.pool), [1, 1, 1, 1, 1, 1])
    const user = (await db.pool.query('SELECT * FROM users')).rows[0]
    assert.equal(user.id, 'arc-one-admin')
    assert.equal(user.normalized_email, 'admin@example.invalid')
    assert.equal(user.is_organization_admin, true)
    assert.ok(await verifyPassword(config.password, user.password_hash))
    assert.equal((await db.pool.query('SELECT role FROM workspace_memberships')).rows[0].role, 'workspace_admin')
    assert.equal((await db.pool.query('SELECT * FROM reviewers')).rows.length, 0)
    const audit = (await db.pool.query('SELECT * FROM audit_events')).rows[0]
    assert.equal(audit.action, 'identity.bootstrap')
    assert.equal(audit.outcome, 'success')
    assert.ok(!JSON.stringify(audit).includes(config.password))
    assert.ok(!JSON.stringify(audit).includes(config.email))
    assert.deepEqual(await ensureFreshIdentity(db.pool, { enabled: true, loadConfig() { throw new Error('credentials reloaded') } }),
      { status: 'already_initialized' })
    assert.equal((await db.pool.query('SELECT password_hash FROM users')).rows[0].password_hash, user.password_hash)
    const handler = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(db.pool), { clientAddress: '192.0.2.59' })
    const login = await handler(new Request('https://synthetic.invalid/api/auth/login', {
      method: 'POST', body: JSON.stringify(config), headers: { Origin: 'https://synthetic.invalid' },
    }))
    assert.equal(login.status, 200)
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const session = await handler(new Request('https://synthetic.invalid/api/auth/session', { headers: { Cookie: cookie } }))
    assert.equal(session.status, 200)
    assert.ok(JSON.stringify(await session.json()).includes('arc-one-admin'))
  } finally { await db.close() }
})

test('PG invalid or weak configuration leaves no identity, audit or completion receipt', async () => {
  const db = await runtimeTestDatabase()
  try {
    for (const value of [null, [], {}, { ...config, email: 'not-email' }, { ...config, password: 'short' },
      { ...config, password: ' '.repeat(20) }, { ...config, password: 'x'.repeat(1025) }]) {
      await assert.rejects(ensureFreshIdentity(db.pool, { enabled: true, loadConfig: () => value }),
        { message: 'Fresh identity initialization failed' })
      assert.deepEqual(await counts(db.pool), [0, 0, 0, 0, 0, 0])
    }
    await assert.rejects(ensureFreshIdentity(db.pool, { enabled: true, loadConfig() { throw new Error(config.password) } }),
      { message: 'Fresh identity initialization failed' })
    assert.deepEqual(await counts(db.pool), [0, 0, 0, 0, 0, 0])
  } finally { await db.close() }
})

test('PG any preexisting organization, user or workspace rejects without reading initial credentials', async () => {
  const db = await runtimeTestDatabase()
  try {
    const inserts = [
      "INSERT INTO organizations VALUES ('existing','Existing','existing','active',now(),now())",
      `INSERT INTO users(id,organization_id,display_name,status,is_organization_admin,failed_login_count,created_at,updated_at)
        VALUES ('existing','existing','Existing','active',false,0,now(),now())`,
      `INSERT INTO workspaces(id,organization_id,name,slug,status,created_at,updated_at)
        VALUES ('existing','existing','Existing','existing','active',now(),now())`,
    ]
    for (const [index, sql] of inserts.entries()) {
      await db.pool.query(sql)
      const before = await counts(db.pool)
      let reads = 0
      await assert.rejects(ensureFreshIdentity(db.pool, { enabled: true, loadConfig() { reads++; return config } }))
      assert.equal(reads, 0)
      assert.deepEqual(await counts(db.pool), before)
      await db.pool.query(`DELETE FROM ${['organizations', 'users', 'workspaces'][index]} WHERE id='existing'`)
    }
  } finally { await db.close() }
})

test('PG audit failure rolls back every identity row and allows a later clean retry', async () => {
  const db = await runtimeTestDatabase()
  try {
    await db.pool.query(`CREATE FUNCTION reject_bootstrap_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END; $$`)
    await db.pool.query('CREATE TRIGGER reject_bootstrap_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_bootstrap_audit()')
    await assert.rejects(ensureFreshIdentity(db.pool, { enabled: true, loadConfig: () => config }),
      { message: 'Fresh identity initialization failed' })
    assert.deepEqual(await counts(db.pool), [0, 0, 0, 0, 0, 0])
    await db.pool.query('DROP TRIGGER reject_bootstrap_audit ON audit_events')
    assert.deepEqual(await ensureFreshIdentity(db.pool, { enabled: true, loadConfig: () => config }), { status: 'initialized' })
    assert.deepEqual(await counts(db.pool), [1, 1, 1, 1, 1, 1])
  } finally { await db.close() }
})

test('PG concurrent independent sessions block at the transaction lock and initialize only once', async () => {
  const db = await runtimeTestDatabase()
  let unlock
  const barrier = new Promise(resolve => { unlock = resolve })
  let entered
  const locked = new Promise(resolve => { entered = resolve })
  let first, second, firstPid, secondPid, reads = 0
  const wrapped = hold => ({ async connect() {
    const client = await db.pool.connect()
    if (hold) firstPid = client.processID
    else secondPid = client.processID
    return { async query(sql, values) {
      const result = await client.query(sql, values)
      if (hold && sql.includes('pg_advisory_xact_lock')) { entered(); await barrier }
      return result
    }, release: () => client.release() }
  } })
  try {
    const options = { enabled: true, loadConfig() { reads++; return config } }
    first = ensureFreshIdentity(wrapped(true), options)
    await locked
    second = ensureFreshIdentity(wrapped(false), options)
    let blocked = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (secondPid) {
        const row = (await db.pool.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked', [firstPid, secondPid])).rows[0]
        if (row.blocked) { blocked = true; break }
      }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(blocked, true, 'second independent PostgreSQL session must actually wait for first')
    unlock()
    assert.deepEqual(await Promise.all([first, second]), [{ status: 'initialized' }, { status: 'already_initialized' }])
    assert.equal(reads, 1)
    assert.deepEqual(await counts(db.pool), [1, 1, 1, 1, 1, 1])
  } finally {
    unlock()
    await Promise.allSettled([first, second].filter(Boolean))
    await db.close()
  }
})
