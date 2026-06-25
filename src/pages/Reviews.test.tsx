import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Reviews } from './Reviews'

const review = {
  id: 'review-1',
  runId: 'run-1',
  nodeRunId: 'node-1',
  title: '复核低分产出：需求分析 Agent',
  status: '待处理',
  reason: '基础质量门禁未通过',
  score: 50,
  createdAt: '2026-06-24T08:00:01Z',
}

const run = {
  id: 'run-1',
  kind: 'workflow',
  name: '新品研究流程',
  workflowId: 'workflow-1',
  workflowVersion: 'v1.0.0',
  agentId: null,
  agentVersion: null,
  status: '需介入',
  input: '生成结果',
  output: '太短',
  score: 50,
  model: 'configured-model',
  promptTokens: 12,
  completionTokens: 2,
  totalTokens: 14,
  costUsd: 0.001,
  durationMs: 800,
  currentNode: '需求分析 Agent',
  error: '',
  startedAt: '2026-06-24T08:00:00Z',
  completedAt: '2026-06-24T08:00:01Z',
  nodes: [],
}

describe('Reviews', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the real artifact and persists approval', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/reviews' && !init) {
        return Promise.resolve(new Response(JSON.stringify([review]), { status: 200 }))
      }
      if (url === '/api/runs/run-1') {
        return Promise.resolve(new Response(JSON.stringify(run), { status: 200 }))
      }
      if (url === '/api/reviews/review-1/decision') {
        return Promise.resolve(new Response(JSON.stringify({ ...review, status: '已完成' }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Reviews />)

    expect(await screen.findByText('太短')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '通过' }))
    expect(await screen.findByText('审核已通过')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews/review-1/decision', expect.objectContaining({
      method: 'POST',
    }))
  })
})
