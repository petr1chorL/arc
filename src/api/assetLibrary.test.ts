import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createToolSkillAsset,
  deactivateToolSkillAsset,
  getToolSkillAssetAuditEvents,
  getToolSkillAssetImpact,
  listToolSkillAssets,
  listToolSkillInvocations,
  testToolSkillAsset,
  updateToolSkillAsset,
} from './assetLibrary'
import { operationAcceptedEvent } from './operations'

describe('Asset Library API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  test('native tool test returns and announces acceptance with an idempotency key, never a completed Invocation', async () => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime')
    const accepted = { operationId: 'tool-op', invocationId: 'tool-op', kind: 'tool.test', status: 'queued', statusUrl: '/api/workspaces/workspace-1/operations/tool-op' }
    const receive = vi.fn()
    window.addEventListener(operationAcceptedEvent, receive)
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(accepted), { status: 202 })))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await testToolSkillAsset('workspace-1', 'asset-1', { parameters: { sku: 'A001' } })
      expect(result).toEqual(accepted)
      expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Idempotency-Key')).toBeTruthy()
      expect(receive).toHaveBeenCalledOnce()
      expect(result).not.toHaveProperty('outputSummary')
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally { window.removeEventListener(operationAcceptedEvent, receive) }
  })

  test('an explicit retry can reuse its original key and malformed acceptance is not announced', async () => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime')
    const accepted = { operationId: 'tool-op', status: 'queued', statusUrl: '/api/workspaces/workspace-1/operations/tool-op' }
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(accepted), { status: 202 })))
    vi.stubGlobal('fetch', fetchMock)
    for (let attempt = 0; attempt < 2; attempt++) await testToolSkillAsset('workspace-1', 'asset-1', { parameters: {} }, 'same-explicit-submission')
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init.headers).get('Idempotency-Key'))).toEqual(['same-explicit-submission', 'same-explicit-submission'])
    const receive = vi.fn()
    window.addEventListener(operationAcceptedEvent, receive)
    fetchMock.mockImplementation(() => Promise.resolve(new Response('{"id":"not-an-operation"}', { status: 202 })))
    try {
      await expect(testToolSkillAsset('workspace-1', 'asset-1', { parameters: {} })).rejects.toThrow('异步任务响应格式异常')
      expect(receive).not.toHaveBeenCalled()
    } finally { window.removeEventListener(operationAcceptedEvent, receive) }
  })

  test('lists and creates Tool Skill assets without API keys', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const asset = {
      id: 'asset-1',
      assetType: 'tool',
      name: '价格查询',
      description: 'Query price',
      parameterSchema: { type: 'object' },
      adapterType: 'http',
      adapterConfig: { method: 'POST', url: 'https://internal.example.test/price' },
      status: 'active',
      createdBy: 'admin',
      createdAt: '2026-06-28T00:00:00Z',
      updatedAt: '2026-06-28T00:00:00Z',
    }
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify(calls.length === 1 ? [asset] : asset), { status: calls.length === 1 ? 200 : 201 })
    }))

    const assets = await listToolSkillAssets('workspace-1')
    const created = await createToolSkillAsset('workspace-1', {
      assetType: 'tool',
      name: '价格查询',
      description: 'Query price',
      parameterSchema: { type: 'object' },
      adapterType: 'http',
      adapterConfig: { method: 'POST', url: 'https://internal.example.test/price' },
    })

    expect(assets).toEqual([asset])
    expect(created).toEqual(asset)
    expect(calls[0].url).toBe('/api/workspaces/workspace-1/asset-library')
    expect(calls[1].url).toBe('/api/workspaces/workspace-1/asset-library')
    expect(calls[1].init?.method).toBe('POST')
    expect(calls[1].init?.credentials).toBe('include')
    expect(calls[1].init?.body).not.toContain('apiKey')
  })

  test('preserves a legacy 201 Tool test Invocation and lists invocation logs', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const invocation = {
      id: 'invocation-1',
      assetId: 'asset-1',
      assetType: 'tool',
      assetName: '价格查询',
      agentId: null,
      agentVersion: '',
      runId: null,
      nodeRunId: null,
      status: 'success',
      inputSummary: '{"sku":"A001"}',
      outputSummary: 'price=199',
      error: '',
      durationMs: 12,
      createdAt: '2026-06-28T00:00:00Z',
    }
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify(calls.length === 1 ? invocation : [invocation]), { status: calls.length === 1 ? 201 : 200 })
    }))

    const result = await testToolSkillAsset('workspace-1', 'asset-1', { parameters: { sku: 'A001' } })
    const logs = await listToolSkillInvocations('workspace-1', 'asset-1')

    expect(result).toEqual(invocation)
    expect(logs).toEqual([invocation])
    expect(calls[0].url).toBe('/api/workspaces/workspace-1/asset-library/asset-1/test-invocations')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.body).toContain('"sku":"A001"')
    expect(calls[0].init?.body).not.toContain('apiKey')
    expect(calls[1].url).toBe('/api/workspaces/workspace-1/asset-library/invocations?assetId=asset-1')
  })

  test('updates deactivates and loads impact without API keys', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const asset = {
      id: 'asset-1',
      assetType: 'tool',
      name: '飞书搜索 V2',
      description: 'Updated search',
      parameterSchema: { type: 'object', required: ['keyword'] },
      adapterType: 'http',
      adapterConfig: { method: 'POST', url: 'https://internal.example.test/search' },
      status: 'active',
      createdBy: 'admin',
      createdAt: '2026-06-28T00:00:00Z',
      updatedAt: '2026-06-28T00:00:00Z',
    }
    const disabled = { ...asset, status: 'disabled' }
    const impact = {
      assetId: 'asset-1',
      assetType: 'tool',
      assetName: '飞书搜索 V2',
      totals: { draftAgents: 1, publishedVersions: 1 },
      draftAgents: [{ agentId: 'agent-1', agentName: '草稿 Agent', status: '调试中', version: 'draft' }],
      publishedVersions: [{ agentId: 'agent-2', agentName: '版本 Agent', versionId: 'version-1', version: 'v1.0.0' }],
    }
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/impact')) {
        return new Response(JSON.stringify(impact), { status: 200 })
      }
      if (String(url).endsWith('/deactivate')) {
        return new Response(JSON.stringify(disabled), { status: 200 })
      }
      return new Response(JSON.stringify(asset), { status: 200 })
    }))

    const updated = await updateToolSkillAsset('workspace-1', 'asset-1', {
      name: '飞书搜索 V2',
      description: 'Updated search',
      parameterSchema: { type: 'object', required: ['keyword'] },
      adapterType: 'http',
      adapterConfig: { method: 'POST', url: 'https://internal.example.test/search' },
    })
    const deactivated = await deactivateToolSkillAsset('workspace-1', 'asset-1')
    const loadedImpact = await getToolSkillAssetImpact('workspace-1', 'asset-1')

    expect(updated).toEqual(asset)
    expect(deactivated).toEqual(disabled)
    expect(loadedImpact).toEqual(impact)
    expect(calls[0].url).toBe('/api/workspaces/workspace-1/asset-library/asset-1')
    expect(calls[0].init?.method).toBe('PATCH')
    expect(calls[0].init?.body).not.toContain('apiKey')
    expect(calls[1].url).toBe('/api/workspaces/workspace-1/asset-library/asset-1/deactivate')
    expect(calls[1].init?.method).toBe('POST')
    expect(calls[2].url).toBe('/api/workspaces/workspace-1/asset-library/asset-1/impact')
  })

  test('loads Tool Skill asset audit events without API keys', async () => {
    const auditEvents = [{
      id: 'audit-1',
      eventType: 'tool_skill_asset.update',
      targetType: 'tool_skill_asset',
      targetId: 'asset-1',
      outcome: 'success',
      reason: '更新价格查询契约',
      actorId: 'admin',
      createdAt: '2026-06-28T00:03:00Z',
      metadata: { reason: '更新价格查询契约' },
    }]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(auditEvents), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getToolSkillAssetAuditEvents('workspace-1', 'asset-1')).resolves.toEqual(auditEvents)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/asset-library/asset-1/audit-events',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(JSON.stringify(auditEvents)).not.toContain('apiKey')
  })
})
