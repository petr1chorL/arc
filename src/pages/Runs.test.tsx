import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Runs } from './Runs'

const run = {
  id: 'run-1',
  kind: 'workflow',
  name: '新品研究流程',
  workflowId: 'workflow-1',
  workflowVersion: 'v1.0.0',
  agentId: null,
  agentVersion: null,
  status: '已完成',
  input: '分析用户需求',
  output: '这是由真实运行记录返回的完整分析结果。',
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
  nodes: [{
    id: 'node-1',
    nodeId: 'agent',
    nodeType: 'agent',
    nodeName: '需求分析 Agent',
    status: '已完成',
    input: '分析用户需求',
    output: '这是由真实运行记录返回的完整分析结果。',
    model: 'configured-model',
    promptTokens: 12,
    completionTokens: 8,
    totalTokens: 20,
    costUsd: 0.001,
    durationMs: 1100,
    attempts: 2,
    score: 100,
    error: '',
    startedAt: '2026-06-24T08:00:00Z',
    completedAt: '2026-06-24T08:00:01Z',
  }],
}

describe('Runs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders persisted run metrics, output and node attempts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([run]), { status: 200 }),
    ))

    render(<Runs />)

    expect(await screen.findByRole('heading', { name: '新品研究流程' })).toBeInTheDocument()
    expect(screen.getAllByText('这是由真实运行记录返回的完整分析结果。')).toHaveLength(2)
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText(/尝试 2 次/)).toBeInTheDocument()
  })
})
