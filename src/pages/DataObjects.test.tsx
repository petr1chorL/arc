import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { DataObjects } from './DataObjects'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const definition = {
  id: 'data-object-1',
  name: 'Product Brief',
  description: 'Structured product brief',
  schema: {
    type: 'object',
    required: ['asin'],
    properties: {
      asin: { type: 'string' },
      summary: { type: 'string' },
    },
  },
  status: 'draft',
  version: 'unpublished',
  createdBy: 'admin',
  createdAt: '2026-06-28T00:00:00Z',
  updatedAt: '2026-06-28T00:00:00Z',
}

function renderPage() {
  return render(
    <WorkspaceProvider workspace={workspace}>
      <MemoryRouter><DataObjects /></MemoryRouter>
    </WorkspaceProvider>,
  )
}

describe('DataObjects page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads data object definitions', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/data-objects`) {
        return Promise.resolve(new Response(JSON.stringify([definition]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    }))

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Data Object' })).toBeInTheDocument()
    expect(screen.getByText('Product Brief')).toBeInTheDocument()
    expect(screen.getByText('draft · unpublished')).toBeInTheDocument()
    expect(screen.getByText('required: asin')).toBeInTheDocument()
  })

  it('validates schema JSON before creating', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/data-objects`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await screen.findByRole('heading', { name: 'Data Object' })
    fireEvent.change(screen.getByLabelText('Schema JSON'), { target: { value: '{' } })
    await user.click(screen.getByRole('button', { name: '创建 Data Object' }))

    expect(await screen.findByText('Schema 必须是合法 JSON')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('creates edits and publishes a data object definition', async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const created = { ...definition, id: 'data-object-2', name: 'VOC Insight' }
    const updated = {
      ...created,
      name: 'VOC Insight V2',
      description: 'Updated VOC object',
      schema: { type: 'object', required: ['topic'], properties: { topic: { type: 'string' } } },
    }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      calls.push({ url, init })
      if (url === `/api/workspaces/${workspace.id}/data-objects` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/data-objects` && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }))
      }
      if (url === `/api/workspaces/${workspace.id}/data-objects/${created.id}` && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(updated), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/data-objects/${created.id}/publish` && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'version-1',
          definitionId: created.id,
          version: 'v1.0.0',
          snapshot: updated,
          createdAt: '2026-06-28T00:02:00Z',
        }), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    }))

    renderPage()

    await screen.findByRole('heading', { name: 'Data Object' })
    await user.type(screen.getByLabelText('名称'), created.name)
    await user.type(screen.getByLabelText('描述'), created.description)
    fireEvent.change(screen.getByLabelText('Schema JSON'), { target: { value: JSON.stringify(created.schema) } })
    await user.click(screen.getByRole('button', { name: '创建 Data Object' }))

    expect(await screen.findByText('VOC Insight')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '编辑 VOC Insight' }))
    await user.clear(screen.getByLabelText('编辑名称'))
    await user.type(screen.getByLabelText('编辑名称'), updated.name)
    await user.clear(screen.getByLabelText('编辑描述'))
    await user.type(screen.getByLabelText('编辑描述'), updated.description)
    fireEvent.change(screen.getByLabelText('编辑 Schema JSON'), { target: { value: JSON.stringify(updated.schema) } })
    await user.click(screen.getByRole('button', { name: '保存 VOC Insight' }))

    expect(await screen.findByText('VOC Insight V2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '发布 VOC Insight V2' }))

    await waitFor(() => {
      expect(screen.getByText('published · v1.0.0')).toBeInTheDocument()
    })
    expect(calls.some((call) => call.url.endsWith('/publish') && call.init?.method === 'POST')).toBe(true)
  })
})
