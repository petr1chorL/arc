import { afterEach, describe, expect, it, vi } from 'vitest'
import { activateInvitation, getSession, login, logout, previewInvitation } from './auth'

describe('Auth API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls the login, logout and session endpoints through apiFetch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: {
          id: 'user-1',
          email: 'builder@example.com',
          displayName: 'Builder',
          isOrganizationAdmin: false,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: {
          id: 'user-1',
          email: 'builder@example.com',
          displayName: 'Builder',
          isOrganizationAdmin: false,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(login('builder@example.com', 'password-123456')).resolves.toMatchObject({
      user: { email: 'builder@example.com' },
    })
    await expect(getSession()).resolves.toMatchObject({
      user: { id: 'user-1' },
    })
    await expect(logout()).resolves.toBeUndefined()
  })

  it('supports invitation preview and activation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        email: 'new.user@example.com',
        workspaceName: 'AI 能力中心',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(previewInvitation('token-1')).resolves.toMatchObject({
      email: 'new.user@example.com',
    })
    await expect(activateInvitation('token-1', {
      displayName: '新成员',
      password: 'password-123456',
    })).resolves.toBeUndefined()
  })
})
