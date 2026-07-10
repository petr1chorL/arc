import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { AgentDetail } from './AgentDetail'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const agent = {
  id: 'agent-1',
  name: '研究 Agent',
  role: '完成结构化研究',
  owner: '产品组',
  model: 'GPT-5',
  modelProviderId: null,
  modelProvider: 'openai-compatible',
  modelBaseUrl: '',
  temperature: 0.2,
  maxOutputTokens: 2000,
  status: '调试中',
  version: 'v0.1.0',
  passRate: 0,
  runs: 0,
  tools: [],
  skills: [],
  systemPrompt: '',
  runtimeManifest: {},
  createdAt: '2026-06-24T07:00:00Z',
  updatedAt: '2026-06-24T07:00:00Z',
}

describe('AgentDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('edits, publishes and deactivates an Agent', async () => {
    const user = userEvent.setup()
    const publishedVersion = {
      id: 'version-1',
      version: 'v1.0.0',
      snapshot: { ...agent, name: '高级研究 Agent' },
      note: '补充检索工具和输出约束',
      createdAt: '2026-06-24T07:10:00Z',
    }
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/publish')) {
        return Promise.resolve(new Response(JSON.stringify(publishedVersion), { status: 201 }))
      }
      if (url.endsWith('/deactivate')) {
        return Promise.resolve(new Response(JSON.stringify({ ...agent, status: '已停用' }), { status: 200 }))
      }
      if (url.endsWith('/activate')) {
        return Promise.resolve(new Response(JSON.stringify({ ...agent, status: '在线' }), { status: 200 }))
      }
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({ ...agent, name: '高级研究 Agent' }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(agent), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <MemoryRouter initialEntries={['/w/ai-capability-center/agents/agent-1']}>
          <Routes>
            <Route path="/w/ai-capability-center/agents/:agentId" element={<AgentDetail />} />
          </Routes>
        </MemoryRouter>
      </WorkspaceProvider>,
    )

    const nameInput = await screen.findByLabelText('名称')
    await user.clear(nameInput)
    await user.type(nameInput, '高级研究 Agent')
    await user.type(screen.getByLabelText('System Prompt'), '只输出有证据的结论')
    await user.type(screen.getByLabelText('Tools'), 'Web Search, 飞书知识库')
    await user.type(screen.getByLabelText('Skills'), '竞品分析')
    await user.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByText('草稿已保存')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '发布新版本' }))
    const publishDialog = await screen.findByRole('dialog', { name: '发布版本备注' })
    await user.click(screen.getByRole('button', { name: '确认发布版本' }))
    expect(screen.getByText('请填写发布备注')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/publish'))).toBe(false)
    await user.type(screen.getByLabelText('发布备注'), '补充检索工具和输出约束')
    await user.click(screen.getByRole('button', { name: '确认发布版本' }))
    expect((await screen.findAllByText('v1.0.0')).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByRole('dialog', { name: '发布版本备注' })).not.toBeInTheDocument()
    expect(screen.getByText('版本管理')).toBeInTheDocument()
    expect(screen.getByText('发布备注：补充检索工具和输出约束')).toBeInTheDocument()
    const publishCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/publish'))
    expect(JSON.parse(publishCall?.[1]?.body as string)).toEqual({ note: '补充检索工具和输出约束' })
    expect(publishDialog).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '停用 Agent' }))
    expect(await screen.findByText('已停用')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '启用 Agent' }))
    expect(await screen.findByText('Agent 已启用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停用 Agent' })).toBeEnabled()
  })

  it('edits Agent runtime configuration without API keys', async () => {
    const user = userEvent.setup()
    const savedAgent = {
      ...agent,
      modelProvider: 'openai-compatible',
      modelBaseUrl: 'https://api.deepseek.com',
      temperature: 0.4,
      maxOutputTokens: 1600,
    }
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(savedAgent), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(agent), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <MemoryRouter initialEntries={['/w/ai-capability-center/agents/agent-1']}>
          <Routes>
            <Route path="/w/ai-capability-center/agents/:agentId" element={<AgentDetail />} />
          </Routes>
        </MemoryRouter>
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('运行配置')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Base URL'))
    await user.type(screen.getByLabelText('Base URL'), 'https://api.deepseek.com')
    await user.clear(screen.getByLabelText('温度'))
    await user.type(screen.getByLabelText('温度'), '0.4')
    await user.clear(screen.getByLabelText('最大输出 Tokens'))
    await user.type(screen.getByLabelText('最大输出 Tokens'), '1600')

    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    const patchBody = JSON.parse(patchCall?.[1]?.body as string)
    expect(patchBody).toEqual(expect.objectContaining({
      modelProvider: 'openai-compatible',
      modelBaseUrl: 'https://api.deepseek.com',
      temperature: 0.4,
      maxOutputTokens: 1600,
    }))
    expect(patchBody).not.toHaveProperty('apiKey')
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('binds an Agent draft to a Workspace model Provider asset', async () => {
    const user = userEvent.setup()
    const providers = [{
      id: 'provider-1',
      name: 'DeepSeek 生产',
      providerType: 'openai-compatible' as const,
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-pro',
      secretRef: 'DEEPSEEK_API_KEY',
      status: 'draft',
      createdAt: '2026-06-28T01:00:00Z',
      updatedAt: '2026-06-28T01:00:00Z',
    }]
    const savedAgent = {
      ...agent,
      modelProviderId: 'provider-1',
      modelProvider: 'openai-compatible',
      modelBaseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
    }
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/model-providers')) {
        return Promise.resolve(new Response(JSON.stringify(providers), { status: 200 }))
      }
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(savedAgent), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(agent), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <MemoryRouter initialEntries={['/w/ai-capability-center/agents/agent-1']}>
          <Routes>
            <Route path="/w/ai-capability-center/agents/:agentId" element={<AgentDetail />} />
          </Routes>
        </MemoryRouter>
      </WorkspaceProvider>,
    )

    const providerSelect = await screen.findByRole('combobox', { name: '模型资产' })
    await user.selectOptions(providerSelect, 'provider-1')
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    const patchBody = JSON.parse(patchCall?.[1]?.body as string)
    expect(patchBody).toEqual(expect.objectContaining({
      modelProviderId: 'provider-1',
      modelProvider: 'openai-compatible',
      modelBaseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
    }))
    expect(patchBody).not.toHaveProperty('apiKey')
    expect(await screen.findByText('草稿已保存')).toBeInTheDocument()
  })

  it('binds Agent Tools and Skills from active Workspace assets', async () => {
    const user = userEvent.setup()
    const assets = [
      {
        id: 'tool-1',
        assetType: 'tool' as const,
        name: '飞书搜索',
        description: 'Search Lark docs',
        parameterSchema: { type: 'object' },
        adapterType: 'http' as const,
        adapterConfig: {},
        status: 'active',
        createdBy: 'admin',
        createdAt: '2026-06-28T01:00:00Z',
        updatedAt: '2026-06-28T01:00:00Z',
      },
      {
        id: 'tool-2',
        assetType: 'tool' as const,
        name: '价格查询',
        description: 'Disabled tool',
        parameterSchema: { type: 'object' },
        adapterType: 'http' as const,
        adapterConfig: {},
        status: 'disabled',
        createdBy: 'admin',
        createdAt: '2026-06-28T01:00:00Z',
        updatedAt: '2026-06-28T01:00:00Z',
      },
      {
        id: 'skill-1',
        assetType: 'skill' as const,
        name: '竞品分析',
        description: 'Competitive analysis',
        parameterSchema: { type: 'object' },
        adapterType: 'manual' as const,
        adapterConfig: {},
        status: 'active',
        createdBy: 'admin',
        createdAt: '2026-06-28T01:00:00Z',
        updatedAt: '2026-06-28T01:00:00Z',
      },
    ]
    const savedAgent = {
      ...agent,
      tools: ['飞书搜索'],
      skills: ['竞品分析'],
    }
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/model-providers')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/asset-library')) {
        return Promise.resolve(new Response(JSON.stringify(assets), { status: 200 }))
      }
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(savedAgent), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(agent), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <MemoryRouter initialEntries={['/w/ai-capability-center/agents/agent-1']}>
          <Routes>
            <Route path="/w/ai-capability-center/agents/:agentId" element={<AgentDetail />} />
          </Routes>
        </MemoryRouter>
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('可用 Tool 资产')).toBeInTheDocument()
    const activeTool = screen.getByRole('checkbox', { name: '绑定 Tool 飞书搜索' })
    const disabledTool = screen.getByRole('checkbox', { name: '绑定 Tool 价格查询' })
    const activeSkill = screen.getByRole('checkbox', { name: '绑定 Skill 竞品分析' })
    expect(disabledTool).toBeDisabled()

    await user.click(activeTool)
    await user.click(activeSkill)
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    const patchBody = JSON.parse(patchCall?.[1]?.body as string)
    expect(patchBody).toEqual(expect.objectContaining({
      tools: ['飞书搜索'],
      skills: ['竞品分析'],
    }))
    expect(patchBody).not.toHaveProperty('apiKey')
    expect(await screen.findByText('草稿已保存')).toBeInTheDocument()
  })

  it('imports Python package runtime metadata into the Agent draft', async () => {
    const user = userEvent.setup()
    const savedAgent = {
      ...agent,
      runtimeManifest: {
        runtime: 'langchain',
        sourceType: 'python_package',
        packageName: 'arc-langchain-agents',
        packageVersion: '1.0.3',
        entrypoint: 'arc_agents.research:create_agent',
        packageHash: 'sha256:abc123',
      },
    }
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/model-providers') || url.endsWith('/asset-library')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(savedAgent), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(agent), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <MemoryRouter initialEntries={['/w/ai-capability-center/agents/agent-1']}>
          <Routes>
            <Route path="/w/ai-capability-center/agents/:agentId" element={<AgentDetail />} />
          </Routes>
        </MemoryRouter>
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('Runtime / Python Package')).toBeInTheDocument()
    expect(screen.queryByLabelText('Manifest JSON')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Package 来源')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Package 名称'), 'arc-langchain-agents')
    await user.type(screen.getByLabelText('Package 版本'), '1.0.3')
    await user.type(screen.getByLabelText('Package EntryPoint'), 'arc_agents.weather:create_agent')
    await user.type(screen.getByLabelText('Package Hash'), 'sha256:abc123')
    await user.click(screen.getByRole('button', { name: '导入 Python Package' }))
    expect(screen.getAllByText('arc-langchain-agents==1.0.3').length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    const patchBody = JSON.parse(patchCall?.[1]?.body as string)
    expect(patchBody.runtimeManifest).toEqual({
      runtime: 'langchain',
      sourceType: 'python_package',
      packageName: 'arc-langchain-agents',
      packageVersion: '1.0.3',
      entrypoint: 'arc_agents.weather:create_agent',
      packageHash: 'sha256:abc123',
    })
    expect(patchBody).toEqual(expect.objectContaining({
      model: 'GPT-5',
      temperature: 0.2,
      maxOutputTokens: 2000,
    }))
  })

  it('shows Python package metadata from the latest published snapshot when the draft is empty', async () => {
    const versionManifest = {
      runtime: 'langchain',
      sourceType: 'python_package' as const,
      packageName: 'arc-langchain-weather-demo',
      packageVersion: '0.1.0',
      entrypoint: 'arc_langchain_weather_demo.weather_agent:create_agent',
      packageSource: 'local-wheelhouse',
      packageHash: 'sha256:abc123',
    }
    const publishedAgent = { ...agent, status: '在线', version: 'v1.0.0' }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([{
          id: 'version-1',
          version: 'v1.0.0',
          snapshot: { ...publishedAgent, runtimeManifest: versionManifest },
          note: 'Register packaged LangChain weather demo wheel',
          createdAt: '2026-06-24T07:10:00Z',
        }]), { status: 200 }))
      }
      if (url.endsWith('/model-providers') || url.endsWith('/asset-library')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ ...publishedAgent, runtimeManifest: {} }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <MemoryRouter initialEntries={['/w/ai-capability-center/agents/agent-1']}>
          <Routes>
            <Route path="/w/ai-capability-center/agents/:agentId" element={<AgentDetail />} />
          </Routes>
        </MemoryRouter>
      </WorkspaceProvider>,
    )

    expect(await screen.findByDisplayValue('arc-langchain-weather-demo')).toBeInTheDocument()
    expect(screen.getByDisplayValue('arc_langchain_weather_demo.weather_agent:create_agent')).toBeInTheDocument()
    expect(screen.getByText('Python Package 当前仅登记元数据，尚未接入隔离执行器。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '运行 Agent' })).toBeDisabled()
  })

  it('runs a published Agent and shows the persisted result', async () => {
    const user = userEvent.setup()
    const publishedAgent = { ...agent, status: '在线', version: 'v1.0.0' }
    const publishedVersion = {
      id: 'version-1',
      version: 'v1.0.0',
      snapshot: publishedAgent,
      createdAt: '2026-06-24T07:10:00Z',
    }
    const run = {
      id: 'run-1',
      kind: 'agent',
      name: '研究 Agent 测试运行',
      workflowId: null,
      workflowVersion: null,
      agentId: 'agent-1',
      agentVersion: 'v1.0.0',
      status: '已完成',
      input: '分析新需求',
      output: '这是 Agent 真实执行后返回的结构化结果。',
      score: 100,
      model: 'configured-model',
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
      costUsd: 0.001,
      durationMs: 1200,
      currentNode: '研究 Agent',
      error: '',
      startedAt: '2026-06-24T08:00:00Z',
      completedAt: '2026-06-24T08:00:01Z',
      nodes: [],
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([publishedVersion]), { status: 200 }))
      }
      if (url.endsWith('/test-runs')) {
        return Promise.resolve(new Response(JSON.stringify(run), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify(publishedAgent), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <MemoryRouter initialEntries={['/w/ai-capability-center/agents/agent-1']}>
          <Routes>
            <Route path="/w/ai-capability-center/agents/:agentId" element={<AgentDetail />} />
          </Routes>
        </MemoryRouter>
      </WorkspaceProvider>,
    )

    await user.type(await screen.findByLabelText('测试输入'), '分析新需求')
    await user.click(screen.getByRole('button', { name: '运行 Agent' }))

    expect(await screen.findByText('这是 Agent 真实执行后返回的结构化结果。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${workspace.id}/agents/agent-1/test-runs`, expect.objectContaining({
      method: 'POST',
    }))
  })

})
