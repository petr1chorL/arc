import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Observability } from './Observability'
import { workspace, overview, detail, humanSla, costUsage, executionJobs } from '../test/fixtures/observability'

const navigation = vi.hoisted(() => ({ hold: false, queue: [] as (() => void)[], writes: [] as string[] }))
vi.mock('react-router-dom', async importOriginal => {
  const original = await importOriginal<typeof import('react-router-dom')>()
  const react = await import('react')
  return { ...original, useSearchParams() {
    const [params, setParams] = original.useSearchParams()
    const commit = react.useCallback((next: URLSearchParams, options: { replace?: boolean }) => {
      navigation.writes.push(next.toString())
      if (navigation.writes.length > 20) throw new Error('Navigation must converge within 20 writes')
      if (navigation.hold) navigation.queue.push(() => setParams(next, options))
      else setParams(next, options)
    }, [setParams])
    return [params, commit]
  } }
})

const fixtures = { workspace, overview, detail, humanSla, costUsage, executionJobs }
function Location() { return <output data-testid="location">{useLocation().search}</output> }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); navigation.hold = false; navigation.queue = []; navigation.writes = [] })

it('retains the selected run while Router navigation is pending and after it commits', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/overview')) return Response.json(fixtures.overview)
    if (url.endsWith('/human-sla')) return Response.json(fixtures.humanSla)
    if (url.endsWith('/cost-usage')) return Response.json(fixtures.costUsage)
    if (url.endsWith('/execution-jobs')) return Response.json(fixtures.executionJobs)
    if (url.endsWith('/runs/run-failed')) return Response.json(fixtures.detail)
    if (url.endsWith('/runs/run-waiting')) return Response.json({ ...fixtures.detail, id: 'run-waiting', workflowName: '价格监控流程' })
    return Response.json({ detail: 'synthetic unavailable' }, { status: 404 })
  }))
  navigation.hold = true
  render(<MemoryRouter initialEntries={['/w/test/observability']}><WorkspaceProvider workspace={fixtures.workspace}><Observability /><Location /></WorkspaceProvider></MemoryRouter>)
  const target = await screen.findByRole('button', { name: /价格监控流程/ })
  await screen.findByText('Trace 链路索引')
  navigation.hold = true
  fireEvent.click(target)
  const pending = [...navigation.queue]
  navigation.queue = []
  navigation.hold = false
  await act(async () => { pending.at(0)?.() })
  await act(async () => { pending.at(-1)?.() })
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('runId=run-waiting'))
  expect(target).toHaveClass('selected')
  expect(navigation.writes.length).toBeLessThan(5)
})

it('ignores a previous run detail response after a newer selection has loaded', async () => {
  let resolvePrevious!: (response: Response) => void
  const previous = new Promise<Response>(resolve => { resolvePrevious = resolve })
  const currentDetail = { ...fixtures.detail, id: 'run-waiting', workflowName: '价格监控流程', output: 'CURRENT_RUN_DETAIL' }
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/overview')) return Response.json(fixtures.overview)
    if (url.endsWith('/human-sla')) return Response.json(fixtures.humanSla)
    if (url.endsWith('/cost-usage')) return Response.json(fixtures.costUsage)
    if (url.endsWith('/execution-jobs')) return Response.json(fixtures.executionJobs)
    if (url.endsWith('/runs/run-failed')) return previous
    if (url.endsWith('/runs/run-waiting')) return Response.json(currentDetail)
    return Response.json({ detail: 'synthetic unavailable' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<MemoryRouter initialEntries={['/w/test/observability?runId=run-failed']}><WorkspaceProvider workspace={fixtures.workspace}><Observability /><Location /></WorkspaceProvider></MemoryRouter>)
  await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/runs/run-failed'))).toBe(true))
  fireEvent.click(await screen.findByRole('button', { name: /价格监控流程/ }))
  await screen.findByText('CURRENT_RUN_DETAIL')
  await act(async () => {
    resolvePrevious(Response.json({ ...fixtures.detail, output: 'PREVIOUS_RUN_DETAIL' }))
    await previous
  })
  expect(screen.getByTestId('location')).toHaveTextContent('runId=run-waiting')
  expect(screen.queryByText('PREVIOUS_RUN_DETAIL')).not.toBeInTheDocument()
  expect(screen.getByText('CURRENT_RUN_DETAIL')).toBeInTheDocument()
})
