import { expect, test } from '@playwright/test'

const testEmail = 'e2e-admin@arc-one.test'
const testPassword = 'ArcOne-E2E-Only-2026!'

async function login(page: import('@playwright/test').Page) {
  const initialSession = page.waitForResponse((response) => (
    response.url().endsWith('/api/auth/session')
  ))
  await page.goto('/login')
  await initialSession
  await page.getByLabel('邮箱').fill(testEmail)
  await page.getByLabel('密码').fill(testPassword)
  const loginResponse = page.waitForResponse((response) => (
    response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: '登录' }).click()
  expect((await loginResponse).ok()).toBeTruthy()
  await expect(page).toHaveURL(/\/w\/ai-capability-center/)
}

async function createAgent(
  page: import('@playwright/test').Page,
  input: { name: string; role: string },
) {
  await page.getByRole('button', { name: '新建 Agent' }).click()
  const dialog = page.getByRole('dialog', { name: '新建 Agent' })
  await dialog.getByRole('textbox', { name: '名称', exact: true }).fill(input.name)
  await dialog.getByRole('textbox', { name: '职责', exact: true }).fill(input.role)
  await dialog.getByRole('textbox', { name: '负责人', exact: true }).fill('平台工程组')
  await dialog.getByRole('textbox', { name: '模型', exact: true }).fill('GPT-5')
  await dialog.getByRole('button', { name: '创建 Agent' }).click()
}

test('creates an Agent and reloads it from persistent storage', async ({ page }) => {
  const uniqueName = `持久化验证 Agent ${Date.now()}`

  await login(page)
  await page.goto('/agents')
  await createAgent(page, {
    name: uniqueName,
    role: '验证刷新页面后的 Agent 数据持久性',
  })

  await expect(page.locator('.agent-identity strong', { hasText: uniqueName })).toBeVisible()

  await page.reload()

  await expect(page.locator('.agent-identity strong', { hasText: uniqueName })).toBeVisible()
})

test('publishes an Agent version and references it from a published workflow', async ({ page }) => {
  const uniqueName = `版本化 Agent ${Date.now()}`
  const workflowName = `版本引用流程 ${Date.now()}`

  await login(page)
  await page.goto('/agents')
  await createAgent(page, {
    name: uniqueName,
    role: '为工作流提供已发布的稳定能力',
  })
  await page.getByRole('link', { name: uniqueName }).click()

  await page.getByLabel('System Prompt').fill('只输出结构化且有证据支持的结论。')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText('草稿已保存')).toBeVisible()
  await page.getByRole('button', { name: '发布新版本' }).click()
  await page.getByLabel('发布备注').fill('验证 AgentVersion 与 WorkflowVersion 稳定引用')
  await page.getByRole('button', { name: '确认发布版本' }).click()
  await expect(
    page.getByRole('article').filter({ hasText: uniqueName }).getByText('v1.0.0', { exact: true }),
  ).toBeVisible()

  await page.getByRole('link', { name: '工作流编排' }).click()
  const newWorkflowLoaded = page.waitForResponse((response) => (
    response.request().method() === 'GET'
      && /\/api\/workspaces\/[^/]+\/workflows$/.test(new URL(response.url()).pathname)
  ))
  await page.getByRole('button', { name: '新建' }).click()
  await newWorkflowLoaded
  await page.waitForLoadState('networkidle')
  await expect(page.getByLabel('工作流名称')).toHaveText('未命名工作流')
  await page.getByRole('button', { name: '更改名称' }).click()
  await page.getByLabel('工作流名称').fill(workflowName)
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await page.locator('.workflow-node.agent').click()
  await page.getByLabel('已发布 Agent 版本').selectOption({ label: `${uniqueName} · v1.0.0` })
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText('工作流草稿已保存')).toBeVisible()
  await page.getByRole('button', { name: '发布版本' }).click()
  await page.getByLabel('发布备注').fill('验证已发布 AgentVersion 引用')
  await page.getByRole('button', { name: '确认发布版本' }).click()
  await expect(page.getByText('v1.0.0 已发布')).toBeVisible()

  await page.getByRole('button', { name: '返回工作流列表' }).click()
  await page.getByRole('button', { name: workflowName, exact: true }).click()
  await page.reload()

  await expect(page.getByLabel('工作流名称')).toHaveText(workflowName)
  await expect(page.getByText('已发布 · v1.0.0')).toBeVisible()
})
