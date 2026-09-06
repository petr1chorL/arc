import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { AssetLibrary } from './AssetLibrary'
import { operationAcceptedEvent, operationUpdatedEvent } from '../api/operations'

vi.mock('../auth/authContext', () => ({ useAuth: () => ({ user: { id: 'user-1', isOrganizationAdmin: false } }) }))

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
  it('reuses the same submission key after a lost response and starts a new key only after acceptance', async () => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime')
    const keys: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/test-invocations')) {
        keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '')
        if (keys.length === 1) return Promise.reject(new Error('response lost'))
        return Promise.resolve(new Response(JSON.stringify({ operationId: 'tool-op', invocationId: 'tool-op', status: 'queued', statusUrl: '/ignored' }), { status: 202 }))
      }
      if (url.endsWith('/impact')) return Promise.resolve(new Response('{}', { status: 503 }))
      return Promise.resolve(new Response(JSON.stringify(url.endsWith('/asset-library') ? [asset] : [])))
    }))
    render(<WorkspaceProvider workspace={{ ...workspace, role: 'builder' }}><MemoryRouter><AssetLibrary /></MemoryRouter></WorkspaceProvider>)
    const button = await screen.findByRole('button', { name: `测试调用 ${asset.name}` })
    fireEvent.click(button)
    await screen.findByText('response lost')
    fireEvent.click(button)
    await screen.findByText(/测试已受理，尚未完成/)
    expect(keys[0]).not.toBe(''); expect(keys[1]).toBe(keys[0])
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(keys).toHaveLength(3))
    expect(keys[2]).not.toBe(keys[0])
  })
  it('keeps native Tool testing disabled for an operator and for a disabled asset', async () => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime')
    const fetchMock = vi.fn((input: RequestInfo | URL) => Promise.resolve(String(input).endsWith('/impact')
      ? new Response('{}', { status: 503 }) : new Response(JSON.stringify(String(input).endsWith('/asset-library') ? [asset, { ...asset, id: 'disabled', name: '停用工具', status: 'disabled' }] : []))))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<WorkspaceProvider workspace={{ ...workspace, role: 'operator' }}><MemoryRouter><AssetLibrary /></MemoryRouter></WorkspaceProvider>)
    expect(await screen.findByRole('button', { name: `测试调用 ${asset.name}` })).toBeDisabled()
    view.rerender(<WorkspaceProvider workspace={{ ...workspace, role: 'builder' }}><MemoryRouter><AssetLibrary /></MemoryRouter></WorkspaceProvider>)
    expect(screen.getByRole('button', { name: `测试调用 ${asset.name}` })).toBeEnabled()
    expect(screen.getByRole('button', { name: '测试调用 停用工具' })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/test-invocations'))).toBe(false)
  })
  it.each(['workspace-change', 'unmount'])('does not apply late Tool acceptance or refresh old data after %s', async (transition) => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime')
    let release!: (response: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/test-invocations')) return pending
      if (url.endsWith('/impact')) return Promise.resolve(new Response('{}', { status: 503 }))
      return Promise.resolve(new Response(JSON.stringify(url.endsWith('/asset-library') ? [{ ...asset, name: url.includes('/next/') ? '另一个空间工具' : asset.name }] : [])))
    })
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<WorkspaceProvider workspace={{ ...workspace, role: 'builder' }}><MemoryRouter><AssetLibrary /></MemoryRouter></WorkspaceProvider>)
    fireEvent.click(await screen.findByRole('button', { name: `测试调用 ${asset.name}` }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/test-invocations'))).toBe(true))
    if (transition === 'unmount') view.unmount()
    else {
      view.rerender(<WorkspaceProvider workspace={{ ...workspace, id: 'next', slug: 'next', role: 'builder' }}><MemoryRouter><AssetLibrary /></MemoryRouter></WorkspaceProvider>)
      await screen.findByText('另一个空间工具')
    }
    const oldReads = fetchMock.mock.calls.filter(([url]) => String(url).includes(`/workspaces/${workspace.id}/`) && !String(url).endsWith('/test-invocations')).length
    await act(async () => { release(new Response(JSON.stringify({ operationId: 'old-op', status: 'queued', statusUrl: '/ignored' }), { status: 202 })); await pending })
    expect(screen.queryByText(/测试已受理/)).not.toBeInTheDocument()
    expect(screen.queryByText(/old-op/)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes(`/workspaces/${workspace.id}/`) && !String(url).endsWith('/test-invocations')).length).toBe(oldReads)
  })
  it('accepts a native Tool test without calling it complete and hides native invocation text', async () => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime')
    const accepted = { operationId: 'tool-op', invocationId: 'tool-op', status: 'queued', statusUrl: 'https://untrusted.example.invalid/status' }
    let submitted = false
    const receive = vi.fn()
    window.addEventListener(operationAcceptedEvent, receive)
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/impact')) return Promise.resolve(new Response('{}', { status: 503 }))
      if (url.endsWith('/test-invocations')) { submitted = true; return Promise.resolve(new Response(JSON.stringify(accepted), { status: 202 })) }
      if (url.includes('/invocations')) return Promise.resolve(new Response(JSON.stringify(submitted ? [{ ...invocation, id: 'tool-op', operationId: 'tool-op', status: 'pending', inputSummary: 'PRIVATE_INPUT', outputSummary: 'PRIVATE_OUTPUT', assetName: 'PRIVATE_HISTORICAL_NAME' }] : [])))
      return Promise.resolve(new Response(JSON.stringify(url.endsWith('/asset-library') ? [asset] : [])))
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<WorkspaceProvider workspace={{ ...workspace, role: 'builder' }}><MemoryRouter><AssetLibrary /></MemoryRouter></WorkspaceProvider>)
      const button = await screen.findByRole('button', { name: `测试调用 ${asset.name}` })
      expect(button).toBeEnabled()
      fireEvent.click(button)
      await screen.findByText('测试已受理，尚未完成；请查看异步任务进度。')
      await waitFor(() => expect(screen.getAllByRole('link', { name: '查看测试任务' }).length).toBeGreaterThan(0))
      expect(screen.queryByText('测试调用完成')).not.toBeInTheDocument()
      expect(screen.queryByText('PRIVATE_INPUT')).not.toBeInTheDocument()
      expect(screen.queryByText('PRIVATE_OUTPUT')).not.toBeInTheDocument()
      expect(screen.queryByText('PRIVATE_HISTORICAL_NAME')).not.toBeInTheDocument()
      expect(receive).toHaveBeenCalledOnce()
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('untrusted.example'))).toBe(false)
      act(() => window.dispatchEvent(new CustomEvent(operationUpdatedEvent, { detail: { workspaceId: workspace.id, operation: { ...accepted, kind: 'tool.test', status: 'failed' } } })))
      await screen.findByText('工具测试：失败。')
    } finally { window.removeEventListener(operationAcceptedEvent, receive) }
  })
  it('retains accepted status when invocation refresh fails and retries only the read', async () => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime')
    let posted = false, readsFail = true
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/test-invocations')) { posted = true; return Promise.resolve(new Response(JSON.stringify({ operationId: 'op-refresh', status: 'queued', statusUrl: '/ignored' }), { status: 202 })) }
      if (url.includes('/invocations')) return Promise.resolve(posted && readsFail ? new Response('{"detail":"历史读取不可用"}', { status: 503 }) : new Response('[]'))
      if (url.endsWith('/impact')) return Promise.resolve(new Response('{}', { status: 503 }))
      return Promise.resolve(new Response(JSON.stringify(url.endsWith('/asset-library') ? [asset] : [])))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<WorkspaceProvider workspace={{ ...workspace, role: 'builder' }}><MemoryRouter><AssetLibrary /></MemoryRouter></WorkspaceProvider>)
    fireEvent.click(await screen.findByRole('button', { name: `测试调用 ${asset.name}` }))
    await screen.findByText('历史读取不可用')
    expect(screen.getByText('测试已受理，尚未完成；请查看异步任务进度。')).toBeInTheDocument()
    readsFail = false
    fireEvent.click(screen.getByRole('button', { name: '重试调用记录' }))
    await waitFor(() => expect(screen.queryByText('历史读取不可用')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/test-invocations'))).toHaveLength(1)
  })
  it('uses bounded HTTP registration fields in migration mode', async () => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'reference-assets')
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(String(input).endsWith('/impact')
      ? new Response('{}', { status: 503 }) : new Response(
      JSON.stringify(['POST','PATCH'].includes(init?.method ?? '') ? { ...asset, id: 'new', name: 'Bounded' } : []),
      { status: init?.method === 'POST' ? 201 : 200 })))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText('暂无 Tool / Skill 资产。')
    expect(screen.queryByLabelText('适配配置 JSON')).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('适配类型'), 'http')
    await userEvent.type(screen.getByLabelText('资产名称'), 'Bounded')
    await userEvent.type(screen.getByLabelText('HTTP 地址'), 'https://tools.example.invalid/run')
    await userEvent.selectOptions(screen.getByLabelText('HTTP 方法'), 'GET')
    await userEvent.click(screen.getByRole('button', { name: '创建资产' }))
    const posted = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(posted?.[1]?.body)).adapterConfig).toEqual({ url: 'https://tools.example.invalid/run', method: 'GET' })
    await userEvent.click(await screen.findByRole('button', { name: '编辑 Bounded' }))
    await userEvent.selectOptions(screen.getByLabelText('编辑适配类型'), 'mcp')
    await userEvent.click(screen.getByRole('button', { name: '保存 Bounded' }))
    const patched = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(JSON.parse(String(patched?.[1]?.body)).adapterConfig).toEqual({})
  })
  it('clears stale impact and audit records when post-edit refresh fails', async () => {
    let changed = false
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PATCH') {
        changed = true
        return Promise.resolve(new Response(JSON.stringify(asset), { status: 200 }))
      }
      if (url.endsWith('/impact')) return Promise.resolve(changed
        ? new Response('{}', { status: 503 })
        : new Response(JSON.stringify({ assetId: asset.id, assetType: 'tool', assetName: asset.name,
          totals: { draftAgents: 7, publishedVersions: 0 }, draftAgents: [], publishedVersions: [] }), { status: 200 }))
      if (url.endsWith('/audit-events')) return Promise.resolve(changed
        ? new Response('{}', { status: 403 }) : new Response(JSON.stringify([auditEvent]), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify(url.endsWith('/asset-library') ? [asset] : []), { status: 200 }))
    }))
    renderPage()
    expect(await screen.findByText('草稿 Agent 7')).toBeInTheDocument()
    expect(await screen.findByText(/更新价格查询契约/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: `编辑 ${asset.name}` }))
    await userEvent.click(screen.getByRole('button', { name: `保存 ${asset.name}` }))
    expect(await screen.findByText('影响面不可用，不能确认引用数量')).toBeInTheDocument()
    expect(await screen.findByText('审计记录不可用或无读取权限')).toBeInTheDocument()
    expect(screen.queryByText('草稿 Agent 7')).not.toBeInTheDocument()
    expect(screen.queryByText(/更新价格查询契约/)).not.toBeInTheDocument()
    expect(screen.getByText(asset.name)).toBeInTheDocument()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('blocks tool calls in reference asset migration mode', async () => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'reference-assets')
    const fetchMock = vi.fn((input: RequestInfo | URL) => Promise.resolve(String(input).endsWith('/impact')
      ? new Response(JSON.stringify({ detail: 'unavailable' }), { status: 503 })
      : new Response(JSON.stringify(String(input).endsWith('/asset-library') ? [asset] : []), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    const button = await screen.findByRole('button', { name: `测试调用 ${asset.name}` })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/test-invocations'))).toBe(false)
    expect(screen.getByText('资产迁移验证模式：仅登记与读取，测试调用尚未迁移。')).toBeInTheDocument()
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
