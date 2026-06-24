import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agents } from './Agents'

const existingAgent = {
  id: '6c8c51ec-178c-4517-838c-93b41c0bf1a0',
  name: '已有 Agent',
  role: '已保存的能力',
  owner: '平台组',
  model: 'GPT-5',
  status: '调试中',
  version: 'v0.1.0',
  passRate: 0,
  runs: 0,
  tools: [],
  createdAt: '2026-06-24T06:00:00Z',
  updatedAt: '2026-06-24T06:00:00Z',
}

const createdAgent = {
  ...existingAgent,
  id: '05396309-bd16-42bd-81ec-4430146137c4',
  name: '新建 Agent',
  role: '处理新的业务任务',
  owner: '产品组',
}

describe('Agents page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads Agents from the API and inserts a newly created Agent', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) => Promise.resolve(
        new Response(
          JSON.stringify(init?.method === 'POST' ? createdAgent : [existingAgent]),
          {
            status: init?.method === 'POST' ? 201 : 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<Agents />)

    expect(await screen.findByText('已有 Agent')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '新建 Agent' }))
    await user.type(screen.getByLabelText('名称'), createdAgent.name)
    await user.type(screen.getByLabelText('职责'), createdAgent.role)
    await user.type(screen.getByLabelText('负责人'), createdAgent.owner)
    await user.type(screen.getByLabelText('模型'), createdAgent.model)
    await user.click(screen.getByRole('button', { name: '创建 Agent' }))

    expect(await screen.findByText('新建 Agent', { selector: 'strong' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
