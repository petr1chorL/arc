import test from 'node:test'
import assert from 'node:assert/strict'
import { reserveAcceptanceCall, ACCEPTANCE_BUDGET_ID } from '../netlify/functions/_shared/native/acceptance-budget.ts'
import { runtimeTestDatabase } from './runtime-test-db.mjs'

test('PostgreSQL atomic reservations cap concurrent attempts and survive new clients', async () => {
  const db = await runtimeTestDatabase()
  try {
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => reserveAcceptanceCall(() => db.pool)))
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 20)
    assert.equal(results.filter(item => item.status === 'rejected').length, 20)
    assert.deepEqual((await db.pool.query('SELECT * FROM native_acceptance_budget')).rows,
      [{ id: ACCEPTANCE_BUDGET_ID, reserved_calls: 20 }])
    await assert.rejects(reserveAcceptanceCall(() => db.pool), /预算不可用或已用尽/)
  } finally { await db.close() }
})
