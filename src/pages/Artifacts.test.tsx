import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
  workflowName: 'Artifact trace workflow',
  runStatus: '已完成',
  sourceNodeName: '数据清洗 Agent',
  sourceNodeType: 'agent',
  sourceNodeStatus: '已完成',
  sourceNodeDurationMs: 1200,
  sourceNodeScore: 94,
  createdAt: '2026-06-28T09:00:00Z',
}

const invalidArtifact = {
  ...artifact,
  artifactId: 'artifact-2',
  artifactVersionId: 'artifact-version-2',
  version: 2,
  runId: 'run-2',
  sourceNodeRunId: 'node-run-2',
  content: '{"title":"Missing required summary."}',
  score: 61,
  createdAt: '2026-06-28T10:00:00Z',
}

const serverValidatedArtifact = {
  ...invalidArtifact,
  artifactId: 'artifact-3',
  artifactVersionId: 'artifact-version-3',
  schemaValidation: {
    status: 'passed',
    label: 'Schema 校验通过',
    reasons: [],
  },
}

function LocationProbe({ onSearchChange }: { onSearchChange?: (search: string) => void }) {
  const location = useLocation()
  useEffect(() => {
    onSearchChange?.(location.search)
  }, [location.search, onSearchChange])
  return null
}

function renderPage(
  initialEntry = '/artifacts',
  onSearchChange?: (search: string) => void,
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkspaceProvider workspace={workspace}>
        <LocationProbe onSearchChange={onSearchChange} />
        <Artifacts />
      </WorkspaceProvider>
    </MemoryRouter>,
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
      if (url === `/api/workspaces/${workspace.id}/artifacts?dataObjectDefinitionId=data-object-1&schemaValidationStatus=failed`) {
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
    await user.selectOptions(screen.getByLabelText('Schema 校验状态'), 'failed')
    await user.click(screen.getByRole('button', { name: '筛选' }))

    await waitFor(() => {
      expect(calls).toContain(
        `/api/workspaces/${workspace.id}/artifacts?dataObjectDefinitionId=data-object-1&schemaValidationStatus=failed`,
      )
    })
  })

  it('initializes artifact filters from the url', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      calls.push(url)
      if (url === `/api/workspaces/${workspace.id}/artifacts?dataObjectDefinitionId=data-object-1&schemaValidationStatus=failed`) {
        return Promise.resolve(new Response(JSON.stringify([invalidArtifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage('/artifacts?dataObjectDefinitionId=data-object-1&schemaValidationStatus=failed')

    await screen.findByText('artifact-version-2 · v2')
    expect(screen.getByLabelText('Data Object Definition ID')).toHaveValue('data-object-1')
    expect(screen.getByLabelText('Schema 校验状态')).toHaveValue('failed')
    expect(calls).toContain(
      `/api/workspaces/${workspace.id}/artifacts?dataObjectDefinitionId=data-object-1&schemaValidationStatus=failed`,
    )
  })

  it('syncs artifact filters to the url and clears them', async () => {
    const user = userEvent.setup()
    const searches: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url.startsWith(`/api/workspaces/${workspace.id}/artifacts`)) {
        return Promise.resolve(new Response(JSON.stringify([artifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage('/artifacts?artifactVersionId=artifact-version-1', (search) => searches.push(search))

    await screen.findByText('Structured Insight')
    await user.type(screen.getByLabelText('Data Object Definition ID'), 'data-object-1')
    await user.selectOptions(screen.getByLabelText('Schema 校验状态'), 'failed')
    await user.click(screen.getByRole('button', { name: '筛选' }))

    await waitFor(() => {
      expect(searches).toContain(
        '?artifactVersionId=artifact-version-1&dataObjectDefinitionId=data-object-1&schemaValidationStatus=failed',
      )
    })

    await user.click(screen.getByRole('button', { name: '清空' }))

    await waitFor(() => {
      expect(searches.at(-1)).toBe('?artifactVersionId=artifact-version-1')
    })
  })

  it('initializes artifact run lineage filters from the url', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      calls.push(url)
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-2&sourceNodeRunId=node-run-2`) {
        return Promise.resolve(new Response(JSON.stringify([invalidArtifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage('/artifacts?runId=run-2&sourceNodeRunId=node-run-2')

    await screen.findByText('artifact-version-2 · v2')
    expect(screen.getByText('当前筛选：Run：run-2 / NodeRun：node-run-2')).toBeInTheDocument()
    expect(calls).toContain(
      `/api/workspaces/${workspace.id}/artifacts?runId=run-2&sourceNodeRunId=node-run-2`,
    )
  })

  it('opens an artifact detail dialog with formatted content and snapshot', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/artifacts`) {
        return Promise.resolve(new Response(JSON.stringify([artifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage()

    await screen.findByText('Structured Insight')
    await user.click(screen.getByRole('button', { name: '查看 artifact-version-1 详情' }))

    const dialog = await screen.findByRole('dialog', { name: 'Artifact 详情' })
    expect(dialog).toHaveTextContent('artifact-version-1')
    expect(dialog).toHaveTextContent('run-1')
    expect(dialog).toHaveTextContent('node-run-1')
    expect(dialog).toHaveTextContent('"summary": "Catalog visible structured output."')
    expect(dialog).toHaveTextContent('"name": "Structured Insight"')

    await user.click(screen.getByRole('button', { name: '关闭 Artifact 详情' }))
    expect(screen.queryByRole('dialog', { name: 'Artifact 详情' })).not.toBeInTheDocument()
  })

  it('links artifact detail to the source run trace', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/artifacts`) {
        return Promise.resolve(new Response(JSON.stringify([artifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage()

    await screen.findByText('Structured Insight')
    await user.click(screen.getByRole('button', { name: '查看 artifact-version-1 详情' }))

    expect(await screen.findByRole('dialog', { name: 'Artifact 详情' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看运行链路' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/observability?runId=run-1&nodeRunId=node-run-1',
    )
  })

  it('shows artifact source context in the list and detail dialog', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/artifacts`) {
        return Promise.resolve(new Response(JSON.stringify([artifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage()

    await screen.findByText('Artifact trace workflow')
    expect(screen.getByText('数据清洗 Agent')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看 artifact-version-1 详情' }))

    const dialog = await screen.findByRole('dialog', { name: 'Artifact 详情' })
    expect(dialog).toHaveTextContent('来源上下文')
    expect(dialog).toHaveTextContent('Artifact trace workflow')
    expect(dialog).toHaveTextContent('数据清洗 Agent')
    expect(dialog).toHaveTextContent('已完成')
    expect(dialog).toHaveTextContent('1.20 s')
    expect(dialog).toHaveTextContent('94')
  })

  it('opens artifact detail from artifactVersionId in the url', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/artifacts`) {
        return Promise.resolve(new Response(JSON.stringify([artifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage('/artifacts?artifactVersionId=artifact-version-1')

    const dialog = await screen.findByRole('dialog', { name: 'Artifact 详情' })
    expect(dialog).toHaveTextContent('artifact-version-1')
    expect(dialog).toHaveTextContent('"summary": "Catalog visible structured output."')
  })

  it('syncs artifact detail open and close with the url', async () => {
    const user = userEvent.setup()
    const searches: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/artifacts`) {
        return Promise.resolve(new Response(JSON.stringify([artifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage('/artifacts', (search) => searches.push(search))

    await screen.findByText('Structured Insight')
    await user.click(screen.getByRole('button', { name: '查看 artifact-version-1 详情' }))

    await waitFor(() => {
      expect(searches).toContain('?artifactVersionId=artifact-version-1')
    })

    await user.click(screen.getByRole('button', { name: '关闭 Artifact 详情' }))

    await waitFor(() => {
      expect(searches.at(-1)).toBe('')
    })
  })

  it('keeps the list visible when artifactVersionId is not in the current list', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/artifacts`) {
        return Promise.resolve(new Response(JSON.stringify([artifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage('/artifacts?artifactVersionId=missing-artifact-version')

    expect(await screen.findByText('Structured Insight')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Artifact 详情' })).not.toBeInTheDocument()
  })

  it('shows schema validation status and failure reasons', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/artifacts`) {
        return Promise.resolve(new Response(JSON.stringify([artifact, invalidArtifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage()

    expect(await screen.findByText('artifact-version-1 · v1')).toBeInTheDocument()
    expect(screen.getAllByText('Schema 校验通过').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Schema 校验失败').length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByRole('button', { name: '查看 artifact-version-2 详情' }))

    const dialog = await screen.findByRole('dialog', { name: 'Artifact 详情' })
    expect(dialog).toHaveTextContent('Schema 校验失败')
    expect(dialog).toHaveTextContent('缺少必填字段：summary')
  })

  it('prefers schema validation returned by the artifact api', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/artifacts`) {
        return Promise.resolve(new Response(JSON.stringify([serverValidatedArtifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }))

    renderPage()

    expect(await screen.findByText('artifact-version-3 · v2')).toBeInTheDocument()
    expect(screen.getByText('Schema 校验通过')).toBeInTheDocument()
    expect(screen.queryByText('Schema 校验失败')).not.toBeInTheDocument()
  })
})
