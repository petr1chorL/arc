import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createModelProvider,
  deactivateModelProvider,
  getModelProviderImpact,
  listModelProviders,
  testModelProviderConnection,
  updateModelProvider,
} from './modelProviders'

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

describe('Model Provider API', () => {
  const workspaceId = 'workspace-1'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists and creates Provider assets without sending API keys', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([provider]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(provider), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listModelProviders(workspaceId)).resolves.toEqual([provider])
    await expect(createModelProvider(workspaceId, {
      name: provider.name,
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      secretRef: provider.secretRef,
    })).resolves.toEqual(provider)

    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspaces/workspace-1/model-providers')
    const [, createInit] = fetchMock.mock.calls[1]
    expect(createInit).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    })
    const body = JSON.parse(String(createInit?.body))
    expect(body).toEqual({
      name: provider.name,
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      secretRef: provider.secretRef,
    })
    expect(body).not.toHaveProperty('apiKey')
  })

  it('tests Provider connectivity through the workspace endpoint', async () => {
    const connectivity = {
      providerId: provider.id,
      status: 'missing_secret',
      message: '密钥引用 DEEPSEEK_API_KEY 未在后端环境变量中配置',
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(connectivity), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(testModelProviderConnection(workspaceId, provider.id)).resolves.toEqual(connectivity)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/model-providers/provider-1/test',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    )
  })

  it('updates and deactivates Provider assets without API keys', async () => {
    const updated = {
      ...provider,
      name: 'DeepSeek 更新',
      status: 'disabled',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...updated, status: 'draft' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(updateModelProvider(workspaceId, provider.id, {
      name: 'DeepSeek 更新',
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      secretRef: provider.secretRef,
    })).resolves.toEqual({ ...updated, status: 'draft' })
    await expect(deactivateModelProvider(workspaceId, provider.id)).resolves.toEqual(updated)

    const [, updateInit] = fetchMock.mock.calls[0]
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspaces/workspace-1/model-providers/provider-1')
    expect(updateInit).toMatchObject({
      method: 'PATCH',
      credentials: 'same-origin',
    })
    const updateBody = JSON.parse(String(updateInit?.body))
    expect(updateBody.name).toBe('DeepSeek 更新')
    expect(updateBody).not.toHaveProperty('apiKey')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/model-providers/provider-1/deactivate',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    )
  })

  it('loads Provider impact without API keys', async () => {
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(impact), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getModelProviderImpact(workspaceId, provider.id)).resolves.toEqual(impact)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/model-providers/provider-1/impact',
      expect.objectContaining({
        credentials: 'same-origin',
      }),
    )
    expect(JSON.stringify(impact)).not.toContain('apiKey')
  })
})
