import { expect, test } from '@playwright/test'

const testEmail = 'e2e-admin@arc-one.test'
const testPassword = 'ArcOne-E2E-Only-2026!'

async function login(page: import('@playwright/test').Page) {
  const initialSession = page.waitForResponse((response) => response.url().endsWith('/api/auth/session'))
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

test('keeps the evaluation center focused on templates and quality operations secondary', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: '评估中心' }).click()

  await expect(page.getByRole('heading', { name: '评估模板' })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建评估模板' })).toBeVisible()
  await expect(page.getByText(/Golden Set|Regression Run|Remediation Task/i)).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '主导航' }).getByText('质量运营')).toHaveCount(0)
  await page.screenshot({ path: '.scratch/evaluation-template-node/evaluation-center.png', fullPage: true })

  await page.goto('/evaluations?taskId=missing-task')
  await expect(page).toHaveURL(/\/w\/ai-capability-center\/quality-operations\?taskId=missing-task$/)
  await expect(page.getByRole('heading', { name: '质量运营' })).toBeVisible()
  await page.screenshot({ path: '.scratch/evaluation-template-node/quality-operations.png', fullPage: true })
})
