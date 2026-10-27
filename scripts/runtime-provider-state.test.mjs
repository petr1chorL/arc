import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createGatewayJudgeTransport } from '../netlify/functions/_shared/runtime-closure/evaluation.ts'
import { NotSentError } from '../netlify/functions/_shared/runtime/types.ts'

// Execute the actual ANSI provider SELECT in-memory; PostgreSQL integrations remain separate.
function fixture(status) {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE model_providers(id TEXT,workspace_id TEXT,status TEXT,base_url TEXT,secret_ref TEXT)')
  db.prepare('INSERT INTO model_providers VALUES(?,?,?,?,?)').run('provider', 'space', status, 'https://synthetic.invalid/v1', 'SYNTHETIC_REF')
  const pool = { async connect() { return { async query(sql, values) {
    return { rows: db.prepare(sql).all(Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v]))) }
  }, release() {} } } }
  return { db, pool }
}
const request = { workspaceId: 'space', providerId: 'provider', model: 'synthetic',
  messages: [{ role: 'system', content: 'Synthetic judge' }, { role: 'user', content: 'Synthetic input' }], responseFormat: { type: 'json_object' } }

test('a newly registered draft Provider reaches the configured judge gateway', async () => {
  const { db, pool } = fixture('draft'); let calls = 0
  try {
    const judge = createGatewayJudgeTransport(pool, async input => {
      calls++; assert.equal(input.secretRef, 'SYNTHETIC_REF')
      return { content: '{}', model: 'synthetic', promptTokens: 1, completionTokens: 1, costUsd: 0 }
    })
    await judge(request)
    assert.equal(calls, 1)
  } finally { db.close() }
})

for (const status of ['ready', 'active']) test(`${status} Provider remains compatible`, async () => {
  const { db, pool } = fixture(status)
  try {
    const result = await createGatewayJudgeTransport(pool, async () => ({ content: '{}', model: 'synthetic',
      promptTokens: 1, completionTokens: 1, costUsd: 0 }))(request)
    assert.equal(result.model, 'synthetic')
  } finally { db.close() }
})

for (const [label, status, patch] of [
  ['disabled', 'disabled', {}],
  ['foreign Workspace', 'draft', { workspaceId: 'foreign' }],
  ['missing Provider', 'draft', { providerId: 'missing' }],
  ['changed pinned binding', 'draft', { providerBindingHash: 'old-binding' }],
]) test(`${label} is rejected before any gateway invocation`, async () => {
  const { db, pool } = fixture(status); let calls = 0
  try {
    const judge = createGatewayJudgeTransport(pool, async () => { calls++; throw Error('must not invoke') })
    await assert.rejects(judge({ ...request, ...patch }), error => error instanceof NotSentError)
    assert.equal(calls, 0)
  } finally { db.close() }
})
