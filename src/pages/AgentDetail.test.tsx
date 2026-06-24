import { render, screen } from '@testing-library/react'
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
    expect(await screen.findByText('v1.0.0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '停用 Agent' }))
    expect(await screen.findByText('已停用')).toBeInTheDocument()
  })
})
