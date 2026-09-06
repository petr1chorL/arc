import { describe, expect, it } from 'vitest'
import { resolveRubricRoute } from '../netlify/functions/_shared/rubrics/routes.ts'
import { createRubricsHandler } from '../netlify/functions/_shared/rubrics/handler.ts'
import { parseRubricWrite } from '../netlify/functions/_shared/rubrics/policy.ts'
import cases from '../fixtures/rubric-policy.json'

describe('Rubric governance route boundary', () => {
  it('matches the six approved routes with scoped identifiers', () => {
    for (const [method, suffix, operation] of [
      ['GET', '', 'list'], ['POST', '', 'create'], ['PATCH', '/rubric', 'update'],
      ['GET', '/rubric/versions', 'versions'], ['POST', '/rubric/publish', 'publish'],
      ['POST', '/rubric/deactivate', 'deactivate'],
    ]) {
      expect(resolveRubricRoute(method, `/api/workspaces/workspace/evaluations/rubrics${suffix}`)).toEqual({
        operation, params: { workspaceId: 'workspace', ...(suffix ? { rubricId: 'rubric' } : {}) },
      })
    }
  })
  it.each([
    ['GET', '/rubric'], ['DELETE', '/rubric'], ['POST', '/rubric/run'],
    ['POST', '/rubric/versions'], ['GET', '/rubric/publish'], ['GET', '/rubric/deactivate'],
    ['GET', '/rubric/versions/extra'], ['PATCH', ''],
  ])('excludes unsupported %s %s', (method, suffix) => {
    expect(resolveRubricRoute(method, `/api/workspaces/workspace/evaluations/rubrics${suffix}`)).toBeNull()
  })
  it.each(['%2F', '%5C', '%00', '%7F', '%ZZ'])('rejects unsafe identifiers %s', id => {
    expect(resolveRubricRoute('GET', `/api/workspaces/${id}/evaluations/rubrics`)).toBeNull()
    expect(resolveRubricRoute('PATCH', `/api/workspaces/workspace/evaluations/rubrics/${id}`)).toBeNull()
  })
})

describe('Rubric HTTP boundary', () => {
  const root = 'https://synthetic.invalid/api/workspaces/workspace/evaluations/rubrics'
  it('keeps the direct Function URL dormant before reading Netlify environment or database', async () => {
    const { default: entry } = await import('../netlify/functions/rubrics.mts')
    const response = await entry(new Request('https://synthetic.invalid/.netlify/functions/rubrics?route=/api/workspaces/a/evaluations/rubrics'), {})
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it.each([['POST', ''], ['PATCH', '/rubric'], ['POST', '/rubric/publish'], ['POST', '/rubric/deactivate']])(
    'rejects foreign Origin before backend access: %s %s', async (method, suffix) => {
      let called = false
      const response = await createRubricsHandler(async () => { called = true; return {} })(
        new Request(root + suffix, { method, headers: { Origin: 'https://foreign.invalid' }, body: '{}' }))
      expect(response.status).toBe(403)
      expect(called).toBe(false)
    })
  it('forwards session, CSRF and the complete body without claiming backend authorization', async () => {
    let received
    const body = { name: 'Synthetic rubric', dimensions: [] }
    const response = await createRubricsHandler(async input => {
      received = input
      return { status: 201, body: { id: 'synthetic' } }
    })(new Request(root, { method: 'POST', headers: { Cookie: 'arc_one_session=synthetic',
      'X-CSRF-Token': 'synthetic-csrf' }, body: JSON.stringify(body) }))
    expect(response.status).toBe(201)
    expect(received.sessionToken).toBe('synthetic')
    expect(received.csrfToken).toBe('synthetic-csrf')
    expect(received.body).toEqual(body)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it('rejects scoring execution and never calls the backend', async () => {
    let called = false
    const response = await createRubricsHandler(async () => { called = true; return {} })(
      new Request(root + '/rubric/run', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(404)
    expect(called).toBe(false)
  })
  it('does not expose unexpected backend errors', async () => {
    const response = await createRubricsHandler(async () => { throw new Error('synthetic-private-detail') })(new Request(root))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ detail: '服务暂时不可用' })
  })
})

describe('Rubric full-write field policy', () => {
  it.each(cases)('$name', ({ body, status }) => {
    if (status === 422) expect(() => parseRubricWrite(body)).toThrow('量规或样本请求字段不符合要求')
    else expect(() => parseRubricWrite(body)).not.toThrow()
  })
})
