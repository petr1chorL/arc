import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Layout } from './Layout'

describe('Layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the real pending review count in navigation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([
        { id: 'review-1', status: '待处理' },
        { id: 'review-2', status: '待处理' },
        { id: 'review-3', status: '已完成' },
      ]), { status: 200 }),
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

    expect(await screen.findByText('2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '人工审核' })).toHaveTextContent('人工审核2')
  })
})
