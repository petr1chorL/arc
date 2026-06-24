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
