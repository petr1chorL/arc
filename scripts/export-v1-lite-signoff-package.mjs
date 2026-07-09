import { readFile, writeFile, mkdir } from 'node:fs/promises'
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

async function readJson(filePath) {
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content.replace(/^\uFEFF/, ''))
}

function checkbox(value) {
  return value ? 'x' : ' '
}

function table(rows) {
  if (rows.length === 0) {
    return ''
  }
  const [header, ...body] = rows
  const separator = header.map(() => '---')
  return [header, separator, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n')
}

function issueSummary(markdown) {
  const issueRows = markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| V1L-ISSUE-'))
  const openBlockers = []
  for (const row of issueRows) {
    const columns = row.split('|').map((part) => part.trim())
    const issue = {
      id: columns[1],
      severity: columns[3],
      title: columns[5],
      status: columns[8],
      blocking: columns[9],
    }
    if (['P0', 'P1'].includes(issue.severity) && (issue.status !== 'closed' || issue.blocking === '是')) {
      openBlockers.push(issue)
    }
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
const signoffAuditPath = path.resolve(root, args.get('signoff-audit') ?? '.scratch/runtime/v1-lite-signoff-audit.json')
const issueLogPath = path.resolve(root, args.get('issue-log') ?? 'docs/V1_LITE_PILOT_ISSUE_LOG.md')
const outputPath = path.resolve(root, args.get('output') ?? '.scratch/runtime/v1-lite-signoff-package.md')

const runtime = await readJson(runtimeEvidencePath)
const browser = await readJson(browserEvidencePath)
const audit = await readJson(signoffAuditPath)
const issues = issueSummary(await readFile(issueLogPath, 'utf8'))

const checkedPages = Array.isArray(browser.checkedPages) ? browser.checkedPages : []
const runtimePassed = runtime.status === 'passed'
const browserPassed = browser.status === 'passed'
const signoffReady = audit.status === 'ready_for_business_signoff'
const noOpenBlockers = issues.openBlockers.length === 0

const generatedAt = new Date().toISOString()
const markdown = `# V1.0 Lite 签收材料包

> 生成时间：${generatedAt}
> 用途：汇总 V1.0 Lite 技术签收证据，供业务验收人手工签收前阅读。

## 当前结论

技术侧状态：\`${audit.status}\`

业务侧状态：\`${audit.businessManualAcceptance ?? 'pending'}\`

下一步：${audit.nextRequiredAction}

## 证据总览

${table([
  ['项目', '状态', '说明'],
  ['真实服务闭环', runtimePassed ? '通过' : '不通过', `Run ${runtime.runId}`],
  ['浏览器烟测', browserPassed ? '通过' : '不通过', `${checkedPages.length} 个页面`],
  ['签收审查', signoffReady ? '通过' : '不通过', audit.status],
  ['P0/P1 阻断项', noOpenBlockers ? '0' : String(issues.openBlockers.length), noOpenBlockers ? '无' : issues.openBlockers.map((issue) => issue.id).join(', ')],
])}

## 真实服务闭环

${table([
  ['字段', '值'],
  ['Workspace', `${runtime.workspace?.name ?? ''} (${runtime.workspace?.slug ?? ''})`],
  ['Workflow', `${runtime.workflow?.name ?? ''} @ ${runtime.workflow?.version ?? ''}`],
  ['Run ID', runtime.runId],
  ['Run Status', runtime.runStatus],
  ['Human Task ID', runtime.humanTaskId],
  ['Human Task Status', runtime.humanTaskStatus],
  ['Evaluation ID', runtime.evaluationId],
  ['Evaluation Status', runtime.evaluationStatus],
  ['Evaluation Score', String(runtime.evaluationScore)],
  ['Regression Run ID', runtime.regressionRunId],
  ['Regression Samples', String(runtime.regressionSamples)],
  ['Trace ID', runtime.traceId],
  ['Execution Event Count', String(runtime.executionEventCount)],
  ['Notification Outbox Count', String(runtime.notificationOutboxCount)],
])}

## 浏览器烟测

${table([
  ['页面', '期望文本', '结果'],
  ...checkedPages.map((page) => [page.path, page.expectedText, page.ok ? '通过' : '不通过']),
])}

- 严重控制台错误：${browser.severeMessages?.length ?? 0}
- 5xx 响应：${browser.badResponses?.length ?? 0}
- 登录前会话探测 401：${browser.authProbeMessages?.length ?? 0}，不作为失败。

## 问题清单

- 已登记问题数：${issues.issueCount}
- P0/P1 未关闭或仍阻断：${issues.openBlockers.length}

## 业务验收人填写

请按 \`docs/V1_LITE_BUSINESS_ACCEPTANCE_FORM.md\` 做手工验收。

${table([
  ['字段', '填写'],
  ['验收日期', ''],
  ['验收人', ''],
  ['产出物是否可用', '可用 / 不可用 / 需修改'],
  ['业务结论', '通过 / 不通过'],
  ['阻断问题数量', ''],
  ['非阻断问题数量', ''],
  ['备注', ''],
])}

## 签收前确认

- [${checkbox(runtimePassed)}] 真实服务闭环通过。
- [${checkbox(browserPassed)}] 浏览器烟测通过。
- [${checkbox(signoffReady)}] 签收审查为 \`ready_for_business_signoff\`。
- [${checkbox(noOpenBlockers)}] 无未关闭 P0/P1 阻断项。
- [ ] 业务验收人已完成手工验收。
- [ ] 业务结论已写入 \`docs/ACCEPTANCE_V1_LITE.md\`。
`

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, markdown, 'utf8')
console.log(JSON.stringify({
  status: 'exported',
  outputPath,
  generatedAt,
  technicalStatus: audit.status,
  runtimeStatus: runtime.status,
  browserStatus: browser.status,
  openBlockers: issues.openBlockers.length,
}, null, 2))
