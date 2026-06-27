import { afterEach, describe, expect, test, vi } from 'vitest'
import { listWorkspaceAuditEvents } from './audit'

describe('Workspace Audit API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('lists workspace audit events with filters', async () => {
    const events = [{
      id: 'audit-1',
      action: 'tool_skill_asset.update',
      targetType: 'tool_skill_asset',
      targetId: 'asset-1',
      outcome: 'success',
      reason: '更新资产',
      actorId: 'admin',
      requestId: 'req-1',
      traceId: 'trace-1',
      spanId: null,
      createdAt: '2026-06-28T00:03:00Z',
      metadata: { assetName: '价格查询 Tool' },
    }]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(events), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listWorkspaceAuditEvents('workspace-1', {
      action: 'tool_skill_asset.update',
      targetType: 'tool_skill_asset',
      outcome: 'success',
      limit: 25,
    })).resolves.toEqual(events)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/audit-events?action=tool_skill_asset.update&targetType=tool_skill_asset&outcome=success&limit=25',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(JSON.stringify(events)).not.toContain('apiKey')
  })
})
