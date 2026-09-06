import assert from 'node:assert/strict'
import { approvalOutcome, parseDecision, normalizeJudgeResult } from '../netlify/functions/_shared/runtime-closure/policy.ts'
assert.equal(approvalOutcome('all', 2, ['a','b'], [{reviewer_id:'a',decision:'approve'}]), 'pending')
assert.equal(approvalOutcome('all', 2, ['a','b'], [{reviewer_id:'a',decision:'approve'},{reviewer_id:'b',decision:'modify_and_approve'}]), 'approve')
assert.equal(approvalOutcome('threshold', 2, ['a','b','c'], [{reviewer_id:'a',decision:'approve'},{reviewer_id:'b',decision:'approve'}]), 'approve')
assert.equal(approvalOutcome('any_one', 1, ['a'], [{reviewer_id:'a',decision:'reject'}]), 'reject')
assert.throws(()=>parseDecision({decision:'approve',reason:'ok',artifactVersionId:'v',idempotencyKey:'k',unknown:true}))
assert.throws(()=>parseDecision({decision:'modify_and_approve',reason:'ok',artifactVersionId:'v',idempotencyKey:'k'}))
assert.deepEqual(normalizeJudgeResult({dimensions:[{name:'quality',weight:100}],passScore:80}, {dimensionScores:[{name:'quality',score:85,reason:'grounded'}],rationale:'ok'}), {dimensionScores:[{name:'quality',weight:100,score:85,weightedScore:85,reason:'grounded'}],score:85,status:'passed',rationale:'ok'})
assert.throws(()=>normalizeJudgeResult({dimensions:[{name:'quality',weight:100}],passScore:80},{dimensionScores:[{name:'other',score:99,reason:'bad'}]}))
assert.equal(normalizeJudgeResult({dimensions:[{name:'a',weight:50},{name:'b',weight:50}],passScore:83},{dimensionScores:[{name:'a',score:82,reason:'a'},{name:'b',score:83,reason:'b'}],rationale:'tie'}).score,82,'Python ties-to-even preserves gate outcome')
console.log('runtime closure policy: 9 checks passed')
