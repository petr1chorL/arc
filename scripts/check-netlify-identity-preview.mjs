import assert from 'node:assert/strict'

const baseUrl = process.argv[2]
if (!baseUrl?.startsWith('https://deploy-preview-')) {
  throw new Error('A Netlify Deploy Preview HTTPS URL is required')
}

const workspaceId = '44444444-4444-4444-8444-444444444444'

function cookieJar() {
  const values = new Map()
  return {
    header() {
      return [...values].map(([name, value]) => `${name}=${value}`).join('; ')
    },
    update(response) {
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0]
        const separator = pair.indexOf('=')
        const name = pair.slice(0, separator)
        const value = pair.slice(separator + 1)
        if (value) values.set(name, value)
        else values.delete(name)
      }
    },
    get(name) {
      return values.get(name)
    },
  }
}

async function request(path, { method = 'GET', body, jar, csrf = false } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (jar?.header()) headers.Cookie = jar.header()
  if (csrf) headers['X-CSRF-Token'] = jar.get('arc_one_csrf')
  if (method !== 'GET') headers.Origin = baseUrl
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  jar?.update(response)
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  return { response, payload }
}

async function login(email, password) {
  const jar = cookieJar()
  const result = await request('/api/auth/login', {
    method: 'POST', jar, body: { email, password },
  })
  assert.equal(result.response.status, 200, JSON.stringify(result.payload))
  assert.ok(jar.get('arc_one_session'))
  assert.ok(jar.get('arc_one_csrf'))
  return { jar, payload: result.payload }
}

const anonymous = await request('/api/auth/session')
assert.equal(anonymous.response.status, 401)

const admin = await login(
  'netlify-preview-admin@arc-one.invalid',
  'Preview Admin Password 42!',
)
assert.equal(admin.payload.user.isOrganizationAdmin, true)

const session = await request('/api/auth/session', { jar: admin.jar })
assert.equal(session.response.status, 200)
assert.equal(session.payload.user.id, '22222222-2222-4222-8222-222222222222')

const workspaces = await request('/api/workspaces', { jar: admin.jar })
assert.equal(workspaces.response.status, 200)
assert.deepEqual(workspaces.payload.map(({ id, role }) => ({ id, role })), [
  { id: workspaceId, role: 'workspace_admin' },
])

const matrix = await request(`/api/workspaces/${workspaceId}/permissions/matrix`, { jar: admin.jar })
assert.equal(matrix.response.status, 200)
assert.deepEqual(matrix.payload.roles, ['viewer', 'operator', 'builder', 'workspace_admin'])

const initialMembers = await request(`/api/workspaces/${workspaceId}/members`, { jar: admin.jar })
assert.equal(initialMembers.response.status, 200)
assert.equal(initialMembers.payload.length, 2)

const invitationEmail = `preview-invite-${Date.now()}@arc-one.invalid`
const csrfFailure = await request(`/api/workspaces/${workspaceId}/invitations`, {
  method: 'POST', jar: admin.jar, body: { email: invitationEmail, role: 'operator' },
})
assert.equal(csrfFailure.response.status, 403)
assert.equal(csrfFailure.payload.detail, 'CSRF 校验失败')

const invitation = await request(`/api/workspaces/${workspaceId}/invitations`, {
  method: 'POST', jar: admin.jar, csrf: true, body: { email: invitationEmail, role: 'operator' },
})
assert.equal(invitation.response.status, 201, JSON.stringify(invitation.payload))
assert.equal(invitation.payload.email, invitationEmail)
const activationUrl = new URL(invitation.payload.activationUrl)
const token = activationUrl.pathname.split('/').at(-1)
assert.ok(token)

const preview = await request(`/api/invitations/${encodeURIComponent(token)}`)
assert.equal(preview.response.status, 200)
assert.equal(preview.payload.workspaceName, 'ARC.ONE Preview Workspace')

const activation = await request(`/api/invitations/${encodeURIComponent(token)}/activate`, {
  method: 'POST', body: { displayName: 'Preview Invited User', password: 'Invited Test Password 42!' },
})
assert.equal(activation.response.status, 204, JSON.stringify(activation.payload))

const members = await request(`/api/workspaces/${workspaceId}/members`, { jar: admin.jar })
assert.equal(members.response.status, 200)
assert.equal(members.payload.find((member) => member.email === invitationEmail)?.membershipStatus, 'active')

const audit = await request(`/api/workspaces/${workspaceId}/audit-events?limit=20`, { jar: admin.jar })
assert.equal(audit.response.status, 200)
assert.ok(audit.payload.some((event) => event.action === 'member.invitation.activate'))
assert.ok(audit.payload.some((event) => event.action === 'member.invitation.create'))

const viewer = await login(
  'netlify-preview-viewer@arc-one.invalid',
  'Preview Viewer Password 42!',
)
const denied = await request(`/api/workspaces/${workspaceId}/permissions/matrix`, { jar: viewer.jar })
assert.equal(denied.response.status, 403)
assert.equal(denied.payload.detail, '权限不足')

const unmigrated = await request(`/api/workspaces/${workspaceId}/agents`, { jar: viewer.jar })
assert.equal(unmigrated.response.status, 401)

const logout = await request('/api/auth/logout', { method: 'POST', jar: admin.jar, csrf: true })
assert.equal(logout.response.status, 204)
const afterLogout = await request('/api/auth/session', { jar: admin.jar })
assert.equal(afterLogout.response.status, 401)

console.log(JSON.stringify({
  status: 'passed',
  deployPreview: baseUrl,
  workspaceId,
  checks: 16,
  invitationEmail,
}))
