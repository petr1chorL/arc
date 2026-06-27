import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createToolSkillAsset,
  listToolSkillAssets,
  listToolSkillInvocations,
  testToolSkillAsset,
} from './assetLibrary'

describe('Asset Library API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(calls[1].init?.credentials).toBe('same-origin')
    expect(calls[1].init?.body).not.toContain('apiKey')
  })

  test('runs Tool test invocation and lists invocation logs', async () => {
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
      return new Response(JSON.stringify(calls.length === 1 ? invocation : [invocation]), { status: 200 })
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
})
