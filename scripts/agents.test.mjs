import { describe, expect, it } from 'vitest'
import { resolveAgentRoute } from '../netlify/functions/_shared/agents/routes.ts'
import { createAgentsHandler } from '../netlify/functions/_shared/agents/handler.ts'

describe('Agent governance route contract', () => {
  it.each([
    ['GET', '', 'list'], ['POST', '', 'create'],
    ['GET', '/agent', 'get'], ['PATCH', '/agent', 'update'],
    ['GET', '/agent/versions', 'versions'], ['POST', '/agent/publish', 'publish'],
    ['POST', '/agent/deactivate', 'deactivate'], ['POST', '/agent/activate', 'activate'],
  ])('resolves %s %s', (method, suffix, operation) => {
    expect(resolveAgentRoute(method, `/api/workspaces/workspace/agents${suffix}`)).toEqual({
      operation, params: { workspaceId: 'workspace', ...(suffix ? { agentId: 'agent' } : {}) },
    })
  })
  it.each([
    ['POST', '/agent/test-runs'], ['GET', '/agent/test-runs'],
    ['DELETE', '/agent'], ['GET', '/agent/publish'], ['POST', '/agent/versions'],
    ['POST', '/agent/unknown'], ['GET', '/agent/versions/extra'],
  ])('excludes %s %s', (method, suffix) => {
    expect(resolveAgentRoute(method, `/api/workspaces/workspace/agents${suffix}`)).toBeNull()
  })
  it.each(['%2F', '%5C', '%00', '%7F', '%ZZ'])('rejects unsafe segment %s', segment => {
    expect(resolveAgentRoute('GET', `/api/workspaces/${segment}/agents`)).toBeNull()
    expect(resolveAgentRoute('GET', `/api/workspaces/workspace/agents/${segment}`)).toBeNull()
  })
  it('decodes valid identifiers once', () => {
    expect(resolveAgentRoute('GET', '/api/workspaces/workspace%20one/agents/agent%20one')).toEqual({
      operation: 'get', params: { workspaceId: 'workspace one', agentId: 'agent one' },
    })
  })
})

describe('Agent HTTP boundary', () => {
  const root = 'https://synthetic.invalid/api/workspaces/workspace/agents'
  it('keeps direct Function URLs dormant before environment and database access', async () => {
    const { default: entry } = await import('../netlify/functions/agents.mts')
    const response = await entry(new Request('https://synthetic.invalid/.netlify/functions/agents?route=/api/workspaces/a/agents'), {})
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it.each([['POST', ''], ['PATCH', '/agent'], ['POST', '/agent/publish'],
    ['POST', '/agent/deactivate'], ['POST', '/agent/activate']])(
    'rejects foreign Origin for %s %s before calling persistence', async (method, suffix) => {
      let called = false
      const response = await createAgentsHandler(async () => { called = true; return {} })(
        new Request(root + suffix, { method, headers: { Origin: 'https://foreign.invalid' }, body: '{}' }),
      )
      expect(response.status).toBe(403)
      expect(called).toBe(false)
    },
  )
  it('passes authentication context and body to the existing backend contract', async () => {
    let received
    const response = await createAgentsHandler(async input => {
      received = input
      return { status: 201, body: { id: 'synthetic' } }
    }, { clientAddress: '192.0.2.1' })(new Request(root, {
      method: 'POST', headers: { Origin: 'https://synthetic.invalid',
        Cookie: 'arc_one_session=synthetic%20session', 'X-CSRF-Token': 'synthetic-csrf' },
      body: JSON.stringify({ name: 'Synthetic' }),
    }))
    expect(response.status).toBe(201)
    expect(received.sessionToken).toBe('synthetic session')
    expect(received.csrfToken).toBe('synthetic-csrf')
    expect(received.clientAddress).toBe('192.0.2.1')
    expect(received.body).toEqual({ name: 'Synthetic' })
    expect(received.route.operation).toBe('create')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it('rejects execution before invoking the backend', async () => {
    let called = false
    const response = await createAgentsHandler(async () => { called = true; return {} })(
      new Request(`${root}/agent/test-runs`, { method: 'POST', body: '{}' }),
    )
    expect(response.status).toBe(404)
    expect(called).toBe(false)
  })
  it('does not echo malformed body or call the backend', async () => {
    let called = false
    const response = await createAgentsHandler(async () => { called = true; return {} })(
      new Request(root, { method: 'POST', body: 'synthetic-private-marker' }),
    )
    expect(response.status).toBe(422)
    expect(await response.text()).not.toContain('synthetic-private-marker')
    expect(called).toBe(false)
  })
  it('hides unexpected backend exception details', async () => {
    const response = await createAgentsHandler(async () => { throw new Error('synthetic-private-marker') })(new Request(root))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('synthetic-private-marker')
  })
})
