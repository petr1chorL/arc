// Real publisher-to-runtime integration, isolated loopback PostgreSQL and synthetic model transport only.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { runtimeTestDatabase } from './runtime-test-db.mjs'
import { ensureFreshIdentity } from '../netlify/functions/_shared/native/bootstrap.ts'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { createReferenceAssetsHandler } from '../netlify/functions/_shared/reference-assets/handler.ts'
import { createPostgresReferenceAssetsBackend } from '../netlify/functions/_shared/reference-assets/postgres.ts'
import { createRubricsHandler } from '../netlify/functions/_shared/rubrics/handler.ts'
import { createPostgresRubricsBackend } from '../netlify/functions/_shared/rubrics/postgres.ts'
import { runtimeWithTransaction, enqueueOperation } from '../netlify/functions/_shared/runtime/ledger.ts'
import { pinnedRubric, enqueueEvaluation, createClosureExecutor, createGatewayJudgeTransport,
  createWorkflowEvaluator } from '../netlify/functions/_shared/runtime-closure/evaluation.ts'

const db = await runtimeTestDatabase(), pool = db.pool
const workspaceId = 'arc-one', actorId = 'arc-one-admin'
const origin = 'https://synthetic.invalid', rubricBase = `/api/workspaces/${workspaceId}/evaluations/rubrics`
let checks = 0
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++ }
try {
  const email = 'rubric-publication@example.invalid', password = `Synthetic-${randomUUID()}!`
  await ensureFreshIdentity(pool, { enabled: true, loadConfig: () => ({ email, password }) })
  const identity = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))
  const providers = createReferenceAssetsHandler(createPostgresReferenceAssetsBackend(pool))
  const rubrics = createRubricsHandler(createPostgresRubricsBackend(pool))
  let cookie = '', csrf = ''
  const call = (handler, path, method = 'GET', body) => handler(new Request(origin + path, {
    method, headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  const login = await call(identity, '/api/auth/login', 'POST', { email, password })
  equal(login.status, 200, 'actual identity login')
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  csrf = decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
  equal((await call(identity, '/api/auth/session')).status, 200, 'persisted session is authenticated')

  const providerResponse = await call(providers, `/api/workspaces/${workspaceId}/model-providers`, 'POST', {
    name: 'Synthetic rubric publisher provider', providerType: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1',
    defaultModel: 'synthetic-judge', secretRef: 'SYNTHETIC_JUDGE_KEY',
  })
  equal(providerResponse.status, 201, 'real reference API creates provider')
  const provider = await providerResponse.json()
  equal(provider.status, 'draft', 'real newly created provider stays draft')

  async function publish(judgeType) {
    const body = { name: `Synthetic published ${judgeType}`, artifact: 'Report', gate: 'Required', passScore: 80,
      dimensions: [{ id: 'quality', name: 'Quality', weight: 100, criteria: 'Grounded in source evidence' }],
      judgeType, ...(judgeType === 'llm' ? { judgeModel: 'synthetic-judge', modelProviderId: provider.id } : {}) }
    const created = await call(rubrics, rubricBase, 'POST', body)
    equal(created.status, 201, `${judgeType}: real rubric creation`)
    const rubric = await created.json()
    const published = await call(rubrics, `${rubricBase}/${rubric.id}/publish`, 'POST')
    equal(published.status, 201, `${judgeType}: real immutable publication`)
    const version = await published.json()
    const stored = (await pool.query('SELECT snapshot FROM rubric_versions WHERE id=$1', [version.id])).rows[0].snapshot
    equal(stored.judge_type, judgeType, `${judgeType}: publisher really stores snake_case`)
    equal(stored.pass_score, 80, `${judgeType}: publisher stores pass_score`)
    for (const field of ['judgeType', 'judgeModel', 'passScore', 'modelProviderId']) {
      equal(Object.hasOwn(stored, field), false, `${judgeType}: no forged transport alias ${field}`)
    }
    if (judgeType === 'llm') {
      equal(stored.judge_model, 'synthetic-judge', 'LLM model is stored in snake_case')
      equal(stored.model_provider_id, provider.id, 'LLM binding is stored in snake_case')
    }
    return { rubric, version, stored }
  }

  const published = await publish('llm')
  const pinned = await runtimeWithTransaction(pool, client => pinnedRubric(client, workspaceId, published.rubric.id))
  equal(pinned.judgeType, 'llm', 'pin normalizes real snake_case publisher snapshot')
  equal(pinned.judgeModel, 'synthetic-judge', 'pin preserves published model')
  equal(pinned.modelProviderId, provider.id, 'pin preserves published provider')
  equal(pinned.passScore, 80, 'pin preserves published threshold')
  equal(pinned.versionId, published.version.id, 'pin uses the actual immutable version')

  let modelCalls = 0
  const judge = createGatewayJudgeTransport(pool, async request => {
    modelCalls++
    equal(request.workspaceId, workspaceId, 'model workspace remains scoped')
    equal(request.baseUrl, 'https://synthetic.invalid/v1', 'draft provider resolved from real persisted row')
    equal(request.secretRef, 'SYNTHETIC_JUDGE_KEY', 'only synthetic reference reaches mock')
    equal(request.model, 'synthetic-judge', 'published model reaches mock transport')
    const input = JSON.parse(request.userInput)
    equal(input.rubric.versionId, published.version.id, 'real published identity reaches judge')
    return { content: JSON.stringify({ dimensionScores: [{ dimensionId: 'quality', score: 90, reason: 'supported' }], rationale: 'grounded' }),
      model: 'synthetic-judge', promptTokens: 5, completionTokens: 3, costUsd: 0.01 }
  })
  const effects = new Map()
  const context = { pool, transaction: fn => runtimeWithTransaction(pool, fn),
    effect: async (key, _input, send) => {
      if (!effects.has(key)) effects.set(key, await send())
      return effects.get(key)
    } }
  const closure = createClosureExecutor({ judge })
  const operation = await runtimeWithTransaction(pool, client => enqueueEvaluation(client, workspaceId, published.rubric.id,
    { artifactText: 'source evidence', subjectType: 'text' }, actorId, 'actual-publication-closure'))
  const result = await closure(operation, context)
  equal(result.score, 90, 'closure consumes actual published LLM rubric')
  equal(result.status, 'passed', 'closure applies published pass threshold')
  equal(result.evaluatorType, 'llm', 'closure persists real evaluator kind')
  equal(result.costUsd, 0.01, 'synthetic transport cost remains attached')
  equal((await closure(operation, context)).id, result.id, 'closure replay returns persisted evaluation')
  equal(modelCalls, 1, 'closure replay does not send a second model request')

  const workflowRunId = randomUUID()
  const workflowOperation = await runtimeWithTransaction(pool, async client => {
    await client.query(`INSERT INTO workflow_runs(id,workspace_id,kind,name,status,input_text,output_text,model,
      prompt_tokens,completion_tokens,total_tokens,cost_usd,duration_ms,current_node,error,trace_id,started_at)
      VALUES($1,$2,'workflow','Synthetic publication evaluation','运行中','source evidence','','',0,0,0,0,0,'','',$3,now())`,
    [workflowRunId,workspaceId,`trace-${workflowRunId}`])
    return enqueueOperation(client, { workspaceId, kind: 'workflow.run', actorId,
      idempotencyKey: 'actual-publication-workflow', targetId: workflowRunId, input: {} })
  })
  const workflowArgs = { rubricRef: { rubricId: published.rubric.id, versionId: published.version.id, version: published.version.version },
    artifactText: 'source evidence', subjectId: randomUUID(), runId: workflowOperation.target_id, nodeRunId: randomUUID() }
  const workflowEvaluator = createWorkflowEvaluator(judge)
  const workflowResult = await workflowEvaluator(workflowOperation, context, workflowArgs)
  equal(workflowResult.score, 90, 'workflow evaluator consumes real published LLM rubric')
  const output = JSON.parse(workflowResult.content)
  equal(output.passed, true, 'workflow output passed')
  equal(output.modelProviderId, provider.id, 'workflow output preserves published binding')
  equal(output.templateVersion, published.version.version, 'workflow output references immutable rubric version')
  equal((await workflowEvaluator(workflowOperation, context, workflowArgs)).content, workflowResult.content, 'workflow replay returns same persisted output')
  equal(modelCalls, 2, 'exactly one model request per independent evaluation')
  const persisted = (await pool.query('SELECT score,evaluator_type,rubric_version FROM evaluations WHERE workspace_id=$1 ORDER BY created_at,id', [workspaceId])).rows
  equal(persisted.length, 2, 'both evaluator paths persist results')
  for (const record of persisted) equal(record, { score: 90, evaluator_type: 'llm', rubric_version: published.version.version }, 'persisted real-publisher result')
  equal((await pool.query('SELECT snapshot FROM rubric_versions WHERE id=$1', [published.version.id])).rows[0].snapshot,
    published.stored, 'normalization never rewrites immutable publisher storage')

  const deterministic = await publish('deterministic')
  const deterministicOperation = await runtimeWithTransaction(pool, client => enqueueEvaluation(client, workspaceId, deterministic.rubric.id,
    { artifactText: 'source evidence', subjectType: 'text' }, actorId, 'actual-publication-deterministic'))
  const deterministicResult = await closure(deterministicOperation, context)
  equal(deterministicResult.evaluatorType, 'deterministic', 'real deterministic publication executes')
  equal(deterministicResult.score, 51, 'deterministic actual-publisher score matches known signals')
  equal(deterministicResult.status, 'failed', 'score below the immutable threshold does not pass')
  equal(deterministicResult.costUsd, 0, 'deterministic has no model cost')
  const deterministicWorkflow = await workflowEvaluator(workflowOperation, context, { ...workflowArgs, nodeRunId: randomUUID(),
    rubricRef: { rubricId: deterministic.rubric.id, versionId: deterministic.version.id, version: deterministic.version.version } })
  equal(deterministicWorkflow.score, 51, 'workflow consumes real deterministic publication')
  equal(JSON.parse(deterministicWorkflow.content).passed, false, 'workflow preserves a failed quality gate result')
  equal(modelCalls, 2, 'neither deterministic execution sends a model request')
  equal((await pool.query('SELECT snapshot FROM rubric_versions WHERE id=$1', [deterministic.version.id])).rows[0].snapshot,
    deterministic.stored, 'deterministic publisher storage remains unchanged')
  equal((await pool.query('SELECT count(*)::int n FROM evaluations WHERE workspace_id=$1', [workspaceId])).rows[0].n, 4,
    'LLM and deterministic closure/workflow results all persist')
  console.log(`Actual rubric publication runtime PostgreSQL: ${checks} checks passed; real HTTP publisher, synthetic transport only.`)
} finally { await db.close() }
