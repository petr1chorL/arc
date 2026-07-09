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

    expect(await screen.findByRole('heading', { name: '模型资产', level: 2 })).toBeInTheDocument()
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('名称'), provider.name)
    await user.selectOptions(screen.getByLabelText('接口类型'), provider.providerType)
    await user.type(screen.getByLabelText('Base URL'), provider.baseUrl)
    await user.type(screen.getByLabelText('默认模型'), provider.defaultModel)
    await user.type(screen.getByLabelText('Secret Ref / Key'), provider.secretRef)
    await user.click(screen.getByRole('button', { name: '创建模型资产' }))

    expect(await screen.findByText(provider.name)).toBeInTheDocument()
    const createBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(createBody.secretRef).toBe(provider.secretRef)
    expect(createBody).not.toHaveProperty('apiKey')

    await user.click(screen.getByRole('button', { name: '测试连接 DeepSeek 生产' }))
    expect(await screen.findByText('密钥引用 DEEPSEEK_API_KEY 未在后端环境变量中配置')).toBeInTheDocument()
  })

  it('edits and deactivates a Provider asset from the list', async () => {
    const user = userEvent.setup()
    const updated = { ...provider, name: 'DeepSeek 更新', status: 'draft' }
    const disabled = { ...updated, status: 'disabled' }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/model-providers` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([provider]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/model-providers/${provider.id}` && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(updated), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/model-providers/${provider.id}/deactivate`) {
        return Promise.resolve(new Response(JSON.stringify(disabled), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('DeepSeek 生产')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '编辑 DeepSeek 生产' }))
    await user.clear(screen.getByLabelText('编辑名称'))
    await user.type(screen.getByLabelText('编辑名称'), 'DeepSeek 更新')
    await user.click(screen.getByRole('button', { name: '保存 DeepSeek 生产' }))

    expect(await screen.findByText('DeepSeek 更新')).toBeInTheDocument()
    const updateCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      return url === `/api/workspaces/${workspace.id}/model-providers/${provider.id}` && init?.method === 'PATCH'
    })
    const updateBody = JSON.parse(String(updateCall?.[1]?.body))
    expect(updateBody.name).toBe('DeepSeek 更新')
    expect(updateBody).not.toHaveProperty('apiKey')

    await user.click(screen.getByRole('button', { name: '停用 DeepSeek 更新' }))
    expect(await screen.findByText('disabled')).toBeInTheDocument()
  })

  it('shows compact model asset dependency metrics', async () => {
    const impact = {
      providerId: provider.id,
      totals: { draftAgents: 1, publishedVersions: 1 },
      draftAgents: [
        { agentId: 'agent-1', agentName: '草稿依赖 Agent', status: '调试中', version: 'draft' },
      ],
      publishedVersions: [
        {
          agentId: 'agent-2',
          agentName: '版本依赖 Agent',
          versionId: 'version-1',
          version: 'v1.0.0',
          modelSecretRef: 'DEEPSEEK_API_KEY',
        },
      ],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/model-providers` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([provider]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/model-providers/${provider.id}/impact`) {
        return Promise.resolve(new Response(JSON.stringify(impact), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('Agent 草稿 1')).toBeInTheDocument()
    expect(screen.getByText('发布版本 1')).toBeInTheDocument()
    expect(screen.queryByText('草稿依赖 Agent')).not.toBeInTheDocument()
    expect(screen.queryByText('版本依赖 Agent v1.0.0')).not.toBeInTheDocument()
    expect(screen.queryByText('apiKey')).not.toBeInTheDocument()
  })
})
