import { readFile } from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      continue
    }
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      args.set(key, next)
      index += 1
    } else {
      args.set(key, 'true')
    }
  }
  return args
}

function requireValue(value, label, failures) {
  if (value === undefined || value === null || value === '') {
    failures.push(`${label} is missing`)
    return false
  }
  return true
}

async function readJson(filePath, label, failures) {
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content.replace(/^\uFEFF/, ''))
  } catch (error) {
    failures.push(`${label} cannot be read: ${error.message}`)
    return null
  }
}

function auditRuntimeEvidence(evidence, failures) {
  if (!evidence) {
    return null
  }
  const requiredFields = [
    'runId',
    'humanTaskId',
    'evaluationId',
    'regressionRunId',
    'traceId',
  ]
  for (const field of requiredFields) {
    requireValue(evidence[field], `runtimeEvidence.${field}`, failures)
  }
  if (evidence.status !== 'passed') {
    failures.push(`runtimeEvidence.status expected passed, got ${evidence.status}`)
  }
  if (evidence.runStatus !== '已完成') {
    failures.push(`runtimeEvidence.runStatus expected 已完成, got ${evidence.runStatus}`)
  }
  if (evidence.humanTaskStatus !== '已通过') {
    failures.push(`runtimeEvidence.humanTaskStatus expected 已通过, got ${evidence.humanTaskStatus}`)
  }
  if (evidence.evaluationStatus !== 'passed') {
    failures.push(`runtimeEvidence.evaluationStatus expected passed, got ${evidence.evaluationStatus}`)
  }
  if (Number(evidence.evaluationScore ?? 0) < 80) {
    failures.push(`runtimeEvidence.evaluationScore expected >= 80, got ${evidence.evaluationScore}`)
  }
  if (Number(evidence.regressionSamples ?? 0) < 1) {
    failures.push(`runtimeEvidence.regressionSamples expected >= 1, got ${evidence.regressionSamples}`)
  }
  if (Number(evidence.executionEventCount ?? 0) < 1) {
    failures.push(`runtimeEvidence.executionEventCount expected >= 1, got ${evidence.executionEventCount}`)
  }
  if (Number(evidence.notificationOutboxCount ?? 0) < 1) {
    failures.push(`runtimeEvidence.notificationOutboxCount expected >= 1, got ${evidence.notificationOutboxCount}`)
  }
  return {
    runId: evidence.runId,
    humanTaskId: evidence.humanTaskId,
    evaluationId: evidence.evaluationId,
    regressionRunId: evidence.regressionRunId,
    traceId: evidence.traceId,
    evaluationScore: evidence.evaluationScore,
  }
}

function auditBrowserEvidence(evidence, failures) {
  if (!evidence) {
    return null
  }
  if (evidence.status !== 'passed') {
    failures.push(`browserSmoke.status expected passed, got ${evidence.status}`)
  }
  const pages = Array.isArray(evidence.checkedPages) ? evidence.checkedPages : []
  if (pages.length < 1) {
    failures.push('browserSmoke.checkedPages is empty')
  }
  for (const page of pages) {
    if (!page.ok) {
      failures.push(`browserSmoke page failed: ${page.path}`)
    }
  }
  if (Array.isArray(evidence.severeMessages) && evidence.severeMessages.length > 0) {
    failures.push(`browserSmoke.severeMessages is not empty: ${evidence.severeMessages.length}`)
  }
  if (Array.isArray(evidence.badResponses) && evidence.badResponses.length > 0) {
    failures.push(`browserSmoke.badResponses is not empty: ${evidence.badResponses.length}`)
  }
  return {
    checkedPageCount: pages.length,
    severeMessageCount: evidence.severeMessages?.length ?? 0,
    badResponseCount: evidence.badResponses?.length ?? 0,
  }
}

function auditIssueLog(markdown, failures) {
  const openBlockers = []
  const issueRows = markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| V1L-ISSUE-'))
  for (const row of issueRows) {
    const columns = row.split('|').map((part) => part.trim())
    const id = columns[1]
    const severity = columns[3]
    const status = columns[8]
    const blocking = columns[9]
    if (['P0', 'P1'].includes(severity) && status !== 'closed') {
      openBlockers.push({ id, severity, status, blocking })
    }
    if (['P0', 'P1'].includes(severity) && blocking === '是') {
      openBlockers.push({ id, severity, status, blocking })
    }
  }
  if (openBlockers.length > 0) {
    failures.push(`issueLog has open or blocking P0/P1 issues: ${openBlockers.map((issue) => issue.id).join(', ')}`)
  }
  return {
    issueCount: issueRows.length,
    openBlockers,
  }
}

const args = parseArgs(process.argv.slice(2))
const root = process.cwd()
const runtimeEvidencePath = path.resolve(root, args.get('runtime-evidence') ?? '.scratch/runtime/v1-lite-runtime-acceptance.json')
const browserEvidencePath = path.resolve(root, args.get('browser-evidence') ?? '.scratch/runtime/v1-lite-browser-smoke.json')
const issueLogPath = path.resolve(root, args.get('issue-log') ?? 'docs/V1_LITE_PILOT_ISSUE_LOG.md')
const failures = []

const runtimeEvidence = await readJson(runtimeEvidencePath, 'runtimeEvidence', failures)
const browserEvidence = await readJson(browserEvidencePath, 'browserSmoke', failures)
let issueLog = ''
try {
  issueLog = await readFile(issueLogPath, 'utf8')
} catch (error) {
  failures.push(`issueLog cannot be read: ${error.message}`)
}

const runtimeSummary = auditRuntimeEvidence(runtimeEvidence, failures)
const browserSummary = auditBrowserEvidence(browserEvidence, failures)
const issueSummary = issueLog ? auditIssueLog(issueLog, failures) : null

const status = failures.length === 0 ? 'ready_for_business_signoff' : 'failed'
const result = {
  status,
  generatedAt: new Date().toISOString(),
  technicalGates: failures.length === 0 ? 'passed' : 'failed',
  businessManualAcceptance: 'pending',
  runtimeEvidencePath,
  browserEvidencePath,
  issueLogPath,
  runtimeSummary,
  browserSummary,
  issueSummary,
  failures,
  nextRequiredAction: failures.length === 0
    ? '业务验收人按 docs/V1_LITE_BUSINESS_ACCEPTANCE_FORM.md 完成手工验收，并在 docs/ACCEPTANCE_V1_LITE.md 填写业务结论。'
    : '先处理 failures 中列出的技术签收阻断项，再重新运行本脚本。',
}

console.log(JSON.stringify(result, null, 2))
if (failures.length > 0) {
  process.exitCode = 1
}
