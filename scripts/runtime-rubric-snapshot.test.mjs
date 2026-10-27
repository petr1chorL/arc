import test from 'node:test'
import assert from 'node:assert/strict'
import { pinnedRubric } from '../netlify/functions/_shared/runtime-closure/evaluation.ts'
import { normalizeRuntimeRubricSnapshot } from '../netlify/functions/_shared/runtime-closure/rubric-snapshot.ts'

// The storage format is emitted by rubrics/postgres.ts; the separate PG test uses its real publisher.
const published = { id: 'rubric', name: 'Published rubric', artifact: 'text', gate: 'accurate',
  judge_type: 'llm', judge_model: 'qwen3.8-flash', model_provider_id: 'provider', pass_score: 60,
  version: 'v1.0.0', status: 'active', dimensions: [{ id: 'quality', name: 'Quality', weight: 100, criteria: 'Accurate' }] }
const client = { async query(sql) {
  if (sql.includes('FROM rubric_versions')) return { rows: [{ id: 'version', version: 'v1.0.0', snapshot: published }] }
  if (sql.includes('FROM model_providers')) return { rows: [{ base_url: 'https://synthetic.invalid/v1', secret_ref: 'SYNTHETIC_REF' }] }
  throw Error('unexpected synthetic query')
} }
test('pinned evaluation reads the actual snake-case publication format without changing it', async () => {
  const before = JSON.stringify(published)
  const snapshot = await pinnedRubric(client, 'space', 'rubric')
  assert.equal(snapshot.judgeType, 'llm'); assert.equal(snapshot.judgeModel, 'qwen3.8-flash')
  assert.equal(snapshot.modelProviderId, 'provider'); assert.equal(snapshot.passScore, 60)
  assert.equal(snapshot.versionId, 'version')
  assert.equal(JSON.stringify(published), before)
})

test('legacy camel-case snapshots preserve their request identity and gate threshold', () => {
  const legacy = { id: 'rubric', judgeType: 'llm', judgeModel: 'qwen3.8-flash', modelProviderId: 'provider',
    passScore: 60, dimensions: published.dimensions }
  assert.deepEqual(normalizeRuntimeRubricSnapshot(legacy), legacy)
  assert.notEqual(normalizeRuntimeRubricSnapshot(legacy), legacy)
})

test('snake-case deterministic snapshots retain an explicit deterministic mode', () => {
  const result = normalizeRuntimeRubricSnapshot({ ...published, judge_type: 'deterministic', judge_model: '', model_provider_id: null })
  assert.equal(result.judgeType, 'deterministic'); assert.equal(result.passScore, 60)
})

test('conflicting aliases and missing or invalid judge configuration fail before execution', () => {
  for (const patch of [{ judgeType: 'deterministic' }, { passScore: 99 }, { judgeModel: 'other' },
    { modelProviderId: 'other' }, { judge_type: undefined }, { judge_type: 'other' },
    { judge_type: new String('llm') }, { judge_model: '' }, { model_provider_id: null },
    { pass_score: '60' }, { pass_score: -1 }, { dimensions: [] }]) {
    assert.throws(() => normalizeRuntimeRubricSnapshot({ ...published, ...patch }), { status: 409 })
  }
})

test('the same explicit aliases may coexist without modifying stored history', () => {
  const both = { ...published, judgeType: 'llm', passScore: 60 }
  const before = JSON.stringify(both), result = normalizeRuntimeRubricSnapshot(both)
  assert.equal(result.judgeType, 'llm'); assert.equal(result.passScore, 60)
  assert.equal(Object.hasOwn(result, 'judge_type'), false)
  assert.equal(JSON.stringify(both), before)
})
