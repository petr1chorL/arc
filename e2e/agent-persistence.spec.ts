import { expect, test } from '@playwright/test'

test('creates an Agent and reloads it from persistent storage', async ({ page }) => {
  const uniqueName = `持久化验证 Agent ${Date.now()}`

  await page.goto('/agents')
  await page.getByRole('button', { name: '新建 Agent' }).click()
  await page.getByLabel('名称').fill(uniqueName)
  await page.getByLabel('职责').fill('验证刷新页面后的 Agent 数据持久性')
  await page.getByLabel('负责人').fill('平台工程组')
  await page.getByLabel('模型').fill('GPT-5')
  await page.getByRole('button', { name: '创建 Agent' }).click()

  await expect(page.locator('.agent-identity strong', { hasText: uniqueName })).toBeVisible()

  await page.reload()

  await expect(page.locator('.agent-identity strong', { hasText: uniqueName })).toBeVisible()
})

test('publishes an Agent version and references it from a published workflow', async ({ page }) => {
  const uniqueName = `版本化 Agent ${Date.now()}`
  const workflowName = `版本引用流程 ${Date.now()}`

  await page.goto('/agents')
  await page.getByRole('button', { name: '新建 Agent' }).click()
  await page.getByLabel('名称').fill(uniqueName)
  await page.getByLabel('职责').fill('为工作流提供已发布的稳定能力')
  await page.getByLabel('负责人').fill('平台工程组')
  await page.getByLabel('模型').fill('GPT-5')
  await page.getByRole('button', { name: '创建 Agent' }).click()
  await page.getByRole('link', { name: uniqueName }).click()

  await page.getByLabel('System Prompt').fill('只输出结构化且有证据支持的结论。')
  await page.getByLabel('Tools').fill('Web Search, 飞书知识库')
  await page.getByLabel('Skills').fill('竞品分析, 引用核验')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText('草稿已保存')).toBeVisible()
  await page.getByRole('button', { name: '发布新版本' }).click()
  await expect(page.getByText('v1.0.0', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '工作流编排' }).click()
  await page.getByRole('button', { name: '新建' }).click()
  await page.getByLabel('工作流名称').fill(workflowName)
  await page.locator('.workflow-node.agent').click()
  await page.getByLabel('已发布 Agent 版本').selectOption({ label: `${uniqueName} · v1.0.0` })
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText('工作流草稿已保存')).toBeVisible()
  await page.getByRole('button', { name: '发布版本' }).click()
  await expect(page.getByText('v1.0.0 已发布')).toBeVisible()

  await page.reload()

  await expect(page.getByLabel('工作流名称')).toHaveValue(workflowName)
  await expect(page.getByText('已发布 · v1.0.0')).toBeVisible()
})
