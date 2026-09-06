import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Evaluations } from './Evaluations'

const workspace = { id: 'workspace-1', slug: 'ai-capability-center', name: 'AI 能力中心' }
const rubric = {
  id: 'rubric-1', name: '研究报告质量模板', artifact: '研究报告',
  dimensions: [
    { id: 'accuracy', name: '准确性', weight: 60, criteria: '事实准确且有证据' },
    { id: 'completeness', name: '完整性', weight: 40, criteria: '覆盖所有必答项' },
  ],
  gate: '必须包含来源', passScore: 85, judgeType: 'llm' as const,
  judgeModel: 'deepseek-chat', modelProviderId: 'provider-1', version: 'v1.0', status: 'active',
}
const provider = {
  id: 'provider-1', name: 'DeepSeek 主模型', providerType: 'openai-compatible',
  baseUrl: 'https://api.example.com', defaultModel: 'deepseek-chat', secretRef: 'DO_NOT_RENDER',
  status: 'active', createdBy: 'user-1', createdAt: '2026-07-14T00:00:00Z', updatedAt: '2026-07-14T00:00:00Z',
}

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }))
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderPage(initialEntry = '/w/ai-capability-center/evaluations') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkspaceProvider workspace={workspace}>
        <Routes>
          <Route path="/w/:workspaceSlug/evaluations" element={<><Evaluations /><LocationProbe /></>} />
          <Route path="/w/:workspaceSlug/evaluations/:rubricId" element={<><Evaluations /><LocationProbe /></>} />
        </Routes>
      </WorkspaceProvider>
    </MemoryRouter>,
  )
}

describe('Evaluations template library', () => {
  it('ignores a previous Workspace asset response after switching Workspace', async () => {
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    const second = { ...rubric, id: 'second', name: 'Other workspace rubric' }
    const nextWorkspace = { ...workspace, id: 'workspace-2', slug: 'other' }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/model-providers')) return response([])
      return url.includes('/workspace-1/') ? pending : response([second])
    }))
    const page = (current: typeof workspace) => <MemoryRouter><WorkspaceProvider workspace={current}><Evaluations /></WorkspaceProvider></MemoryRouter>
    const view = render(page(workspace))
    view.rerender(page(nextWorkspace))
    expect(await screen.findByRole('button', { name: second.name })).toBeInTheDocument()
    await act(async () => { release(new Response(JSON.stringify([rubric]))); await pending })
    expect(screen.getByRole('button', { name: second.name })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: rubric.name })).not.toBeInTheDocument()
  })

  it('does not navigate back to a late creation after leaving the editor', async () => {
    const user = userEvent.setup()
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return pending
      if (String(input).endsWith('/model-providers')) return response([provider])
      if (String(input).endsWith('/versions')) return response([])
      return response([rubric])
    }))
    render(<MemoryRouter initialEntries={['/w/a/evaluations/new']}><WorkspaceProvider workspace={workspace}>
      <Link to="/w/a/evaluations/rubric-1">Leave creation</Link><LocationProbe />
      <Routes><Route path="/w/:workspaceSlug/evaluations/:rubricId" element={<Evaluations />} /></Routes>
    </WorkspaceProvider></MemoryRouter>)
    await screen.findByLabelText('模板名称')
    for (const label of ['模板名称', '适用产出物', '硬性门禁', '维度 1 名称', '维度 1 评分标准']) {
      await user.type(screen.getByLabelText(label), 'Synthetic')
    }
    await user.click(screen.getByRole('button', { name: /保存模板/ }))
    await user.click(screen.getByRole('link', { name: 'Leave creation' }))
    await screen.findByDisplayValue(rubric.name)
    await act(async () => { release(new Response(JSON.stringify({ ...rubric, id: 'late-created' }), { status: 201 })); await pending })
    expect(screen.getByTestId('location')).toHaveTextContent('/w/a/evaluations/rubric-1')
  })

  it.each(['save', 'publish', 'deactivate'])('ignores a late %s response after switching editors', async operation => {
    const user = userEvent.setup()
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    const second = { ...rubric, id: 'rubric-2', name: 'Second rubric' }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PATCH' || init?.method === 'POST') return pending
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/versions')) return response([])
      return response([rubric, second])
    }))
    render(<MemoryRouter initialEntries={['/w/a/evaluations/rubric-1']}><WorkspaceProvider workspace={workspace}>
      <Link to="/w/a/evaluations/rubric-2">Switch rubric</Link>
      <Routes><Route path="/w/:workspaceSlug/evaluations/:rubricId" element={<Evaluations />} /></Routes>
    </WorkspaceProvider></MemoryRouter>)
    await screen.findByDisplayValue(rubric.name)
    await user.click(screen.getByRole('button', { name: operation === 'save' ? /保存模板/ : operation === 'publish' ? '发布版本' : '停用模板' }))
    await user.click(screen.getByRole('link', { name: 'Switch rubric' }))
    await screen.findByDisplayValue(second.name)
    const returned = operation === 'publish'
      ? { id: 'late-version', version: 'v9.0.0', snapshot: rubric, createdAt: provider.createdAt }
      : { ...rubric, name: 'Late saved rubric', status: operation === 'deactivate' ? 'disabled' : 'active' }
    await act(async () => { release(new Response(JSON.stringify(returned))); await pending })
    expect(screen.getByLabelText('模板名称')).toHaveValue(second.name)
    expect(screen.getByRole('button', { name: /保存模板/ })).toBeEnabled()
    expect(screen.queryByText(/已发布不可变版本 v9|评估模板已停用|评估模板已保存/)).not.toBeInTheDocument()
  })

  it('ignores previous editor history after changing rubric routes', async () => {
    const user = userEvent.setup()
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    const second = { ...rubric, id: 'rubric-2', name: 'Second rubric' }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/rubric-1/versions')) return pending
      if (url.endsWith('/rubric-2/versions')) return response([{ id: 'second', version: 'v2.0.0', snapshot: second, createdAt: '2026-09-05T00:00:00Z' }])
      return response([rubric, second])
    }))
    render(<MemoryRouter initialEntries={['/w/a/evaluations/rubric-1']}><WorkspaceProvider workspace={workspace}>
      <Link to="/w/a/evaluations/rubric-2">Switch rubric</Link>
      <Routes><Route path="/w/:workspaceSlug/evaluations/:rubricId" element={<Evaluations />} /></Routes>
    </WorkspaceProvider></MemoryRouter>)
    expect(await screen.findByDisplayValue(rubric.name)).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Switch rubric' }))
    expect(await screen.findByDisplayValue(second.name)).toBeInTheDocument()
    expect(await screen.findByText('版本 v2.0.0')).toBeInTheDocument()
    await act(async () => { release(new Response(JSON.stringify([{ id: 'first', version: 'v1.9.0', snapshot: rubric, createdAt: '2026-09-05T00:00:00Z' }]))); await pending })
    expect(screen.getByText('版本 v2.0.0')).toBeInTheDocument()
    expect(screen.queryByText('版本 v1.9.0')).not.toBeInTheDocument()
  })

  it('keeps late history from a closed dialog out of another rubric dialog', async () => {
    const user = userEvent.setup()
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    const second = { ...rubric, id: 'rubric-2', name: 'Second rubric' }
    const version = (id: string, version: string) => ({ id, version, snapshot: rubric, createdAt: '2026-09-05T00:00:00Z' })
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/rubric-1/versions')) return pending
      if (url.endsWith('/rubric-2/versions')) return response([version('second', 'v2.0.0')])
      return response([rubric, second])
    }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: `查看版本记录 ${rubric.name}` }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button'))
    await user.click(screen.getByRole('button', { name: '查看版本记录 Second rubric' }))
    expect(await screen.findByText('版本 v2.0.0')).toBeInTheDocument()
    await act(async () => { release(new Response(JSON.stringify([version('first', 'v1.9.0')]))); await pending })
    expect(within(screen.getByRole('dialog')).getByText('版本 v2.0.0')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).queryByText('版本 v1.9.0')).not.toBeInTheDocument()
  })

  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('迁移模式依赖失败时阻断直达编辑页的保存并明确错误', async () => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'rubric-samples')
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).endsWith('/model-providers')
      ? response({ detail: 'Provider 不可用' }, 503) : response([])))
    renderPage('/w/ai-capability-center/evaluations/new')
    expect(await screen.findByText('Provider 不可用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保存模板/ })).toBeDisabled()
    expect(screen.getByText(/量规迁移验证模式/)).toBeInTheDocument()
  })

  it('只加载模板和模型配置，并展示模板卡片而不暴露密钥引用', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/evaluations/rubrics')) return response([rubric])
      if (url.endsWith('/model-providers')) return response([provider])
      return response({ detail: `unexpected ${url}` }, 500)
    }))
    renderPage()

    expect(await screen.findByRole('heading', { name: '评估模板' })).toBeInTheDocument()
    const row = screen.getByRole('article', { name: '研究报告质量模板' })
    expect(within(row).getByRole('button', { name: '研究报告质量模板' })).toBeInTheDocument()
    const metadata = within(row).getByLabelText('研究报告质量模板 元信息')
    expect(within(metadata).getByText('使用模型')).toBeInTheDocument()
    expect(within(metadata).getByText('DeepSeek 主模型 / deepseek-chat')).toBeInTheDocument()
    expect(within(metadata).getByText('版本')).toBeInTheDocument()
    expect(within(metadata).getByText('v1.0')).toBeInTheDocument()
    expect(within(metadata).getByText('状态')).toBeInTheDocument()
    expect(within(metadata).getByText('已发布')).toBeInTheDocument()
    expect(within(metadata).getByText('通过分')).toBeInTheDocument()
    expect(within(metadata).getByText('85')).toBeInTheDocument()
    expect(within(metadata).getByText('维度')).toBeInTheDocument()
    expect(within(metadata).getByText('2 个维度')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '查看版本记录 研究报告质量模板' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '编辑 研究报告质量模板' })).toBeInTheDocument()
    expect(within(row).queryByText('必须包含来源')).not.toBeInTheDocument()
    expect(within(row).queryByText('研究报告')).not.toBeInTheDocument()
    expect(screen.queryByText('DO_NOT_RENDER')).not.toBeInTheDocument()
    expect(screen.queryByText(/Golden Set|Regression Run|Remediation Task/i)).not.toBeInTheDocument()
    expect(calls).toEqual([
      `/api/workspaces/${workspace.id}/evaluations/rubrics`,
      `/api/workspaces/${workspace.id}/model-providers`,
    ])
  })

  it('点击模板名称进入同一个模板编辑路由', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/evaluations/rubrics')) return response([rubric])
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/rubrics/rubric-1/versions')) return response([])
      return response({ detail: 'unexpected' }, 500)
    }))

    renderPage()
    await user.click(await screen.findByRole('button', { name: '研究报告质量模板' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/w/ai-capability-center/evaluations/rubric-1')
    expect(await screen.findByRole('heading', { name: '管理评估模板' })).toBeInTheDocument()
  })
  it('支持编辑、查看版本、发布和停用模板', async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string, method: string }> = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method })
      if (url.endsWith('/evaluations/rubrics') && method === 'GET') return response([rubric])
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/rubrics/rubric-1') && method === 'PATCH') {
        return response({ ...rubric, name: '研究报告质量模板 v2' })
      }
      if (url.endsWith('/rubrics/rubric-1/versions')) {
        return response([{ id: 'version-1', version: 'v1.0', snapshot: rubric, createdAt: '2026-07-14T00:00:00Z' }])
      }
      if (url.endsWith('/rubrics/rubric-1/publish') && method === 'POST') {
        return response({ id: 'version-2', version: 'v1.1', snapshot: rubric, createdAt: '2026-07-15T00:00:00Z' })
      }
      if (url.endsWith('/rubrics/rubric-1/deactivate') && method === 'POST') {
        return response({ ...rubric, status: 'disabled', version: 'v1.1' })
      }
      return response({ detail: `unexpected ${method} ${url}` }, 500)
    }))

    renderPage()
    await user.click(await screen.findByRole('button', { name: '查看版本记录 研究报告质量模板' }))
    const versionDialog = await screen.findByRole('dialog', { name: '评估模板版本记录' })
    expect(within(versionDialog).getByText('版本 v1.0')).toBeInTheDocument()
    await user.click(within(versionDialog).getByTitle('关闭'))
    await user.click(screen.getByRole('button', { name: '编辑 研究报告质量模板' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/w/ai-capability-center/evaluations/rubric-1')
    const firstDimension = screen.getByLabelText('维度 1 名称').closest('.rubric-dimension-row')
    expect(firstDimension).toBeInTheDocument()
    expect(firstDimension?.querySelector('.rubric-dimension-name')).toBeInTheDocument()
    expect(firstDimension?.querySelector('.rubric-dimension-criteria')).toBeInTheDocument()
    expect(firstDimension?.querySelector('.rubric-dimension-weight')).toBeInTheDocument()
    expect(await screen.findByText('版本 v1.0')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('模板名称'))
    await user.type(screen.getByLabelText('模板名称'), '研究报告质量模板 v2')
    await user.click(screen.getByRole('button', { name: '保存模板' }))
    expect(await screen.findByText('评估模板已保存')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '发布版本' }))
    expect(await screen.findByText('已发布不可变版本 v1.1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '停用模板' }))
    expect(await screen.findByText('评估模板已停用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停用模板' })).toBeDisabled()
    expect(calls).toEqual(expect.arrayContaining([
      { url: `/api/workspaces/${workspace.id}/evaluations/rubrics/rubric-1/versions`, method: 'GET' },
      { url: `/api/workspaces/${workspace.id}/evaluations/rubrics/rubric-1/publish`, method: 'POST' },
      { url: `/api/workspaces/${workspace.id}/evaluations/rubrics/rubric-1`, method: 'PATCH' },
      { url: `/api/workspaces/${workspace.id}/evaluations/rubrics/rubric-1/deactivate`, method: 'POST' },
    ]))
  })

  it('发布成功后历史刷新失败只重试读取，不重复发布', async () => {
    const user = userEvent.setup()
    let reads = 0, publishes = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/rubrics')) return response([rubric])
      if (url.endsWith('/publish')) { publishes++; return response({ id: 'version', version: 'v1.1', snapshot: rubric, createdAt: provider.createdAt }, 201) }
      if (url.endsWith('/versions')) {
        reads++
        return reads === 2 ? response({ detail: '历史服务暂时失败' }, 503) : response([])
      }
      return response({}, 500)
    }))
    renderPage('/w/ai-capability-center/evaluations/rubric-1')
    await screen.findByDisplayValue(rubric.name)
    await user.click(screen.getByRole('button', { name: '发布版本' }))
    expect(await screen.findByText(/发布已成功，但历史刷新失败/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发布版本' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '重试读取发布历史' }))
    expect(publishes).toBe(1)
    expect(reads).toBe(3)
  })

  it('发布权限失败时保留模板并显示服务端反馈', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/evaluations/rubrics') && method === 'GET') return response([rubric])
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/rubrics/rubric-1/versions')) return response([])
      if (url.endsWith('/rubrics/rubric-1/publish') && method === 'POST') {
        return response({ detail: '无权发布评估模板' }, 403)
      }
      return response({ detail: 'unexpected' }, 500)
    }))

    renderPage()
    await user.click(await screen.findByRole('button', { name: '编辑 研究报告质量模板' }))
    await user.click(await screen.findByRole('button', { name: '发布版本' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无权发布评估模板')
    expect(screen.getByLabelText('模板名称')).toHaveValue('研究报告质量模板')
  })

  it('可以创建模板并在提交前校验维度权重', async () => {
    const user = userEvent.setup()
    const persisted = [rubric]
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/evaluations/rubrics') && method === 'GET') return response(persisted)
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/evaluations/rubrics') && method === 'POST') {
        const body = JSON.parse(String(init?.body))
        const created = { ...rubric, ...body, id: 'rubric-2', version: 'v0.1', status: 'draft' }
        persisted.push(created)
        return response(created, 201)
      }
      if (url.endsWith('/rubrics/rubric-2/versions')) return response([])
      return response({ detail: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await user.click(await screen.findByRole('button', { name: '新建评估模板' }))
    await user.type(screen.getByLabelText('模板名称'), '客服回复模板')
    await user.type(screen.getByLabelText('适用产出物'), '客服回复')
    await user.type(screen.getByLabelText('硬性门禁'), '不得承诺未授权退款')
    await user.type(screen.getByLabelText('维度 1 名称'), '合规性')
    await user.type(screen.getByLabelText('维度 1 评分标准'), '不包含违规承诺')
    await user.clear(screen.getByLabelText('维度 1 权重'))
    await user.type(screen.getByLabelText('维度 1 权重'), '90')
    await user.click(screen.getByRole('button', { name: '保存模板' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('维度权重合计必须等于 100')

    await user.clear(screen.getByLabelText('维度 1 权重'))
    await user.type(screen.getByLabelText('维度 1 权重'), '100')
    await user.click(screen.getByRole('button', { name: '保存模板' }))
    expect(await screen.findByRole('heading', { name: '管理评估模板' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/w/ai-capability-center/evaluations/rubric-2')
    expect(screen.getByLabelText('模板名称')).toHaveValue('客服回复模板')
  })

  it('对空状态和加载失败给出明确反馈', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/evaluations/rubrics')) return response([])
      return response({ detail: '无权读取模型配置' }, 403)
    }))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('无权读取模型配置')
  })

  it('模板为空时引导创建第一个模板', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/evaluations/rubrics')) return response([])
      return response([])
    }))
    renderPage()
    expect(await screen.findByText('还没有评估模板')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建第一个模板' })).toBeInTheDocument()
  })
})
