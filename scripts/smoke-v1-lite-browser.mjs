import { chromium } from 'playwright'

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

const args = parseArgs(process.argv.slice(2))
const baseUrl = (args.get('web-url') ?? process.env.ARC_ONE_WEB_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '')
const email = process.env.ARC_ONE_BROWSER_SMOKE_EMAIL
const password = process.env.ARC_ONE_BROWSER_SMOKE_PASSWORD
const runId = args.get('run-id') ?? process.env.ARC_ONE_BROWSER_SMOKE_RUN_ID ?? ''
const workspaceSlug = args.get('workspace-slug') ?? process.env.ARC_ONE_WORKSPACE_SLUG ?? 'ai-capability-center'

if (!email || !password) {
  throw new Error('Missing browser smoke credentials. Set ARC_ONE_BROWSER_SMOKE_EMAIL and ARC_ONE_BROWSER_SMOKE_PASSWORD.')
}

const expectedPages = [
  { path: `/w/${workspaceSlug}`, text: '\u8fd0\u8425\u603b\u89c8' },
  { path: `/w/${workspaceSlug}/agents`, text: 'Agent' },
  { path: `/w/${workspaceSlug}/workflows`, text: '\u5de5\u4f5c\u6d41' },
  { path: `/w/${workspaceSlug}/evaluations`, text: '\u8bc4\u4f30' },
  { path: `/w/${workspaceSlug}/reviews`, text: '\u4eba\u5de5\u5ba1\u6838' },
  { path: `/w/${workspaceSlug}/notifications`, text: '\u901a\u77e5' },
]

if (runId) {
  expectedPages.push({
    path: `/w/${workspaceSlug}/observability?runId=${encodeURIComponent(runId)}`,
    text: '\u8fd0\u884c\u89c2\u6d4b',
  })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const severeMessages = []
const authProbeMessages = []
const badResponses = []

page.on('console', (message) => {
  if (message.type() !== 'error') {
    return
  }
  const text = message.text()
  if (text.includes('401') && text.includes('Unauthorized')) {
    authProbeMessages.push(text)
    return
  }
  severeMessages.push(text)
})

page.on('response', (response) => {
  const status = response.status()
  if (status >= 500) {
    badResponses.push(`${status} ${response.url()}`)
  }
})

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('\u90ae\u7bb1').fill(email)
  await page.getByLabel('\u5bc6\u7801').fill(password)
  await page.getByRole('button', { name: '\u767b\u5f55' }).click()
  await page.waitForURL(new RegExp(`/w/${workspaceSlug}`), { timeout: 15000 })
  await page.waitForLoadState('networkidle')

  const pageResults = []
  for (const expected of expectedPages) {
    await page.goto(`${baseUrl}${expected.path}`, { waitUntil: 'networkidle' })
    const bodyText = await page.locator('body').innerText()
    const ok = bodyText.includes(expected.text)
    pageResults.push({ path: expected.path, expectedText: expected.text, ok })
    if (!ok) {
      throw new Error(`Expected text not found on ${expected.path}: ${expected.text}`)
    }
  }

  console.log(JSON.stringify({
    status: 'passed',
    baseUrl,
    workspaceSlug,
    checkedPages: pageResults,
    severeMessages,
    authProbeMessages,
    badResponses,
  }, null, 2))
} finally {
  await browser.close()
}
