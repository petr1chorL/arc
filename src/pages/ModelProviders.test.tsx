import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { ModelProviders } from './ModelProviders'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const provider = {
  id: 'provider-1',
  name: 'DeepSeek 生产',
  providerType: 'openai-compatible' as const,
  baseUrl: 'https://api.deepseek.com',
  defaultModel: 'deepseek-v4-pro',
  secretRef: 'DEEPSEEK_API_KEY',
  status: 'draft',
  createdBy: 'user-1',
  createdAt: '2026-06-28T00:00:00Z',
  updatedAt: '2026-06-28T00:00:00Z',
}

function renderPage() {
  return render(
    <WorkspaceProvider workspace={workspace}>
      <MemoryRouter><ModelProviders /></MemoryRouter>
    </WorkspaceProvider>,
  )
}

describe('ModelProviders page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a Provider with a secret reference and tests connectivity', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/model-providers` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/model-providers` && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(provider), { status: 201 }))
      }
      if (url === `/api/workspaces/${workspace.id}/model-providers/${provider.id}/test`) {
        return Promise.resolve(new Response(JSON.stringify({
          providerId: provider.id,
          status: 'missing_secret',
          message: '密钥引用 DEEPSEEK_API_KEY 未在后端环境变量中配置',
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByRole('heading', { name: '模型 Provider' })).toBeInTheDocument()
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('名称'), provider.name)
    await user.selectOptions(screen.getByLabelText('Provider 类型'), provider.providerType)
    await user.type(screen.getByLabelText('Base URL'), provider.baseUrl)
    await user.type(screen.getByLabelText('默认模型'), provider.defaultModel)
    await user.type(screen.getByLabelText('Secret Ref'), provider.secretRef)
    await user.click(screen.getByRole('button', { name: '创建 Provider' }))

    expect(await screen.findByText(provider.name)).toBeInTheDocument()
    const createBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(createBody.secretRef).toBe(provider.secretRef)
    expect(createBody).not.toHaveProperty('apiKey')

    await user.click(screen.getByRole('button', { name: '测试连接 DeepSeek 生产' }))
    expect(await screen.findByText('密钥引用 DEEPSEEK_API_KEY 未在后端环境变量中配置')).toBeInTheDocument()
  })
})
