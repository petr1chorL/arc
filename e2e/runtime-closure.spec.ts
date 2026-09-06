import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

async function login(page: Page, user = 'admin', path = '/w/runtime/runs', client = '1') {
  await page.context().setExtraHTTPHeaders({ 'X-ARC-Test-Client': client })
  await page.goto(path)
  await page.getByLabel('邮箱').fill(`${user}@example.invalid`)
  await page.getByLabel('密码').fill('TEST_ONLY Runtime password 42!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('隔离迁移验证', { exact: true })).toBeVisible()
}
async function headers(page: Page) {
  const cookies = await page.context().cookies()
  return { 'X-CSRF-Token': decodeURIComponent(cookies.find(cookie => cookie.name === 'arc_one_csrf')!.value), 'Idempotency-Key': crypto.randomUUID(), Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') }
}
async function tick(request: APIRequestContext) {
  const response = await request.post('http://127.0.0.1:48275/__tick', { headers: { 'X-ARC-Synthetic-Control': 'TEST_ONLY' } })
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.externalNetworkCalls).toBe(0)
  return result as { processed: number; providerCalls: number }
}

test('native workflow202 survives reload, review claim/transfer/revision resumes the same trace', async ({ page, browser }, info) => {
  const external: string[] = []
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5175/')) external.push(request.url()) })
  await login(page, 'admin', '/w/runtime/workflows/human-loop', '11')
  await expect(page.getByRole('button', { name: '运行工作流', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '运行工作流', exact: true }).click()
  await page.getByLabel('运行输入', { exact: true }).fill('TEST_ONLY 原始材料')
  const acceptedResponse = page.waitForResponse(response => response.url().endsWith('/human-loop/runs') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '开始运行', exact: true }).click()
  const response = await acceptedResponse
  expect(response.status()).toBe(202)
  const accepted = await response.json()
  const progress = page.getByRole('region', { name: `异步任务 ${accepted.operationId}`, exact: true })
  await expect(progress.getByText('已接收，排队中', { exact: true })).toBeVisible()
  await page.reload()
  await expect(progress.getByText('已接收，排队中', { exact: true })).toBeVisible()
  await tick(page.request)
  await expect(progress.getByText('等待人工审核', { exact: true })).toBeVisible({ timeout: 15000 })
  const taskResponse = await page.request.get('/api/workspaces/runtime/human-tasks', { headers: await headers(page) })
  expect(taskResponse.status(), await taskResponse.text()).toBe(200)
  const tasks = await taskResponse.json()
  const task = tasks.find((value: { workflowRunId: string }) => value.workflowRunId === accepted.runId)
  expect(task).toBeTruthy()
  await page.goto(`/w/runtime/reviews?taskId=${task.id}`)
  await page.getByRole('button', { name: '认领审核任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '转交任务', exact: true })).toBeVisible()
  await page.getByLabel('修改 / 转交依据', { exact: true }).fill('TEST_ONLY 转交复核')
  await page.getByLabel('转交对象', { exact: true }).selectOption('reviewer:reviewer')
  await page.getByRole('button', { name: '转交任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '修改后批准', exact: true })).not.toBeVisible()
  const reviewContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5175' }), reviewPage = await reviewContext.newPage()
  try {
    await login(reviewPage, 'reviewer', `/w/runtime/reviews?taskId=${task.id}`, '12')
    await reviewPage.getByLabel('修改后的产出物', { exact: true }).fill('TEST_ONLY 修订后的产出物')
    await reviewPage.getByLabel('修改 / 转交依据', { exact: true }).fill('TEST_ONLY 补充来源并批准')
    const decided = reviewPage.waitForResponse(value => value.url().endsWith(`/human-tasks/${task.id}/decisions`))
    await reviewPage.getByRole('button', { name: '修改后批准', exact: true }).click()
    const decision = await decided
    expect(decision.status()).toBe(200)
    const result = await decision.json()
    expect(result.resumeOperation.operationId).toBeTruthy()
    await tick(reviewPage.request)
    const resume = reviewPage.getByRole('region', { name: `异步任务 ${result.resumeOperation.operationId}`, exact: true })
    await expect(resume.getByText('已完成', { exact: true })).toBeVisible({ timeout: 15000 })
    const run = await (await reviewPage.request.get(`/api/workspaces/runtime/runs/${accepted.runId}`, { headers: await headers(reviewPage) })).json()
    expect(run.status).toBe('已完成')
    expect(run.output).toBe('TEST_ONLY 修订后的产出物')
    expect(new Set(run.nodes.map((node: { traceId: string }) => node.traceId)).size).toBe(1)
    const detail = await (await reviewPage.request.get(`/api/workspaces/runtime/human-tasks/${task.id}`, { headers: await headers(reviewPage) })).json()
    expect(detail.artifactVersions.map((version: { content: string }) => version.content)).toEqual(expect.arrayContaining(['TEST_ONLY 原始材料', 'TEST_ONLY 修订后的产出物']))
    await reviewPage.screenshot({ path: info.outputPath('native-human-review-resumed.png'), fullPage: true })
  } finally { await reviewContext.close() }
  expect(external).toEqual([])
})

test('actual native evaluation transport uncertainty requires authorized manual acknowledgement', async ({ page, browser }, info) => {
  await login(page, 'admin', '/w/runtime/quality-operations', '21')
  await page.getByTitle('配置量规', { exact: true }).click()
  await page.getByLabel('待评估产出物', { exact: true }).fill('TEST_ONLY_UNCERTAIN 证据材料')
  const sending = page.waitForResponse(response => response.url().endsWith('/rubrics/rubric/evaluate'))
  await page.getByRole('button', { name: '运行评估', exact: true }).click()
  const submitted = await sending
  expect(submitted.status()).toBe(202)
  const accepted = await submitted.json()
  await expect(page.getByText('评估已接收，尚未完成；请查看异步任务进度。')).toBeVisible()
  // Close the editor so global durable task controls are not covered by the dialog.
  await page.getByRole('button', { name: '关闭', exact: true }).first().click()
  const first = await tick(page.request)
  const progress = page.getByRole('region', { name: `异步任务 ${accepted.operationId}`, exact: true })
  await expect(progress.getByText('结果待核对', { exact: true })).toBeVisible({ timeout: 15000 })
  expect((await tick(page.request)).providerCalls).toBe(first.providerCalls)
  await expect(progress.getByRole('button', { name: '确认风险并重新尝试' })).toBeDisabled()
  const viewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5175' }), viewer = await viewerContext.newPage()
  try {
    await login(viewer, 'viewer', `/w/runtime/runs?operationId=${accepted.operationId}`, '22')
    await expect(viewer.getByText('结果待核对', { exact: true })).toBeVisible()
    await expect(viewer.getByRole('button', { name: '确认风险并重新尝试' })).toHaveCount(0)
    const denied = await viewer.request.post(`/api/workspaces/runtime/operations/${accepted.operationId}/reconcile`, {
      headers: await headers(viewer), data: { decision:'retry', reason:'TEST_ONLY unauthorized', acknowledgeDuplicateRisk:true },
    })
    expect(denied.status()).toBe(403)
  } finally { await viewerContext.close() }
  await progress.getByLabel('核对依据 / 操作原因').fill('TEST_ONLY 服务方确认可以重新尝试')
  await progress.getByLabel('我已核对，接受重复调用或重复计费的风险').check()
  const retrying = page.waitForResponse(response => response.url().endsWith(`/operations/${accepted.operationId}/reconcile`))
  await progress.getByRole('button', { name: '确认风险并重新尝试' }).click()
  expect((await retrying).status()).toBe(200)
  await tick(page.request)
  await expect(progress.getByText('已完成', { exact: true })).toBeVisible({ timeout:15000 })
  const persisted = await (await page.request.get(`/api/workspaces/runtime/operations/${accepted.operationId}`, { headers: await headers(page) })).json()
  expect(persisted.result.score).toBe(90)
  expect(persisted.result.costUsd).toBeGreaterThan(0)
  expect(persisted.result.dimensionScores[0].reason).toBe('TEST_ONLY 受控来源核对')
  const cross = await page.request.get(`/api/workspaces/foreign/operations/${accepted.operationId}`, { headers: await headers(page) })
  expect(cross.status()).toBe(404)
  await page.screenshot({ path: info.outputPath('native-reconciliation-completed.png'), fullPage:true })
})

test('native schedule and notification dispatch expose acceptance, then persisted delivery evidence', async ({ page }, info) => {
  await login(page, 'admin', '/w/runtime/schedules', '31')
  const created = await page.request.post('/api/workspaces/runtime/schedules', { headers: await headers(page), data: {
    name:'TEST_ONLY 定时流程',workflowId:'human-loop',workflowVersion:'v1.0.0',cronExpression:'0 * * * *',timezone:'Asia/Shanghai',input:'{"task":"TEST_ONLY 定时输入"}',status:'paused',
  } })
  expect(created.status(), await created.text()).toBe(201)
  await page.reload()
  const submitted = page.waitForResponse(response => /\/schedules\/[^/]+\/trigger$/.test(response.url()))
  await page.getByRole('button', { name: '立即执行 TEST_ONLY 定时流程', exact:true }).click()
  expect((await submitted).status()).toBe(202)
  await expect(page.getByText('触发请求已接收，尚未完成；请查看异步任务进度。')).toBeVisible()
  await tick(page.request)
  await page.goto('/w/runtime/notifications')
  const dispatching = page.waitForResponse(response => response.url().endsWith('/notifications/outbox/dispatch'))
  await page.getByRole('button', { name:'触发发送器', exact:true }).click()
  const dispatch = await dispatching
  expect(dispatch.status()).toBe(202)
  const accepted = await dispatch.json()
  await expect(page.getByText('派发任务已接收，尚未确认发送；请查看异步任务进度。')).toBeVisible()
  await tick(page.request)
  const progress = page.getByRole('region', { name:`异步任务 ${accepted.operationId}`, exact:true })
  await expect(progress.getByText('已完成', { exact:true })).toBeVisible({ timeout:15000 })
  const notifications = await (await page.request.get('/api/workspaces/runtime/notifications/outbox?limit=50', { headers: await headers(page) })).json()
  expect(notifications.some((item: {status:string;payload:{dispatch?:{deliveryKind:string}}}) => item.status==='sent' && item.payload.dispatch?.deliveryKind==='persistent_in_app')).toBe(true)
  await page.screenshot({ path:info.outputPath('native-notification-delivery.png'),fullPage:true })
})

test('native published Agent test uses the same202 progress and real controlled model adapter', async ({ page }, info) => {
  await login(page, 'admin', '/w/runtime/agents', '41')
  const created = await page.request.post('/api/workspaces/runtime/agents', { headers: await headers(page), data: {
    name:'TEST_ONLY Native Agent',role:'TEST_ONLY role',owner:'admin',model:'synthetic-model',modelProviderId:'provider',modelProvider:'openai-compatible',
    modelBaseUrl:'https://models.example.invalid/v1',temperature:0,maxOutputTokens:100,
  } })
  expect(created.status(), await created.text()).toBe(201)
  const agent = await created.json()
  const published = await page.request.post(`/api/workspaces/runtime/agents/${agent.id}/publish`, { headers: await headers(page), data:{note:'TEST_ONLY published'} })
  expect(published.status(), await published.text()).toBe(201)
  await page.goto(`/w/runtime/agents/${agent.id}`)
  await page.getByLabel('测试输入', { exact:true }).fill('TEST_ONLY 直接执行 Agent')
  const response = page.waitForResponse(value => value.url().endsWith(`/agents/${agent.id}/test-runs`))
  await page.getByRole('button', { name:'运行 Agent',exact:true }).click()
  const submitted = await response
  expect(submitted.status(), await submitted.text()).toBe(202)
  const accepted = await submitted.json()
  await expect(page.getByText('测试运行已接收，尚未完成；请查看异步任务进度。')).toBeVisible()
  await expect(page.getByText('测试运行已完成', {exact:true})).toHaveCount(0)
  await tick(page.request)
  const progress = page.getByRole('region', {name:`异步任务 ${accepted.operationId}`,exact:true})
  await expect(progress.getByText('已完成', {exact:true})).toBeVisible({timeout:15000})
  const run = await (await page.request.get(`/api/workspaces/runtime/runs/${accepted.runId}`, {headers:await headers(page)})).json()
  expect(run.kind).toBe('agent')
  expect(run.status).toBe('已完成')
  expect(run.output).toBe('TEST_ONLY Agent 产出：TEST_ONLY 直接执行 Agent')
  expect(run.costUsd).toBeGreaterThan(0)
  await progress.scrollIntoViewIfNeeded()
  await page.screenshot({path:info.outputPath('native-agent-completed.png'),fullPage:true})
})

test('native artifact and observability pages read persisted run traces without browser errors', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await login(page, 'admin', '/w/runtime/artifacts', '51')
  await expect(page.getByRole('heading', {name:'Artifact Instances',exact:true})).toBeVisible()
  await expect(page.getByText('TEST_ONLY 修订后的产出物', {exact:true}).first()).toBeVisible()
  await page.goto('/w/runtime/observability')
  await expect(page.getByRole('heading', {name:'执行队列运营',exact:true})).toBeVisible()
  await expect(page.getByRole('heading', {name:'成本与模型调用',exact:true})).toBeVisible()
  await expect(page.getByRole('heading', {name:'人工 SLA 运营',exact:true})).toBeVisible()
  expect(errors).toEqual([])
  await page.screenshot({path:info.outputPath('native-trace-observability.png'),fullPage:true})
})
