import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Workflows } from './Workflows'

const workflow = {
  id: 'workflow-1',
  name: '新品研究流程',
  status: '草稿',
  version: 'v1.0.0',
  nodes: [],
  edges: [],
  createdAt: '2026-06-24T07:00:00Z',
  updatedAt: '2026-06-24T07:00:00Z',
}

describe('Workflows', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs the selected published workflow with user input', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const run = {
      id: 'run-1',
      kind: 'workflow',
      name: workflow.name,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      agentId: null,
      agentVersion: null,
      status: '已完成',
      input: '分析新品机会',
      output: '工作流真实执行完成并生成了结构化结果。',
      score: 100,
      model: 'configured-model',
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
      costUsd: 0.001,
      durationMs: 1200,
      currentNode: '流程结束',
      error: '',
      startedAt: '2026-06-24T08:00:00Z',
      completedAt: '2026-06-24T08:00:01Z',
      nodes: [],
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/workflows') {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url === '/api/agents') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/runs')) {
        return Promise.resolve(new Response(JSON.stringify(run), { status: 201 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Workflows />)

    await user.click(await screen.findByRole('button', { name: '运行工作流' }))
    await user.type(screen.getByLabelText('运行输入'), '分析新品机会')
    await user.click(screen.getByRole('button', { name: '开始运行' }))

    expect(await screen.findByText('工作流真实执行完成并生成了结构化结果。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/workflows/workflow-1/runs', expect.objectContaining({
      method: 'POST',
    }))
  })
})
