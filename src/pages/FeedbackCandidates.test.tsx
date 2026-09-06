import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Reviews } from './Reviews'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const candidate = { id: 'candidate', humanTaskId: 'task', originalVersionId: 'original', modifiedVersionId: 'modified',
  originalContent: 'Original source', modifiedContent: 'Modified source', unifiedDiff: '-original\n+modified', reason: 'Correction',
  tags: ['quality'], workflowRunId: 'run', workflowId: null, agentId: null, sourceNodeId: 'node', createdBy: 'reviewer',
  status: '待确认', createdAt: '2026-09-05T00:00:00Z', confirmedAt: null }

it('migration Reviews reads only candidate governance and displays the controlled source detail', async () => {
  vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'rubric-samples')
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/feedback-candidates')) return new Response(JSON.stringify([candidate]))
    if (url.endsWith('/feedback-candidates/candidate')) return new Response(JSON.stringify(candidate))
    throw new Error(`Unmigrated API requested: ${url}`)
  })
  vi.stubGlobal('fetch', fetch)
  render(<WorkspaceProvider workspace={{ id: 'a', slug: 'a', name: 'Synthetic' }}><Reviews /></WorkspaceProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /查看候选 candidate/ }))
  expect(await screen.findByText('Original source')).toBeInTheDocument()
  expect(screen.getByText('Modified source')).toBeInTheDocument()
  expect(screen.getByText(/专家资格由服务端核验/)).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('does not replace confirmed list state with an older refresh response', async () => {
  vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'rubric-samples')
  let release!: (value: Response) => void
  let lists = 0
  const old = new Promise<Response>(resolve => { release = resolve })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/confirm')) return new Response(JSON.stringify({ id: 'sample', expectedOutput: 'output' }), { status: 201 })
    if (url.endsWith('/feedback-candidates')) {
      lists++
      return lists === 2 ? old : new Response(JSON.stringify([{ ...candidate, status: lists >= 3 ? '已确认' : '待确认' }]))
    }
    return new Response(JSON.stringify(candidate))
  }))
  render(<WorkspaceProvider workspace={{ id: 'a', slug: 'a', name: 'Synthetic' }}><Reviews /></WorkspaceProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /查看候选 candidate/ }))
  fireEvent.change(await screen.findByLabelText('确认理由'), { target: { value: 'Reason' } })
  fireEvent.click(screen.getByRole('button', { name: '刷新候选' }))
  await waitFor(() => expect(lists).toBe(2))
  fireEvent.click(screen.getByRole('button', { name: '确认黄金样本' }))
  await screen.findByRole('button', { name: /查看候选 candidate · 已确认/ })
  await act(async () => { release(new Response(JSON.stringify([candidate]))); await old })
  expect(screen.getByRole('button', { name: /查看候选 candidate · 已确认/ })).toBeInTheDocument()
})

it('retries the exact confirmation body and distinguishes success from refresh failure', async () => {
  vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'rubric-samples')
  const attempts: string[] = []
  let lists = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/confirm')) {
      attempts.push(String(init?.body))
      return attempts.length === 1 ? new Response(JSON.stringify({ detail: '临时失败' }), { status: 503 })
        : new Response(JSON.stringify({ id: 'sample', candidateId: 'candidate', input: 'input', expectedOutput: 'Golden output',
          reviewerId: 'expert', reason: 'Expert reason', createdAt: candidate.createdAt }), { status: 201 })
    }
    if (url.endsWith('/feedback-candidates')) {
      lists++
      return lists === 1 ? new Response(JSON.stringify([candidate])) : new Response(JSON.stringify({ detail: '刷新失败' }), { status: 503 })
    }
    return new Response(JSON.stringify(candidate))
  }))
  render(<WorkspaceProvider workspace={{ id: 'a', slug: 'a', name: 'Synthetic' }}><Reviews /></WorkspaceProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /查看候选 candidate/ }))
  fireEvent.change(await screen.findByLabelText('确认理由'), { target: { value: 'Expert reason' } })
  fireEvent.click(screen.getByRole('button', { name: '确认黄金样本' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('临时失败')
  fireEvent.click(screen.getByRole('button', { name: '重试确认' }))
  expect(await screen.findByText('黄金样本已确认：sample')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('确认已成功，但列表刷新失败'))
  expect(attempts).toHaveLength(2)
  expect(attempts[1]).toBe(attempts[0])
  expect(screen.queryByRole('button', { name: '确认黄金样本' })).not.toBeInTheDocument()
})
