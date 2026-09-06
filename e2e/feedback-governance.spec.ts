import { test, expect } from '@playwright/test'

for (const expert of [true, false]) test(`candidate governance ${expert ? 'expert persists confirmation' : 'nonexpert is denied'}`, async ({ page }, testInfo) => {
  const id = expert ? 'candidate-expert' : 'candidate-denied'
  const forbidden: string[] = []
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:48273/') || /\/human-tasks|\/runs|\/reviewers|\/review-groups/.test(request.url())) forbidden.push(request.url())
  })
  await page.goto('/w/synthetic/reviews')
  await page.getByLabel('邮箱').fill(expert ? 'browser@example.invalid' : 'nonexpert@example.invalid')
  await page.getByLabel('密码').fill('Synthetic browser password 42!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: new RegExp(`查看候选 ${id}`) }).click()
  await expect(page.getByText('Synthetic original', { exact: true })).toBeVisible()
  await expect(page.getByText('Synthetic revised', { exact: true })).toBeVisible()
  await page.getByLabel('确认理由').fill('Browser confirmation')
  const confirming = page.waitForResponse(response => response.url().endsWith(`/${id}/confirm`))
  await page.getByRole('button', { name: '确认黄金样本', exact: true }).click()
  expect((await confirming).status()).toBe(expert ? 201 : 403)
  if (expert) await expect(page.getByText(/黄金样本已确认：/)).toBeVisible()
  else await expect(page.getByRole('alert')).toContainText('只有专家审核人可以确认黄金样本')
  await page.reload()
  await page.getByRole('button', { name: new RegExp(`查看候选 ${id}`) }).click()
  await expect(page.getByText(`状态：${expert ? '已确认' : '待确认'}`, { exact: true })).toBeVisible()
  if (expert) await expect(page.getByRole('button', { name: '确认黄金样本', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('feedback-governance.png'), fullPage: true })
  if (!expert) {
    await page.getByLabel('确认理由').scrollIntoViewIfNeeded()
    await expect(page.getByLabel('确认理由')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('feedback-confirmation.png'), fullPage: true })
  }
  expect(forbidden).toEqual([])
})
