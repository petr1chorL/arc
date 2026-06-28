import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Artifacts } from './Artifacts'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const artifact = {
  artifactId: 'artifact-1',
  artifactVersionId: 'artifact-version-1',
  version: 1,
  runId: 'run-1',
  sourceNodeRunId: 'node-run-1',
  content: '{"summary":"Catalog visible structured output."}',
  score: 98,
  dataObjectDefinitionId: 'data-object-1',
  dataObjectVersionId: 'data-object-version-1',
  dataObjectSnapshot: {
    name: 'Structured Insight',
    schema: { type: 'object', required: ['summary'] },
  },
  createdAt: '2026-06-28T09:00:00Z',
}

function renderPage() {
  return render(
    <WorkspaceProvider workspace={workspace}>
      <Artifacts />
    </WorkspaceProvider>,
  )
}

describe('Artifacts page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders artifact instances and filters by data object definition id', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      calls.push(url)
      if (url === `/api/workspaces/${workspace.id}/artifacts`) {
        return Promise.resolve(new Response(JSON.stringify([artifact]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?dataObjectDefinitionId=data-object-1`) {
        return Promise.resolve(new Response(JSON.stringify([artifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage()

    expect(await screen.findByRole('heading', { name: '产出物' })).toBeInTheDocument()
    expect(screen.getByText('Structured Insight')).toBeInTheDocument()
    expect(screen.getByText('data-object-version-1')).toBeInTheDocument()
    expect(screen.getByText('run-1')).toBeInTheDocument()
    expect(screen.getByText('node-run-1')).toBeInTheDocument()
    expect(screen.getAllByText('98').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('{"summary":"Catalog visible structured output."}')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Data Object Definition ID'), 'data-object-1')
    await user.click(screen.getByRole('button', { name: '筛选' }))

    await waitFor(() => {
      expect(calls).toContain(`/api/workspaces/${workspace.id}/artifacts?dataObjectDefinitionId=data-object-1`)
    })
  })
})
