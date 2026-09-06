import { describe, expect, it } from 'vitest'
import { resolveDataObjectRoute } from '../netlify/functions/_shared/data-objects/routes.ts'
import { createDataObjectsHandler } from '../netlify/functions/_shared/data-objects/handler.ts'
import { parseDataObjectCreate, parseDataObjectUpdate } from '../netlify/functions/_shared/data-objects/policy.ts'

describe('Data Object governance routes', () => {
  it.each([
    ['GET', '', 'list'], ['POST', '', 'create'], ['PATCH', '/definition', 'update'],
    ['POST', '/definition/publish', 'publish'], ['GET', '/definition/versions', 'versions'],
  ])('resolves %s %s', (method, suffix, operation) => {
    expect(resolveDataObjectRoute(method, `/api/workspaces/workspace/data-objects${suffix}`)).toEqual({
      operation, params: { workspaceId: 'workspace', ...(suffix ? { definitionId: 'definition' } : {}) },
    })
  })
  it.each([
    ['GET', '/definition'], ['DELETE', '/definition'], ['POST', '/definition/deactivate'],
    ['POST', '/definition/versions'], ['GET', '/definition/publish'], ['GET', '/definition/versions/extra'],
  ])('excludes %s %s', (method, suffix) => {
    expect(resolveDataObjectRoute(method, `/api/workspaces/workspace/data-objects${suffix}`)).toBeNull()
  })
  it.each(['%2F', '%5C', '%00', '%7F', '%ZZ'])('rejects unsafe identifiers %s', segment => {
    expect(resolveDataObjectRoute('GET', `/api/workspaces/${segment}/data-objects`)).toBeNull()
    expect(resolveDataObjectRoute('PATCH', `/api/workspaces/workspace/data-objects/${segment}`)).toBeNull()
  })
})

describe('Data Object request boundary', () => {
  it('preserves schema objects, trims only name, and defaults description', () => {
    expect(parseDataObjectCreate({ name: ' Object ', schema: {} })).toEqual({ name: 'Object', description: '', object_schema: {} })
    expect(parseDataObjectCreate({ name: 'Object', description: ' text ', object_schema: { required: ['x'] } }))
      .toEqual({ name: 'Object', description: ' text ', object_schema: { required: ['x'] } })
  })
  it.each([
    null, [], {}, { name: ' ', schema: {} }, { name: 'x', schema: [] },
    { name: 'x', schema: null }, { name: 'x', schema: {}, extra: true },
    { name: 'x', schema: {}, object_schema: {} }, { name: 'x', description: null, schema: {} },
    { name: 'x'.repeat(121), schema: {} }, { name: 'x', description: 'x'.repeat(2001), schema: {} },
  ])('rejects invalid creation without reflecting input %#', body => {
    expect(() => parseDataObjectCreate(body)).toThrow('Data Object 请求字段不符合要求')
  })
  it('skips PATCH nulls and missing fields without introducing create defaults', () => {
    expect(parseDataObjectUpdate({})).toEqual({})
    expect(parseDataObjectUpdate({ name: null, description: null, schema: null })).toEqual({})
    expect(parseDataObjectUpdate({ description: ' untouched ' })).toEqual({ description: ' untouched ' })
    expect(parseDataObjectUpdate({ object_schema: {} })).toEqual({ object_schema: {} })
  })
  it.each([{ name: '' }, { schema: [] }, { extra: null }, { schema: null, object_schema: {} }])('rejects invalid updates %#', body => {
    expect(() => parseDataObjectUpdate(body)).toThrow('Data Object 请求字段不符合要求')
  })
  const root = 'https://synthetic.invalid/api/workspaces/workspace/data-objects'
  it('keeps the Function URL dormant before database and environment access', async () => {
    const { default: entry } = await import('../netlify/functions/data-objects.mts')
    const response = await entry(new Request('https://synthetic.invalid/.netlify/functions/data-objects?route=/api/workspaces/a/data-objects'), {})
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it.each([['POST', ''], ['PATCH', '/definition'], ['POST', '/definition/publish']])('blocks foreign Origin %s %s', async (method, suffix) => {
    let called = false
    const response = await createDataObjectsHandler(async () => { called = true; return {} })(
      new Request(root + suffix, { method, headers: { Origin: 'https://foreign.invalid' }, body: '{}' }))
    expect(response.status).toBe(403)
    expect(called).toBe(false)
  })
  it('forwards session, CSRF and body without weakening persistence checks', async () => {
    let received
    const response = await createDataObjectsHandler(async input => {
      received = input
      return { status: 201, body: { id: 'synthetic' } }
    })(new Request(root, { method: 'POST', headers: { Cookie: 'arc_one_session=synthetic',
      'X-CSRF-Token': 'synthetic-csrf' }, body: JSON.stringify({ name: 'x', schema: {} }) }))
    expect(response.status).toBe(201)
    expect(received.sessionToken).toBe('synthetic')
    expect(received.csrfToken).toBe('synthetic-csrf')
    expect(received.body).toEqual({ name: 'x', schema: {} })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
