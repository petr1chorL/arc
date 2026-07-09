import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { Login } from './Login'

describe('Login page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the login form for anonymous users', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: '未登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '登录 ARC.ONE' })).toBeInTheDocument()
    expect(screen.getByLabelText('ARC.ONE')).toHaveTextContent('ARC')
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
  })
})
