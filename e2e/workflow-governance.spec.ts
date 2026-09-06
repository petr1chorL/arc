import { test, expect } from '@playwright/test'

test('workflow editor persists Agent binding, two immutable versions and blocks execution', async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'X-ARC-Test-Client': 'workflows' })
  const forbidden: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:48273'
      || (url.pathname.startsWith('/api/') && /\/(?:runs|test-runs|human-tasks|notifications)(?:\/|$)/.test(url.pathname))) forbidden.push(request.url())
  })
  await page.goto('/w/synthetic/workflows/new')
  await page.getByLabel('邮箱').fill('browser@example.invalid')
  await page.getByLabel('密码').fill('Synthetic browser password 42!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText(/工作流迁移验证模式/)).toBeVisible()
  const cookies = await page.context().cookies()
  const headers = { 'X-CSRF-Token': decodeURIComponent(cookies.find(cookie => cookie.name === 'arc_one_csrf')!.value),
    Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), 'X-ARC-Test-Client': 'workflows' }
  const agentResponse = await page.request.post('/api/workspaces/browser/agents', { headers,
    data: { name: 'Workflow browser Agent', role: 'Synthetic', owner: 'Synthetic', model: 'synthetic' } })
  expect(agentResponse.status()).toBe(201)
  const agent = await agentResponse.json()
  expect((await page.request.post(`/api/workspaces/browser/agents/${agent.id}/publish`, { headers })).status()).toBe(201)
  await page.reload()
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '更改名称', exact: true }).click()
  await page.getByRole('textbox', { name: '工作流名称', exact: true }).fill('Workflow browser original')
  await page.getByRole('textbox', { name: '工作流名称', exact: true }).press('Enter')
  await page.locator('.react-flow__node[data-id="agent"]').click()
  await page.getByRole('combobox', { name: '已发布 Agent 版本', exact: true }).selectOption(`${agent.id}|v1.0.0`)
  const edge = page.getByRole('group', { name: 'Edge from start to agent', exact: true })
  // A horizontal SVG edge has a zero-height group box; click its visible stroke midpoint.
  const midpoint = await edge.locator('.react-flow__edge-interaction').evaluate(element => {
    const path = element as SVGPathElement
    const point = path.getPointAtLength(path.getTotalLength() / 2)
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(midpoint.x, midpoint.y)
  await page.getByRole('button', { name: '新增映射', exact: true }).click()
  await page.getByLabel('上游字段 1', { exact: true }).fill('$.payload')
  await page.getByLabel('下游字段 1', { exact: true }).fill('$.input.payload')
  const creating = page.waitForResponse(response => response.url().endsWith('/workflows') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  const createdResponse = await creating
  expect(createdResponse.status()).toBe(201)
  const created = await createdResponse.json()
  await expect(page).toHaveURL(`/w/synthetic/workflows/${created.id}`)
  await page.reload()
  await expect(page.getByLabel('工作流名称', { exact: true })).toHaveText('Workflow browser original')
  await expect(page.getByRole('button', { name: '运行工作流', exact: true })).toBeDisabled()
  for (const [index, note] of ['First workflow version', 'Second workflow version'].entries()) {
    if (index) {
      await page.getByRole('button', { name: '更改名称', exact: true }).click()
      await page.getByRole('textbox', { name: '工作流名称', exact: true }).fill('Workflow browser edited')
      await page.getByRole('textbox', { name: '工作流名称', exact: true }).press('Enter')
    }
    await page.getByRole('button', { name: '发布版本', exact: true }).click()
    await page.getByLabel('发布备注', { exact: true }).fill(note)
    await page.getByRole('button', { name: '确认发布版本', exact: true }).click()
    await expect(page.getByText(`v1.${index}.0 已发布`, { exact: true })).toBeVisible()
  }
  await page.reload()
  await expect(page.getByLabel('工作流名称', { exact: true })).toHaveText('Workflow browser edited')
  const versionsResponse = await page.request.get(`/api/workspaces/browser/workflows/${created.id}/versions`, { headers })
  expect(versionsResponse.status(), await versionsResponse.text()).toBe(200)
  const versions = await versionsResponse.json()
  expect(versions.map((version: { snapshot: { name: string } }) => version.snapshot.name)).toEqual(['Workflow browser edited', 'Workflow browser original'])
  expect(versions[1].snapshot.nodes.find((node: { id: string }) => node.id === 'agent').data.agentId).toBe(agent.id)
  expect(versions[1].snapshot.edges.find((edge: { source: string }) => edge.source === 'start').data.mappings).toEqual([{ sourcePath: '$.payload', targetPath: '$.input.payload' }])
  await page.screenshot({ path: testInfo.outputPath('workflow-governance.png'), fullPage: true })
  expect(forbidden).toEqual([])
})
