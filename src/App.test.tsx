import { render, screen } from '@testing-library/react'
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

    expect(await screen.findByText('无权访问该 Workspace')).toBeInTheDocument()
  })
})
