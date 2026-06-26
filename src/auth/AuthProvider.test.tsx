import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from './authContext'
import { AuthProvider } from './AuthProvider'

function AuthProbe() {
  const auth = useAuth()
  return (
    <div>
      <span>{auth.status}</span>
      <span>{auth.user?.displayName ?? 'anonymous'}</span>
    </div>
  )
}

describe('AuthProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads session and workspaces before becoming authenticated', async () => {
    const fetchMock = vi.fn()
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
    vi.stubGlobal('fetch', fetchMock)

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(await screen.findByText('authenticated')).toBeInTheDocument()
    expect(screen.getByText('Builder')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })
})
