import { describe, expect, it } from 'vitest'
import { resolveReferenceAssetRoute } from '../netlify/functions/_shared/reference-assets/routes.ts'
import { createReferenceAssetsHandler } from '../netlify/functions/_shared/reference-assets/handler.ts'

describe('reference asset route contract', () => {
  for (const [resource, kind] of [['model-providers', 'provider'], ['asset-library', 'asset']]) {
    for (const [method, suffix, operation] of [
      ['GET', '', 'list'], ['POST', '', 'create'], ['PATCH', '/item', 'update'],
      ['POST', '/item/deactivate', 'deactivate'], ['GET', '/item/impact', 'impact'],
      ['GET', '/item/audit-events', 'audit'],
    ]) {
      it(`${method} ${resource}${suffix}`, () => {
        expect(resolveReferenceAssetRoute(method, `/api/workspaces/workspace/${resource}${suffix}`))
          .toEqual({ kind, operation, params: { workspaceId: 'workspace', ...(suffix ? { assetId: 'item' } : {}) } })
      })
    }
  }
  it('resolves invocation history before any item route', () => {
    expect(resolveReferenceAssetRoute('GET', '/api/workspaces/workspace/asset-library/invocations'))
      .toEqual({ kind: 'asset', operation: 'invocations', params: { workspaceId: 'workspace' } })
  })
  it.each(['test', 'migrate-drafts', 'test-invocations'])('does not enable %s', action => {
    expect(resolveReferenceAssetRoute('POST', `/api/workspaces/workspace/asset-library/item/${action}`)).toBeNull()
    if (action === 'test-invocations') expect(resolveReferenceAssetRoute('POST', `/api/workspaces/workspace/model-providers/item/${action}`)).toBeNull()
  })
  it.each(['test', 'migrate-drafts'])('resolves Provider compatibility %s', operation => {
    expect(resolveReferenceAssetRoute('POST', `/api/workspaces/workspace/model-providers/item/${operation}`))
      .toEqual({ kind: 'provider', operation, params: { workspaceId: 'workspace', assetId: 'item' } })
  })
  it('rejects encoded path separators and malformed encodings', () => {
    for (const workspace of ['%2F', '%5C', '%00', '%ZZ']) {
      expect(resolveReferenceAssetRoute('GET', `/api/workspaces/${workspace}/asset-library`)).toBeNull()
    }
  })
})

describe('reference asset request boundary', () => {
  it('keeps the direct Netlify function URL dormant without environment or database access', async () => {
    const { default: entry } = await import('../netlify/functions/reference-assets.mts')
    const response = await entry(new Request('https://synthetic.invalid/.netlify/functions/reference-assets?route=/api/workspaces/a/asset-library'), {})
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  const path = 'https://synthetic.invalid/api/workspaces/workspace/model-providers'
  it('delegates decoded session and CSRF values without implementing a second login system', async () => {
    let received
    const handler = createReferenceAssetsHandler(async input => {
      received = input
      return { status: 201, body: { id: 'synthetic' } }
    })
    const response = await handler(new Request(path, { method: 'POST', headers: {
      Cookie: 'arc_one_session=synthetic%20session', 'X-CSRF-Token': 'synthetic-csrf',
    }, body: JSON.stringify({ name: 'test' }) }))
    expect(response.status).toBe(201)
    expect(received.sessionToken).toBe('synthetic session')
    expect(received.csrfToken).toBe('synthetic-csrf')
    expect(received.route.kind).toBe('provider')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it('rejects foreign Origin before reaching the backend', async () => {
    let called = false
    const response = await createReferenceAssetsHandler(async () => { called = true; return {} })(
      new Request(path, { method: 'POST', headers: { Origin: 'https://foreign.invalid' }, body: '{}' }),
    )
    expect(response.status).toBe(403)
    expect(called).toBe(false)
  })
  it('does not enable an execution endpoint', async () => {
    let called = false
    const response = await createReferenceAssetsHandler(async () => { called = true; return {} })(
      new Request(`${path}/item/test-invocations`, { method: 'POST' }),
    )
    expect(response.status).toBe(404)
    expect(called).toBe(false)
  })
  it('does not echo malformed input', async () => {
    const response = await createReferenceAssetsHandler(async () => ({}))(
      new Request(path, { method: 'POST', body: 'synthetic-sensitive-marker' }),
    )
    expect(response.status).toBe(422)
    expect(await response.text()).not.toContain('synthetic-sensitive-marker')
  })
  it('does not echo unexpected backend errors', async () => {
    const response = await createReferenceAssetsHandler(async () => { throw new Error('synthetic-sensitive-marker') })(new Request(path))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('synthetic-sensitive-marker')
  })
})
