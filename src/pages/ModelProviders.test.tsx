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

const targetProvider = {
  ...provider,
  id: 'provider-2',
  name: 'DeepSeek 目标',
  defaultModel: 'deepseek-v4-pro',
  secretRef: 'TARGET_PROVIDER_KEY',
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

  it('shows Provider impact for draft Agents and published versions', async () => {
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

    expect(await screen.findByText('草稿 Agent 1')).toBeInTheDocument()
    expect(screen.getByText('已发布版本 1')).toBeInTheDocument()
    expect(screen.getByText('草稿依赖 Agent')).toBeInTheDocument()
    expect(screen.getByText('版本依赖 Agent v1.0.0')).toBeInTheDocument()
    expect(screen.queryByText('apiKey')).not.toBeInTheDocument()
  })

  it('shows recent Provider audit events and rollback helper metadata', async () => {
    const auditEvents = [
      {
        id: 'audit-1',
        eventType: 'model_provider.migrate_drafts',
        targetType: 'model_provider',
        targetId: provider.id,
        outcome: 'success',
        reason: 'Prepare rollback evidence.',
        actorId: 'user-1',
        createdAt: '2026-06-28T00:00:00Z',
        metadata: {
          targetProviderId: targetProvider.id,
          migratedAgentIds: ['agent-1'],
        },
      },
    ]
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/model-providers` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([provider, targetProvider]), { status: 200 }))
      }
      if (url.endsWith('/impact')) {
        return Promise.resolve(new Response(JSON.stringify({
          providerId: url.includes(provider.id) ? provider.id : targetProvider.id,
          totals: { draftAgents: 0, publishedVersions: 0 },
          draftAgents: [],
          publishedVersions: [],
        }), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/model-providers/${provider.id}/audit-events`) {
        return Promise.resolve(new Response(JSON.stringify(auditEvents), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/model-providers/${targetProvider.id}/audit-events`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('最近变更')).toBeInTheDocument()
    expect(screen.getByText('model_provider.migrate_drafts')).toBeInTheDocument()
    expect(screen.getByText('Prepare rollback evidence.')).toBeInTheDocument()
    expect(screen.getByText(`目标 Provider ${targetProvider.id}`)).toBeInTheDocument()
    expect(screen.getByText('迁移 Agent 1 个')).toBeInTheDocument()
    expect(screen.queryByText('apiKey')).not.toBeInTheDocument()
  })

  it('migrates draft Agents to another Provider from the card', async () => {
    const user = userEvent.setup()
    const initialImpact = {
      providerId: provider.id,
      totals: { draftAgents: 1, publishedVersions: 0 },
      draftAgents: [
        { agentId: 'agent-1', agentName: '迁移 Agent', status: '调试中', version: 'draft' },
      ],
      publishedVersions: [],
    }
    const targetImpact = {
      providerId: targetProvider.id,
      totals: { draftAgents: 0, publishedVersions: 0 },
      draftAgents: [],
      publishedVersions: [],
    }
    const sourceAfterMigration = {
      ...initialImpact,
      totals: { draftAgents: 0, publishedVersions: 0 },
      draftAgents: [],
    }
    const targetAfterMigration = {
      ...targetImpact,
      totals: { draftAgents: 1, publishedVersions: 0 },
      draftAgents: initialImpact.draftAgents,
    }
    let migrated = false
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/model-providers` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([provider, targetProvider]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/model-providers/${provider.id}/impact`) {
        return Promise.resolve(new Response(JSON.stringify(migrated ? sourceAfterMigration : initialImpact), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/model-providers/${targetProvider.id}/impact`) {
        return Promise.resolve(new Response(JSON.stringify(migrated ? targetAfterMigration : targetImpact), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/model-providers/${provider.id}/migrate-drafts`) {
        migrated = true
        return Promise.resolve(new Response(JSON.stringify({
          sourceProviderId: provider.id,
          targetProviderId: targetProvider.id,
          migratedCount: 1,
          migratedAgents: [
            {
              agentId: 'agent-1',
              agentName: '迁移 Agent',
              previousModel: 'legacy-model',
              nextModel: 'deepseek-v4-pro',
            },
          ],
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('草稿 Agent 1')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('迁移目标 DeepSeek 生产'), targetProvider.id)
    await user.type(screen.getByLabelText('迁移原因 DeepSeek 生产'), '切换到生产 Provider')
    await user.click(screen.getByRole('button', { name: '迁移草稿 DeepSeek 生产' }))

    expect(await screen.findByText('已迁移 1 个 Agent 草稿')).toBeInTheDocument()
    const migrationCall = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      return url === `/api/workspaces/${workspace.id}/model-providers/${provider.id}/migrate-drafts`
    })
    const body = JSON.parse(String(migrationCall?.[1]?.body))
    expect(body).toEqual({
      targetProviderId: targetProvider.id,
      reason: '切换到生产 Provider',
    })
    expect(body).not.toHaveProperty('apiKey')
  })
})
