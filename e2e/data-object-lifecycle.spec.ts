import { test, expect } from '@playwright/test'

test('Data Object page preserves both published schemas after refresh', async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'X-ARC-Test-Client': 'data-objects' })
  const forbidden: string[] = []
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:48273/') || /test-runs|test-invocations|human-tasks/.test(request.url())) forbidden.push(request.url())
  })
  await page.goto('/w/synthetic/settings/asset-library')
  await page.getByLabel('邮箱').fill('browser@example.invalid')
  await page.getByLabel('密码').fill('Synthetic browser password 42!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Data Object', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Data Object', exact: true }).click()
  const name = 'Browser Data Object'
  const first = { type: 'object', properties: { original: { type: 'string' } } }
  const second = { type: 'object', properties: { revised: { type: 'number' } } }
  await page.getByLabel('名称', { exact: true }).fill(name)
  await page.getByLabel('Schema JSON', { exact: true }).fill(JSON.stringify(first))
  await page.getByRole('button', { name: '创建 Data Object', exact: true }).click()
  await page.getByRole('button', { name: `发布 ${name}`, exact: true }).click()
  await expect(page.getByLabel('Schema v1.0.0', { exact: true })).toHaveValue(JSON.stringify(first, null, 2))
  await page.getByRole('button', { name: `编辑 ${name}`, exact: true }).click()
  await page.getByLabel('编辑 Schema JSON', { exact: true }).fill(JSON.stringify(second))
  await page.getByRole('button', { name: `保存 ${name}`, exact: true }).click()
  await expect(page.getByText('Data Object 已更新', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Schema v1.0.0', { exact: true })).toHaveValue(JSON.stringify(first, null, 2))
  await page.getByRole('button', { name: `发布 ${name}`, exact: true }).click()
  await expect(page.getByLabel('Schema v1.1.0', { exact: true })).toHaveValue(JSON.stringify(second, null, 2))
  await page.reload()
  await page.getByRole('button', { name: `历史版本 ${name}`, exact: true }).click()
  await expect(page.getByLabel('Schema v1.0.0', { exact: true })).toHaveValue(JSON.stringify(first, null, 2))
  await expect(page.getByLabel('Schema v1.1.0', { exact: true })).toHaveValue(JSON.stringify(second, null, 2))
  await expect(page.getByLabel('Schema v1.0.0', { exact: true })).toHaveAttribute('readonly', '')
  await page.screenshot({ path: testInfo.outputPath('data-object-history.png'), fullPage: true })
  await page.getByRole('region', { name: '历史版本', exact: true }).screenshot({ path: testInfo.outputPath('data-object-versions.png') })
  expect(forbidden).toEqual([])
})
