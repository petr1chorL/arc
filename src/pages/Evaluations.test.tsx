import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Evaluations } from './Evaluations'

const workspace = { id: 'workspace-1', slug: 'ai-capability-center', name: 'AI ????' }
const rubric = {
  id: 'rubric-1', name: '????????', artifact: '????',
  dimensions: [
    { id: 'accuracy', name: '???', weight: 60, criteria: '????????' },
    { id: 'completeness', name: '???', weight: 40, criteria: '???????' },
  ],
  gate: '??????', passScore: 85, judgeType: 'llm' as const,
  judgeModel: 'deepseek-chat', modelProviderId: 'provider-1', version: 'v1.0', status: 'active',
}
const provider = {
  id: 'provider-1', name: 'DeepSeek ???', providerType: 'openai-compatible',
  baseUrl: 'https://api.example.com', defaultModel: 'deepseek-chat', secretRef: 'DO_NOT_RENDER',
  status: 'active', createdBy: 'user-1', createdAt: '2026-07-14T00:00:00Z', updatedAt: '2026-07-14T00:00:00Z',
}

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }))
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkspaceProvider workspace={workspace}><Evaluations /></WorkspaceProvider>
    </MemoryRouter>,
  )
}

describe('Evaluations template library', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('??????????????????????????', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/evaluations/rubrics')) return response([rubric])
      if (url.endsWith('/model-providers')) return response([provider])
      return response({ detail: `unexpected ${url}` }, 500)
    }))
    renderPage()

    expect(await screen.findByRole('heading', { name: '????' })).toBeInTheDocument()
    const card = screen.getByRole('article', { name: '????????' })
    expect(card.querySelector('.rubric-card-heading')).toBeInTheDocument()
    expect(card.querySelector('.rubric-card-description')).toBeInTheDocument()
    expect(card.querySelector('.rubric-card-meta')).toBeInTheDocument()
    expect(within(card).getByText('???')).toBeInTheDocument()
    expect(within(card).getByText('v1.0')).toBeInTheDocument()
    expect(within(card).getByText('2 ???')).toBeInTheDocument()
    expect(within(card).getByText('??? 85')).toBeInTheDocument()
    expect(within(card).getByText('DeepSeek ??? / deepseek-chat')).toBeInTheDocument()
    expect(screen.queryByText('DO_NOT_RENDER')).not.toBeInTheDocument()
    expect(screen.queryByText(/Golden Set|Regression Run|Remediation Task/i)).not.toBeInTheDocument()
    expect(calls).toEqual([
      `/api/workspaces/${workspace.id}/evaluations/rubrics`,
      `/api/workspaces/${workspace.id}/model-providers`,
    ])
  })

  it('?????????????????', async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string, method: string }> = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method })
      if (url.endsWith('/evaluations/rubrics') && method === 'GET') return response([rubric])
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/rubrics/rubric-1') && method === 'PATCH') {
        return response({ ...rubric, name: '???????? v2' })
      }
      if (url.endsWith('/rubrics/rubric-1/versions')) {
        return response([{ id: 'version-1', version: 'v1.0', snapshot: rubric, createdAt: '2026-07-14T00:00:00Z' }])
      }
      if (url.endsWith('/rubrics/rubric-1/publish') && method === 'POST') {
        return response({ id: 'version-2', version: 'v1.1', snapshot: rubric, createdAt: '2026-07-15T00:00:00Z' })
      }
      if (url.endsWith('/rubrics/rubric-1/deactivate') && method === 'POST') {
        return response({ ...rubric, status: 'disabled', version: 'v1.1' })
      }
      return response({ detail: `unexpected ${method} ${url}` }, 500)
    }))

    renderPage()
    await user.click(await screen.findByRole('button', { name: '??????????' }))
    const firstDimension = screen.getByLabelText('?? 1 ??').closest('.rubric-dimension-row')
    expect(firstDimension).toBeInTheDocument()
    expect(firstDimension?.querySelector('.rubric-dimension-name')).toBeInTheDocument()
    expect(firstDimension?.querySelector('.rubric-dimension-criteria')).toBeInTheDocument()
    expect(firstDimension?.querySelector('.rubric-dimension-weight')).toBeInTheDocument()
    expect(await screen.findByText('?? v1.0')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('????'))
    await user.type(screen.getByLabelText('????'), '???????? v2')
    await user.click(screen.getByRole('button', { name: '????' }))
    expect(await screen.findByRole('status')).toHaveTextContent('???????')
    await user.click(screen.getByRole('button', { name: '????' }))
    expect(await screen.findByRole('status')).toHaveTextContent('???????? v1.1')
    await user.click(screen.getByRole('button', { name: '????' }))
    expect(await screen.findByRole('status')).toHaveTextContent('???????')
    expect(screen.getByRole('button', { name: '????' })).toBeDisabled()
    expect(calls).toEqual(expect.arrayContaining([
      { url: `/api/workspaces/${workspace.id}/evaluations/rubrics/rubric-1/versions`, method: 'GET' },
      { url: `/api/workspaces/${workspace.id}/evaluations/rubrics/rubric-1/publish`, method: 'POST' },
      { url: `/api/workspaces/${workspace.id}/evaluations/rubrics/rubric-1`, method: 'PATCH' },
      { url: `/api/workspaces/${workspace.id}/evaluations/rubrics/rubric-1/deactivate`, method: 'POST' },
    ]))
  })

  it('???????????????????', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/evaluations/rubrics') && method === 'GET') return response([rubric])
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/rubrics/rubric-1/versions')) return response([])
      if (url.endsWith('/rubrics/rubric-1/publish') && method === 'POST') {
        return response({ detail: '????????' }, 403)
      }
      return response({ detail: 'unexpected' }, 500)
    }))

    renderPage()
    await user.click(await screen.findByRole('button', { name: '??????????' }))
    await user.click(screen.getByRole('button', { name: '????' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('????????')
    expect(screen.getByLabelText('????')).toHaveValue('????????')
  })

  it('?????????????????', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/evaluations/rubrics') && method === 'GET') return response([rubric])
      if (url.endsWith('/model-providers')) return response([provider])
      if (url.endsWith('/evaluations/rubrics') && method === 'POST') {
        const body = JSON.parse(String(init?.body))
        return response({ ...rubric, ...body, id: 'rubric-2', version: 'v0.1', status: 'draft' }, 201)
      }
      return response({ detail: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await user.click(await screen.findByRole('button', { name: '??????' }))
    await user.type(screen.getByLabelText('????'), '??????')
    await user.type(screen.getByLabelText('?????'), '????')
    await user.type(screen.getByLabelText('????'), '?????????')
    await user.type(screen.getByLabelText('?? 1 ??'), '???')
    await user.type(screen.getByLabelText('?? 1 ????'), '???????')
    await user.clear(screen.getByLabelText('?? 1 ??'))
    await user.type(screen.getByLabelText('?? 1 ??'), '90')
    await user.click(screen.getByRole('button', { name: '????' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('?????????? 100')

    await user.clear(screen.getByLabelText('?? 1 ??'))
    await user.type(screen.getByLabelText('?? 1 ??'), '100')
    await user.click(screen.getByRole('button', { name: '????' }))
    expect(await screen.findByText('??????')).toBeInTheDocument()
  })

  it('???????????????', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/evaluations/rubrics')) return response([])
      return response({ detail: '????????' }, 403)
    }))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('????????')
  })

  it('??????????????', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/evaluations/rubrics')) return response([])
      return response([])
    }))
    renderPage()
    expect(await screen.findByText('???????')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '???????' })).toBeInTheDocument()
  })
})
