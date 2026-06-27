import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createModelProvider,
  listModelProviders,
  testModelProviderConnection,
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
})
