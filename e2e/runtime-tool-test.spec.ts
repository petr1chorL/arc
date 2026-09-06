import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

const library = '/w/runtime/settings/asset-library'
async function login(page: Page, user: string, client: string, path = library) {
  await page.context().setExtraHTTPHeaders({ 'X-ARC-Test-Client': client })
  await page.goto(path)
  await page.getByLabel('邮箱').fill(`${user}@example.invalid`)
  await page.getByLabel('密码').fill('TEST_ONLY Runtime password 42!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('隔离迁移验证', { exact: true })).toBeVisible()
}
async function headers(page: Page) {
  const cookies = await page.context().cookies()
  return { 'X-CSRF-Token': decodeURIComponent(cookies.find(cookie => cookie.name === 'arc_one_csrf')!.value),
    Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') }
}
async function tick(request: APIRequestContext) {
  const response = await request.post('http://127.0.0.1:48275/__tick', { headers: { 'X-ARC-Synthetic-Control': 'TEST_ONLY' } })
  expect(response.status()).toBe(200)
  const value = await response.json()
  expect(value.externalNetworkCalls).toBe(0)
  return value as { toolCalls: number }
}
async function submit(page: Page, sku: string) {
  await page.getByLabel('测试参数 TEST_ONLY HTTP Tool', { exact: true }).fill(JSON.stringify({ sku }))
  const response = page.waitForResponse(value => value.url().endsWith('/test-http-tool/test-invocations') && value.request().method() === 'POST')
  await page.getByRole('button', { name: '测试调用 TEST_ONLY HTTP Tool', exact: true }).click()
  const accepted = await response
  expect(accepted.status(), await accepted.text()).toBe(202)
  const value = await accepted.json()
  expect(value.invocationId).toBe(value.operationId)
  return value as { operationId: string; invocationId: string }
}

test('independent Tool202 survives reload, completes without creating a Run, and hides response contents', async ({ page }, info) => {
  const errors: string[] = [], external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5175/')) external.push(request.url()) })
  await login(page, 'builder', '61')
  const before = await page.request.get('/api/workspaces/runtime/runs', { headers: await headers(page) })
  expect(before.status()).toBe(200)
  const runIds = (await before.json()).map((run: { id: string }) => run.id).sort()
  const accepted = await submit(page, 'TEST_ONLY_PRODUCT')
  const progress = page.getByRole('region', { name: `异步任务 ${accepted.operationId}`, exact: true })
  await expect(progress.getByText('已接收，排队中', { exact: true })).toBeVisible()
  await expect(page.getByText('测试调用已完成', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(progress.getByText('已接收，排队中', { exact: true })).toBeVisible()
  await tick(page.request)
  await expect(progress.getByText('已完成', { exact: true })).toBeVisible({ timeout: 15000 })
  const operation = await page.request.get(`/api/workspaces/runtime/operations/${accepted.operationId}`, { headers: await headers(page) })
  expect(operation.status()).toBe(200)
  const value = await operation.json()
  expect(value.kind).toBe('tool.test')
  expect(JSON.stringify(value)).not.toContain('TEST_ONLY_PRIVATE_TOOL_OUTPUT')
  const after = await page.request.get('/api/workspaces/runtime/runs', { headers: await headers(page) })
  expect(after.status()).toBe(200)
  expect((await after.json()).map((run: { id: string }) => run.id).sort()).toEqual(runIds)
  await page.reload()
  await expect(progress.getByText('已完成', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('TEST_ONLY_PRIVATE_TOOL_OUTPUT', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([]); expect(external).toEqual([])
  await page.screenshot({ path: info.outputPath('native-tool-test-completed.png'), fullPage: true })
})

test('uncertain Tool effect is not resent and operator cannot bypass builder controls', async ({ page, browser }, info) => {
  await login(page, 'builder', '71')
  const accepted = await submit(page, 'TEST_ONLY_TOOL_UNCERTAIN')
  const progress = page.getByRole('region', { name: `异步任务 ${accepted.operationId}`, exact: true })
  const first = await tick(page.request)
  await expect(progress.getByText('结果待核对', { exact: true })).toBeVisible({ timeout: 15000 })
  expect((await tick(page.request)).toolCalls).toBe(first.toolCalls)
  await expect(progress.getByRole('button', { name: '确认风险并重新尝试' })).toHaveCount(0)
  const operatorContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5175' }), operator = await operatorContext.newPage()
  try {
    await login(operator, 'reviewer', '72', `${library}?operationId=${accepted.operationId}`)
    const deniedProgress = operator.getByRole('region', { name: `异步任务 ${accepted.operationId}`, exact: true })
    await expect(deniedProgress.getByText('结果待核对', { exact: true })).toBeVisible()
    await expect(deniedProgress.getByRole('button', { name: '确认风险并重新尝试' })).toHaveCount(0)
    for (const action of ['cancel', 'requeue']) {
      const denied = await operator.request.post(`/api/workspaces/runtime/operations/${accepted.operationId}/${action}`, {
        headers: await headers(operator), data: { reason: 'TEST_ONLY permission check' },
      })
      expect(denied.status()).toBe(403)
    }
    expect((await operator.request.get(`/api/workspaces/runtime/execution-jobs/${accepted.operationId}`, { headers: await headers(operator) })).status()).toBe(404)
  } finally { await operatorContext.close() }
  const adminContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5175' }), admin = await adminContext.newPage()
  try {
    await login(admin, 'admin', '73', `${library}?operationId=${accepted.operationId}`)
    const adminProgress = admin.getByRole('region', { name: `异步任务 ${accepted.operationId}`, exact: true })
    await expect(adminProgress.getByText('结果待核对', { exact: true })).toBeVisible()
    await adminProgress.getByLabel('核对依据 / 操作原因').fill('TEST_ONLY 外部结果已人工核对')
    await adminProgress.getByLabel('我已核对，接受重复调用或重复计费的风险').check()
    const response = admin.waitForResponse(value => value.url().endsWith(`/operations/${accepted.operationId}/reconcile`))
    await adminProgress.getByRole('button', { name: '确认风险并重新尝试' }).click()
    expect((await response).status()).toBe(200)
    expect((await tick(admin.request)).toolCalls).toBe(first.toolCalls + 1)
    await expect(adminProgress.getByText('已完成', { exact: true })).toBeVisible({ timeout: 15000 })
    await admin.screenshot({ path: info.outputPath('native-tool-test-reconciled.png'), fullPage: true })
  } finally { await adminContext.close() }
})
