import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App workspace auth routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
  })

  it('redirects anonymous workspace visits to login after session 401', async () => {
    window.history.replaceState({}, '', '/w/ai-capability-center/agents')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: '未登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    render(<App />)

    expect(await screen.findByRole('heading', { name: '登录 ARC.ONE' })).toBeInTheDocument()
  })

  it('enters the accessible workspace route after session bootstrap', async () => {
    window.history.replaceState({}, '', '/')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: {
          id: 'user-1',
          email: 'builder@example.com',
          displayName: 'Builder',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          id: 'workspace-1',
          slug: 'ai-capability-center',
          name: 'AI 能力中心',
          role: 'builder',
          isOrganizationAdmin: false,
        },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })))

    render(<App />)

    expect(await screen.findByRole('heading', { name: '运营总览' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/w/ai-capability-center')
  })

  it('shows inaccessible state for workspace slugs outside the current session scope', async () => {
    window.history.replaceState({}, '', '/w/workspace-b/agents')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: {
          id: 'user-1',
          email: 'viewer@example.com',
          displayName: 'Viewer',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          id: 'workspace-a',
          slug: 'ai-capability-center',
          name: 'AI 能力中心',
          role: 'viewer',
          isOrganizationAdmin: false,
        },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<App />)

    expect(await screen.findByText(/Workspace/)).toBeInTheDocument()
  })

  it('returns to the protected deep link after a successful login', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/w/ai-capability-center/agents')

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url

      if (url === '/api/auth/session') {
        return new Response(JSON.stringify({ detail: '未登录' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/api/auth/login') {
        return new Response(JSON.stringify({
          user: {
            id: 'user-1',
            email: 'builder@example.com',
            displayName: 'Builder',
            lastWorkspaceId: 'workspace-1',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/workspaces') {
        return new Response(JSON.stringify([
          {
            id: 'workspace-1',
            slug: 'ai-capability-center',
            name: 'AI 能力中心',
            role: 'builder',
            isOrganizationAdmin: false,
          },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/workspaces/workspace-1/human-tasks') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/api/workspaces/workspace-1/agents') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await screen.findByRole('heading', { name: '登录 ARC.ONE' })
    await user.type(screen.getByLabelText('邮箱'), 'builder@example.com')
    await user.type(screen.getByLabelText('密码'), 'passw0rd')
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('heading', { name: 'Agent 资产' })).toBeInTheDocument()
    await waitFor(() => {
      expect(window.location.pathname).toBe('/w/ai-capability-center/agents')
    })
  })
})
