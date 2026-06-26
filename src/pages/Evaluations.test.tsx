import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Evaluations } from './Evaluations'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const overview = {
  totals: {
    feedbackCandidates: 3,
    pendingCandidates: 1,
    confirmedCandidates: 2,
    goldenSamples: 2,
    coveredWorkflows: 2,
    coveredAgents: 1,
  },
  recentCandidates: [{
    id: 'candidate-1',
    reason: '专家修改为更可靠的输出',
    tags: ['accuracy', 'evidence'],
    workflowId: 'workflow-1',
    agentId: 'agent-1',
    sourceNodeId: 'agent-node',
    createdBy: 'reviewer-1',
    status: '已确认',
    createdAt: '2026-06-26T09:00:00Z',
    confirmedAt: '2026-06-26T09:05:00Z',
  }],
}

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status }))
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkspaceProvider workspace={workspace}>
        <Evaluations />
      </WorkspaceProvider>
    </MemoryRouter>,
  )
}

describe('Evaluations page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders real feedback and golden sample overview data', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (input === `/api/workspaces/${workspace.id}/evaluations/overview`) {
        return response(overview)
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    expect(await screen.findByText('评估资产概览')).toBeInTheDocument()
    expect(screen.getByText('反馈候选')).toBeInTheDocument()
    expect(screen.getByText('Golden Sample')).toBeInTheDocument()
    expect(screen.getByText('专家修改为更可靠的输出')).toBeInTheDocument()
    expect(screen.getByText('accuracy')).toBeInTheDocument()
    expect(screen.getByText('evidence')).toBeInTheDocument()
  })
})
