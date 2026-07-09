const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]
  if (!key.startsWith('--')) continue
  const next = process.argv[index + 1]
  if (next && !next.startsWith('--')) {
    args.set(key.slice(2), next)
    index += 1
  } else {
    args.set(key.slice(2), 'true')
  }
}

const apiUrl = (args.get('api-url') ?? process.env.ARC_ONE_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '')
const workspaceSlug = args.get('workspace-slug') ?? process.env.ARC_ONE_WORKSPACE_SLUG ?? 'ai-capability-center'
const email = args.get('email') ?? process.env.ARC_ONE_ACCEPTANCE_EMAIL
const password = args.get('password') ?? process.env.ARC_ONE_ACCEPTANCE_PASSWORD
const ensureReviewer = args.get('ensure-reviewer') !== 'false'

if (!email || !password) {
  throw new Error('Missing acceptance credentials. Set ARC_ONE_ACCEPTANCE_EMAIL and ARC_ONE_ACCEPTANCE_PASSWORD, or pass --email and --password.')
}

const cookies = new Map()

function storeCookies(headers) {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean)
  for (const header of values) {
    const [pair] = header.split(';')
    const separator = pair.indexOf('=')
    if (separator < 0) continue
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1)
    if (!value || header.toLowerCase().includes('max-age=0')) {
      cookies.delete(name)
    } else {
      cookies.set(name, value)
    }
  }
}

function cookieHeader() {
  return [...cookies.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

async function api(path, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase()
  const headers = new Headers(options.headers)
  const cookie = cookieHeader()
  if (cookie) headers.set('Cookie', cookie)
  const csrfToken = cookies.get('arc_one_csrf')
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRF-Token', csrfToken)
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    method,
    headers,
  })
  storeCookies(response.headers)
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const detail = data?.detail ?? text
    throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${Array.isArray(detail) ? detail.join('; ') : detail}`)
  }
  return data
}

function findByName(records, expectedName, label) {
  const record = records.find((item) => item.name === expectedName)
  if (!record) {
    throw new Error(`${label} not found: ${expectedName}. Run scripts/seed-v1-lite.ps1 first.`)
  }
  return record
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const session = await api('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
})
const workspaces = await api('/api/workspaces')
const workspace = workspaces.find((item) => item.slug === workspaceSlug)
if (!workspace) {
  throw new Error(`Workspace not found: ${workspaceSlug}`)
}

let currentReviewer = null
if (ensureReviewer) {
  try {
    await api(`/api/workspaces/${workspace.id}/members/${session.user.id}/reviewer`, {
      method: 'PUT',
      body: JSON.stringify({ role: 'V1 Lite 验收人', isExpert: true }),
    })
  } catch (error) {
    throw new Error(`Cannot grant current user Reviewer qualification. Use a Workspace admin/organization admin account, or pass --ensure-reviewer false if the account is already the seeded Reviewer. ${error.message}`)
  }
}
const reviewers = await api(`/api/workspaces/${workspace.id}/reviewers`)
currentReviewer = reviewers.find((reviewer) => reviewer.userId === session.user.id)
if (!currentReviewer) {
  throw new Error('Current user has no active Reviewer qualification in this Workspace.')
}

const workflows = await api(`/api/workspaces/${workspace.id}/workflows`)
const workflow = findByName(workflows, 'AI 赋能方案 V1.0 Lite 试点工作流', 'Workflow')
const rubrics = await api(`/api/workspaces/${workspace.id}/evaluations/rubrics`)
const rubric = findByName(rubrics, 'AI 赋能方案 V1.0 Lite Rubric', 'Rubric')
const sampleSets = await api(`/api/workspaces/${workspace.id}/evaluations/sample-sets`)
const sampleSet = findByName(sampleSets, 'AI 赋能方案 V1.0 Lite Golden Set', 'Golden Set')

const runInput = {
  sourceNotes: '安克 AI 课程笔记与个人思维导图摘要',
  businessContext: '希望构建一个企业 AI 赋能平台，用于编排 Agent、人工审核和质量评分',
  desiredOutput: '平台落地路线与一个可执行试点流程',
  riskConcerns: '不要大而全失控，先快速试点；质量评分体系要可落地',
}
const pausedRun = await api(`/api/workspaces/${workspace.id}/workflows/${workflow.id}/runs`, {
  method: 'POST',
  body: JSON.stringify({ input: JSON.stringify(runInput) }),
})
if (!['等待审核', '审核中'].includes(pausedRun.status)) {
  throw new Error([
    `Expected Workflow Run to pause for Human Review, got status: ${pausedRun.status}.`,
    `Run ID: ${pausedRun.id}`,
    `Current node: ${pausedRun.currentNode ?? pausedRun.current_node ?? 'unknown'}`,
    `Error: ${pausedRun.error || 'none'}`,
    'If prompt/model tokens are 0, check MODEL_API_KEY or the Agent Provider secretRef environment variable in the running API process.',
  ].join(' '))
}

let tasks = await api(`/api/workspaces/${workspace.id}/human-tasks`)
let task = tasks.find((item) => item.workflowRunId === pausedRun.id)
if (!task) {
  await sleep(500)
  tasks = await api(`/api/workspaces/${workspace.id}/human-tasks`)
  task = tasks.find((item) => item.workflowRunId === pausedRun.id)
}
if (!task) {
  throw new Error(`Human Task not found for run ${pausedRun.id}`)
}

if (!task.participantSnapshot.includes(currentReviewer.id) || task.assigneeReviewerId !== currentReviewer.id) {
  task = await api(`/api/workspaces/${workspace.id}/human-tasks/${task.id}/transfer`, {
    method: 'POST',
    body: JSON.stringify({
      targetReviewerId: currentReviewer.id,
      reason: 'V1 Lite acceptance script routes the task to the current acceptance reviewer.',
    }),
  })
}
if (task.status !== '审核中') {
  task = await api(`/api/workspaces/${workspace.id}/human-tasks/${task.id}/claim`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

const taskDetail = await api(`/api/workspaces/${workspace.id}/human-tasks/${task.id}`)
await api(`/api/workspaces/${workspace.id}/human-tasks/${task.id}/decisions`, {
  method: 'POST',
  body: JSON.stringify({
    decision: 'approve',
    reason: 'V1 Lite runtime acceptance: approve the pilot artifact for scoring and observability evidence.',
    artifactVersionId: taskDetail.artifactVersionId,
    idempotencyKey: `${task.id}-${Date.now()}-v1-lite-approve`,
  }),
})

const completedRun = await api(`/api/workspaces/${workspace.id}/runs/${pausedRun.id}`)
if (completedRun.status !== '已完成') {
  throw new Error(`Expected completed Workflow Run after Human Review, got status: ${completedRun.status}`)
}
if (!completedRun.output) {
  throw new Error('Completed Workflow Run has no output artifact text.')
}

const evaluation = await api(`/api/workspaces/${workspace.id}/evaluations/rubrics/${rubric.id}/evaluate`, {
  method: 'POST',
  body: JSON.stringify({
    artifactText: completedRun.output,
    subjectType: 'workflow_run',
    subjectId: completedRun.id,
  }),
})
const regression = await api(`/api/workspaces/${workspace.id}/evaluations/regression-runs`, {
  method: 'POST',
  body: JSON.stringify({
    rubricId: rubric.id,
    sampleSetId: sampleSet.id,
  }),
})
const trace = await api(`/api/workspaces/${workspace.id}/observability/runs/${completedRun.id}`)
const notifications = await api(`/api/workspaces/${workspace.id}/notifications/outbox?limit=50`)

const evidence = {
  status: 'passed',
  apiUrl,
  workspace: {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
  },
  user: {
    id: session.user.id,
    email: session.user.email,
  },
  reviewer: {
    id: currentReviewer.id,
    name: currentReviewer.name,
  },
  workflow: {
    id: workflow.id,
    name: workflow.name,
    version: workflow.version,
  },
  rubric: {
    id: rubric.id,
    name: rubric.name,
    version: rubric.version,
  },
  runId: completedRun.id,
  runStatus: completedRun.status,
  humanTaskId: task.id,
  humanTaskStatus: '已通过',
  evaluationId: evaluation.id,
  evaluationStatus: evaluation.status,
  evaluationScore: evaluation.score,
  regressionRunId: regression.id,
  regressionSamples: regression.totalSamples,
  traceId: trace.traceId,
  executionEventCount: trace.executionEvents.length,
  notificationOutboxCount: notifications.length,
}

console.log(JSON.stringify(evidence, null, 2))
