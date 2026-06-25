import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Layout } from './Layout'

describe('Layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the real pending review count in navigation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([
        { id: 'task-1', status: '待认领' },
        { id: 'task-2', status: '审核中' },
        { id: 'task-3', status: '已通过' },
        { id: 'task-4', status: '已驳回' },
      ]), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<div>首页</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '人工审核' })).toHaveTextContent('人工审核2')
    expect(fetchMock).toHaveBeenCalledWith('/api/human-tasks')
  })

  it('keeps the shell usable when the human task count fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: '服务暂不可用' }), { status: 503 }),
    ))

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<div>首页</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('首页')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '人工审核' })).toHaveTextContent('人工审核')
    expect(screen.getByRole('link', { name: '人工审核' }).querySelector('em')).toBeNull()
  })
})
