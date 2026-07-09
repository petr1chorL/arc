import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { AssetLibrary } from './AssetLibrary'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const asset = {
  id: 'asset-1',
  assetType: 'tool' as const,
  name: '价格查询',
  description: 'Query price',
  parameterSchema: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
  adapterType: 'http' as const,
  adapterConfig: { method: 'POST', url: 'https://internal.example.test/price' },
  status: 'active',
  createdBy: 'admin',
  createdAt: '2026-06-28T00:00:00Z',
  updatedAt: '2026-06-28T00:00:00Z',
}

const invocation = {
  id: 'invocation-1',
  assetId: asset.id,
  assetType: 'tool' as const,
  assetName: asset.name,
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

const auditEvent = {
  id: 'audit-1',
  eventType: 'tool_skill_asset.update',
  targetType: 'tool_skill_asset',
  targetId: asset.id,
  outcome: 'success',
  reason: '更新价格查询契约',
  actorId: 'admin',
  createdAt: '2026-06-28T00:03:00Z',
  metadata: { reason: '更新价格查询契约' },
}

function renderPage() {
  return render(
    <WorkspaceProvider workspace={workspace}>
      <MemoryRouter><AssetLibrary /></MemoryRouter>
    </WorkspaceProvider>,
  )
}

describe('AssetLibrary page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads Tool Skill assets and recent invocation logs', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/asset-library`) {
        return Promise.resolve(new Response(JSON.stringify([asset]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/invocations`) {
        return Promise.resolve(new Response(JSON.stringify([invocation]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/${asset.id}/audit-events`) {
        return Promise.resolve(new Response(JSON.stringify([auditEvent]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    }))

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Tool / Skill 资产库' })).toBeInTheDocument()
    expect((await screen.findAllByText('价格查询')).length).toBeGreaterThan(0)
    expect(screen.getByText('http')).toBeInTheDocument()
    expect(screen.getByText('最近调用')).toBeInTheDocument()
    expect(await screen.findByText('price=199')).toBeInTheDocument()
    expect(await screen.findByText('最近变更')).toBeInTheDocument()
    expect(await screen.findByText('tool_skill_asset.update')).toBeInTheDocument()
    expect(screen.getByText(/更新价格查询契约/)).toBeInTheDocument()
    expect(screen.queryByText('apiKey')).not.toBeInTheDocument()
  })

  it('validates JSON fields before creating an asset', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/asset-library`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/invocations`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await screen.findByRole('heading', { name: 'Tool / Skill 资产库' })
    fireEvent.change(screen.getByLabelText('参数 Schema JSON'), { target: { value: '{' } })
    await user.click(screen.getByRole('button', { name: '创建资产' }))

    expect(await screen.findByText('参数 Schema 必须是合法 JSON')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('creates an HTTP Tool and runs a test invocation', async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const createdAsset = { ...asset, id: 'asset-2', name: '库存查询' }
    const createdAuditEvent = {
      ...auditEvent,
      id: 'audit-created',
      eventType: 'tool_skill_asset.create',
      targetId: createdAsset.id,
      reason: 'created stock contract',
      metadata: { assetName: createdAsset.name },
    }
    const createdInvocation = {
      ...invocation,
      id: 'invocation-2',
      assetId: createdAsset.id,
      assetName: createdAsset.name,
      outputSummary: 'stock=42',
    }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      calls.push({ url, init })
      if (url === `/api/workspaces/${workspace.id}/asset-library` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/invocations` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library` && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(createdAsset), { status: 201 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/${createdAsset.id}/audit-events`) {
        return Promise.resolve(new Response(JSON.stringify([createdAuditEvent]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/${createdAsset.id}/test-invocations`) {
        return Promise.resolve(new Response(JSON.stringify(createdInvocation), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/invocations?assetId=${createdAsset.id}`) {
        return Promise.resolve(new Response(JSON.stringify([createdInvocation]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    }))

    renderPage()

    await screen.findByRole('heading', { name: 'Tool / Skill 资产库' })
    await user.type(screen.getByLabelText('资产名称'), createdAsset.name)
    await user.type(screen.getByLabelText('描述'), createdAsset.description)
    await user.selectOptions(screen.getByLabelText('适配类型'), 'http')
    fireEvent.change(screen.getByLabelText('参数 Schema JSON'), {
      target: { value: JSON.stringify(createdAsset.parameterSchema) },
    })
    fireEvent.change(screen.getByLabelText('适配配置 JSON'), {
      target: { value: JSON.stringify(createdAsset.adapterConfig) },
    })
    await user.click(screen.getByRole('button', { name: '创建资产' }))

    expect(await screen.findByText('库存查询')).toBeInTheDocument()
    expect(await screen.findByText('tool_skill_asset.create')).toBeInTheDocument()
    expect(screen.getByText(/created stock contract/)).toBeInTheDocument()
    const createCall = calls.find((call) => call.url === `/api/workspaces/${workspace.id}/asset-library` && call.init?.method === 'POST')
    expect(createCall?.init?.body).not.toContain('apiKey')

    fireEvent.change(screen.getByLabelText('测试参数 库存查询'), { target: { value: '{"sku":"A001"}' } })
    await user.click(screen.getByRole('button', { name: '测试调用 库存查询' }))

    await waitFor(() => {
      expect(screen.getAllByText('stock=42').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith(`/asset-library/invocations?assetId=${createdAsset.id}`))).toBe(true)
    })
  })

  it('edits deactivates and shows Tool Skill impact', async () => {
    const user = userEvent.setup()
    const updatedAsset = {
      ...asset,
      name: '飞书搜索 V2',
      description: 'Updated search contract',
      parameterSchema: { type: 'object', required: ['keyword'] },
      adapterConfig: { method: 'POST', url: 'https://internal.example.test/search' },
    }
    const disabledAsset = { ...updatedAsset, status: 'disabled' }
    const impact = {
      assetId: asset.id,
      assetType: 'tool',
      assetName: asset.name,
      totals: { draftAgents: 1, publishedVersions: 1 },
      draftAgents: [{ agentId: 'agent-1', agentName: '草稿工具 Agent', status: '调试中', version: 'draft' }],
      publishedVersions: [{ agentId: 'agent-2', agentName: '版本工具 Agent', versionId: 'version-1', version: 'v1.0.0' }],
    }
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      calls.push({ url, init })
      if (url === `/api/workspaces/${workspace.id}/asset-library` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([asset]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/invocations` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/${asset.id}/impact`) {
        return Promise.resolve(new Response(JSON.stringify(impact), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/${asset.id}` && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(updatedAsset), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/asset-library/${asset.id}/deactivate`) {
        return Promise.resolve(new Response(JSON.stringify(disabledAsset), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    }))

    renderPage()

    expect(await screen.findByText('草稿 Agent 1')).toBeInTheDocument()
    expect(screen.getByText('已发布版本 1')).toBeInTheDocument()
    expect(screen.getByText('草稿工具 Agent')).toBeInTheDocument()
    expect(screen.getByText('版本工具 Agent v1.0.0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '编辑 价格查询' }))
    await user.clear(screen.getByLabelText('编辑资产名称'))
    await user.type(screen.getByLabelText('编辑资产名称'), '飞书搜索 V2')
    await user.clear(screen.getByLabelText('编辑描述'))
    await user.type(screen.getByLabelText('编辑描述'), 'Updated search contract')
    fireEvent.change(screen.getByLabelText('编辑参数 Schema JSON'), {
      target: { value: JSON.stringify(updatedAsset.parameterSchema) },
    })
    fireEvent.change(screen.getByLabelText('编辑适配配置 JSON'), {
      target: { value: JSON.stringify(updatedAsset.adapterConfig) },
    })
    await user.click(screen.getByRole('button', { name: '保存 价格查询' }))

    expect(await screen.findByText('飞书搜索 V2')).toBeInTheDocument()
    const updateCall = calls.find((call) => call.url === `/api/workspaces/${workspace.id}/asset-library/${asset.id}` && call.init?.method === 'PATCH')
    expect(updateCall?.init?.body).not.toContain('apiKey')

    await user.click(screen.getByRole('button', { name: '停用 飞书搜索 V2' }))
    expect(await screen.findByText('tool · http · disabled')).toBeInTheDocument()
    expect(screen.queryByText('apiKey')).not.toBeInTheDocument()
  })
})
