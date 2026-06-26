import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/authContext'
import { WorkspaceContext } from '../auth/workspaceContextState'
import { Members } from './Members'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
  role: 'workspace_admin' as const,
}

const members = [
  {
    userId: 'user-1',
    invitationId: null,
    email: 'builder@example.com',
    displayName: 'Builder',
    role: 'builder' as const,
    userStatus: 'active',
    membershipStatus: 'active',
    reviewer: { role: '内容审核人', isExpert: true, isActive: true },
    lastLoginAt: '2026-06-26T09:00:00Z',
  },
  {
    userId: 'user-2',
    invitationId: 'invite-2',
    email: 'invitee@example.com',
    displayName: 'invitee@example.com',
    role: 'viewer' as const,
    userStatus: 'pending_email',
    membershipStatus: 'invited',
    reviewer: null,
    lastLoginAt: null,
  },
]

function renderPage(userId = 'user-1') {
  const authValue: AuthContextValue = {
    user: {
      id: userId,
      email: userId === 'user-2' ? 'invitee@example.com' : 'builder@example.com',
      displayName: userId === 'user-2' ? 'invitee@example.com' : 'Builder',
      isOrganizationAdmin: false,
    },
    workspaces: [workspace],
    status: 'authenticated',
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={authValue}>
        <WorkspaceContext.Provider
          value={{
            workspace,
            workspaceApiPath(path: string) {
              return `/api/workspaces/${workspace.id}${path}`
            },
            workspacePath(path = '') {
              const normalized = path ? `/${path}` : ''
              return `/w/${workspace.slug}${normalized}`
            },
          }}
        >
          <Members />
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('Members page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads members, invites a user, and copies the one-time activation link', async () => {
    const user = userEvent.setup()
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWrite },
      configurable: true,
    })
    const qualificationListener = vi.fn()
    window.addEventListener('reviewer-qualifications-updated', qualificationListener)
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/members` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify(members), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/invitations`) {
        return Promise.resolve(new Response(JSON.stringify({
          invitationId: 'invite-3',
          email: 'new.user@example.com',
          role: 'operator',
          expiresAt: '2026-06-29T09:00:00Z',
          activationUrl: 'http://testserver/activate/token-1',
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/invitations/invite-3/copy`) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === `/api/workspaces/${workspace.id}/members/user-1` && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({
          ...members[0],
          role: 'operator',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/members/user-1/reviewer` && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({
          ...members[0],
          reviewer: { role: '法务审核人', isExpert: false, isActive: true },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/members/user-1/reviewer` && init?.method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify({
          ...members[0],
          reviewer: { role: '法务审核人', isExpert: false, isActive: false },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      return Promise.reject(new Error(`Unhandled request: ${String(url)}`))
    }))

    renderPage()

    expect(await screen.findByText('builder@example.com')).toBeInTheDocument()
    expect(screen.getByText('内容审核人 · 专家')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '邀请成员' }))
    await user.type(screen.getByLabelText('邮箱'), 'new.user@example.com')
    await user.selectOptions(screen.getByLabelText('平台角色'), 'operator')
    await user.click(screen.getByRole('button', { name: '发送邀请' }))

    expect(await screen.findByText('邀请已创建，激活链接仅显示这一次。')).toBeInTheDocument()
    expect(screen.queryByText('token-1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '复制激活链接' }))
    expect(await screen.findByText('激活链接已复制。')).toBeInTheDocument()
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/invitations/invite-3/copy`,
      expect.objectContaining({ method: 'POST' }),
    )
    const copyCallIndex = fetchMock.mock.calls.findIndex(
      ([input]) => input === `/api/workspaces/${workspace.id}/invitations/invite-3/copy`,
    )
    expect(clipboardWrite.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[copyCallIndex],
    )

    await user.selectOptions(screen.getByLabelText('builder@example.com 的角色'), 'operator')
    await user.click(screen.getByRole('button', { name: '保存 builder@example.com 的角色' }))
    await waitFor(() => {
      expect(screen.getByLabelText('builder@example.com 的角色')).toHaveValue('operator')
    })

    await user.clear(screen.getByLabelText('builder@example.com 的审核角色'))
    await user.type(screen.getByLabelText('builder@example.com 的审核角色'), '法务审核人')
    await user.click(screen.getByLabelText('builder@example.com 专家审核'))
    await user.click(screen.getByRole('button', { name: '保存 builder@example.com 审核资格' }))
    expect(await screen.findByText('builder@example.com 审核资格已更新。')).toBeInTheDocument()
    const reviewerSaveCall = vi.mocked(fetch).mock.calls.find(([input, init]) => (
      input === `/api/workspaces/${workspace.id}/members/user-1/reviewer` && init?.method === 'PUT'
    ))
    expect(JSON.parse(reviewerSaveCall?.[1]?.body as string)).toEqual({
      role: '法务审核人',
      isExpert: false,
    })

    await user.click(screen.getByRole('button', { name: '撤销 builder@example.com 审核资格' }))
    expect(await screen.findByText('builder@example.com 审核资格已撤销。')).toBeInTheDocument()
    expect(qualificationListener).toHaveBeenCalledTimes(2)
    window.removeEventListener('reviewer-qualifications-updated', qualificationListener)
  })

  it('binds the current account as a reviewer for acceptance', async () => {
    const user = userEvent.setup()
    const qualificationListener = vi.fn()
    window.addEventListener('reviewer-qualifications-updated', qualificationListener)
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/members` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify(members), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/members/user-2/reviewer` && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({
          ...members[1],
          reviewer: { role: '产品审核人', isExpert: false, isActive: true },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      return Promise.reject(new Error(`Unhandled request: ${String(url)}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage('user-2')

    expect(await screen.findByText('当前账号未获得 Reviewer 资格')).toBeInTheDocument()
    expect(screen.getByLabelText('当前账号审核角色')).toHaveValue('产品审核人')
    await user.click(screen.getByRole('button', { name: '绑定当前账号为 Reviewer' }))

    expect(await screen.findByText('当前账号已绑定 Reviewer 资格。')).toBeInTheDocument()
    const bindCall = fetchMock.mock.calls.find(([input, init]) => (
      input === `/api/workspaces/${workspace.id}/members/user-2/reviewer` && init?.method === 'PUT'
    ))
    expect(JSON.parse(bindCall?.[1]?.body as string)).toEqual({
      role: '产品审核人',
      isExpert: false,
    })
    expect(qualificationListener).toHaveBeenCalledTimes(1)
    window.removeEventListener('reviewer-qualifications-updated', qualificationListener)
  })

  it('shows server conflict reasons for resend and updates membership state for disable and enable', async () => {
    let currentMembers = [...members]
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/members` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify(currentMembers), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/invitations/invite-2/resend`) {
        return Promise.resolve(new Response(JSON.stringify({ detail: '邀请已撤销' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/members/user-1/disable`) {
        currentMembers = currentMembers.map((member) => member.userId === 'user-1'
          ? { ...member, membershipStatus: 'disabled' }
          : member)
        return Promise.resolve(new Response(JSON.stringify(currentMembers[0]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/members/user-1/enable`) {
        currentMembers = currentMembers.map((member) => member.userId === 'user-1'
          ? { ...member, membershipStatus: 'active' }
          : member)
        return Promise.resolve(new Response(JSON.stringify(currentMembers[0]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/members/user-1/user/disable`) {
        currentMembers = currentMembers.map((member) => member.userId === 'user-1'
          ? { ...member, userStatus: 'disabled' }
          : member)
        return Promise.resolve(new Response(JSON.stringify(currentMembers[0]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/members/user-1/user/enable`) {
        currentMembers = currentMembers.map((member) => member.userId === 'user-1'
          ? { ...member, userStatus: 'active' }
          : member)
        return Promise.resolve(new Response(JSON.stringify(currentMembers[0]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      return Promise.reject(new Error(`Unhandled request: ${String(url)}`))
    }))
    const user = userEvent.setup()

    renderPage()

    expect((await screen.findAllByText('invitee@example.com')).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: '重发 invitee@example.com 邀请' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('邀请已撤销')

    await user.click(screen.getByRole('button', { name: '停用 builder@example.com' }))
    await waitFor(() => {
      expect(screen.getByText('disabled')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: '启用 builder@example.com' }))
    await waitFor(() => {
      const activeBadges = screen.getAllByText('active')
      expect(activeBadges.length).toBeGreaterThan(0)
    })

    await user.click(screen.getByRole('button', { name: '停用 User builder@example.com' }))
    await waitFor(() => {
      expect(screen.getByText('disabled')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: '启用 User builder@example.com' }))
    await waitFor(() => {
      const activeBadges = screen.getAllByText('active')
      expect(activeBadges.length).toBeGreaterThan(0)
    })
  })

  it('does not record copy audit when clipboard write fails', async () => {
    const user = userEvent.setup()
    const clipboardWrite = vi.fn().mockRejectedValue(new Error('clipboard denied'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWrite },
      configurable: true,
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/members` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify(members), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/invitations`) {
        return Promise.resolve(new Response(JSON.stringify({
          invitationId: 'invite-3',
          email: 'new.user@example.com',
          role: 'operator',
          expiresAt: '2026-06-29T09:00:00Z',
          activationUrl: 'http://testserver/activate/token-1',
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url === `/api/workspaces/${workspace.id}/invitations/invite-3/copy`) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`Unhandled request: ${String(url)}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await user.click(await screen.findByRole('button', { name: '邀请成员' }))
    await user.type(screen.getByLabelText('邮箱'), 'new.user@example.com')
    await user.selectOptions(screen.getByLabelText('平台角色'), 'operator')
    await user.click(screen.getByRole('button', { name: '发送邀请' }))
    await user.click(await screen.findByRole('button', { name: '复制激活链接' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('clipboard denied')
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/invitations/invite-3/copy`,
      expect.anything(),
    )
  })
})
