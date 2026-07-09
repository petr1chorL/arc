import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentDetail } from './AgentDetail'

const agent = {
  id: 'agent-1',
  name: '研究 Agent',
  role: '完成结构化研究',
  owner: '产品组',
  model: 'GPT-5',
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
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({ ...agent, name: '高级研究 Agent' }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(agent), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/agents/agent-1']}>
        <Routes>
          <Route path="/agents/:agentId" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>,
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
    expect((await screen.findAllByText('v1.0.0')).length).toBeGreaterThanOrEqual(2)

    await user.click(screen.getByRole('button', { name: '停用 Agent' }))
    expect(await screen.findByText('已停用')).toBeInTheDocument()
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
      <MemoryRouter initialEntries={['/agents/agent-1']}>
        <Routes>
          <Route path="/agents/:agentId" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    await user.type(await screen.findByLabelText('测试输入'), '分析新需求')
    await user.click(screen.getByRole('button', { name: '运行 Agent' }))

    expect(await screen.findByText('这是 Agent 真实执行后返回的结构化结果。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-1/test-runs', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('imports LangChain manifest and Python package runtime metadata into the Agent draft', async () => {
    const user = userEvent.setup()
    const savedAgent = {
      ...agent,
      runtimeManifest: {
        runtime: 'langchain',
        sourceType: 'python_package',
        packageName: 'arc-langchain-agents',
        packageVersion: '1.0.3',
        entrypoint: 'arc_agents.research:create_agent',
        packageSource: 'internal-pypi',
        packageHash: 'sha256:abc123',
      },
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
      <MemoryRouter initialEntries={['/agents/agent-1']}>
        <Routes>
          <Route path="/agents/:agentId" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Runtime / Manifest')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Manifest JSON'), { target: { value: JSON.stringify({
      runtime: 'langchain',
      repo: 'git@example.com:ai/langchain-agents.git',
      gitSha: 'abc123',
      entrypoint: 'agents.research:create_agent',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      tools: ['web_search'],
    }) } })
    await user.click(screen.getByRole('button', { name: '导入 Manifest' }))

    expect(await screen.findByText('git@example.com:ai/langchain-agents.git')).toBeInTheDocument()
    expect(screen.getAllByText('agents.research:create_agent').length).toBeGreaterThanOrEqual(1)

    await user.type(screen.getByLabelText('Package 名称'), 'arc-langchain-agents')
    await user.type(screen.getByLabelText('Package 版本'), '1.0.3')
    await user.type(screen.getByLabelText('Package EntryPoint'), 'arc_agents.research:create_agent')
    await user.type(screen.getByLabelText('Package 来源'), 'internal-pypi')
    await user.type(screen.getByLabelText('Package Hash'), 'sha256:abc123')
    await user.click(screen.getByRole('button', { name: '导入 Python Package' }))

    expect(await screen.findAllByText('arc-langchain-agents==1.0.3')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(JSON.parse(patchCall?.[1]?.body as string).runtimeManifest).toEqual(savedAgent.runtimeManifest)
  })
})
