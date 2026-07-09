import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivateInvitation } from './ActivateInvitation'

describe('ActivateInvitation page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads invitation preview and shows activation form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        email: 'invitee@example.com',
        workspaceName: 'AI 能力中心',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    render(
      <MemoryRouter initialEntries={['/activate/token-1']}>
        <Routes>
          <Route path="/activate/:token" element={<ActivateInvitation />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('即将加入 AI 能力中心')).toBeInTheDocument()
    expect(screen.getByLabelText('显示名称')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
  })
})
