import { describe, expect, it } from 'vitest'
import { resolveFeedbackRoute } from '../netlify/functions/_shared/feedback-candidates/routes.ts'
import { parseGoldenSampleConfirm } from '../netlify/functions/_shared/feedback-candidates/policy.ts'
import { createFeedbackHandler } from '../netlify/functions/_shared/feedback-candidates/handler.ts'

describe('Feedback candidate governance boundary', () => {
  it('keeps the direct Function URL dormant before environment or database access', async () => {
    const { default: entry } = await import('../netlify/functions/feedback-candidates.mts')
    const response = await entry(new Request('https://synthetic.invalid/.netlify/functions/feedback-candidates?route=/api/workspaces/a/feedback-candidates'), {})
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it('resolves only the three approved operations', () => {
    for (const [method, suffix, operation] of [['GET', '', 'list'], ['GET', '/candidate', 'detail'], ['POST', '/candidate/confirm', 'confirm']]) {
      expect(resolveFeedbackRoute(method, `/api/workspaces/workspace/feedback-candidates${suffix}`)).toEqual({
        operation, params: { workspaceId: 'workspace', ...(suffix ? { candidateId: 'candidate' } : {}) },
      })
    }
  })
  it('preserves the exact reason and idempotency key, including whitespace', () => {
    expect(parseGoldenSampleConfirm({ reason: ' reason ', idempotencyKey: ' key ' })).toEqual({ reason: ' reason ', idempotency_key: ' key ' })
  })
  it('accepts snake case, whitespace and Unicode code-point boundaries', () => {
    expect(parseGoldenSampleConfirm({ reason: ' ', idempotency_key: ' ' })).toEqual({ reason: ' ', idempotency_key: ' ' })
    expect(parseGoldenSampleConfirm({ reason: '😀'.repeat(4000), idempotencyKey: '😀'.repeat(160) }).idempotency_key).toBe('😀'.repeat(160))
  })
  it.each([
    null, [], {}, { reason: 'x' }, { reason: '', idempotencyKey: 'key' },
    { reason: 'x', idempotencyKey: '' }, { reason: null, idempotencyKey: 'key' },
    { reason: true, idempotencyKey: 'key' }, { reason: 'x', idempotencyKey: 123 },
    { reason: 'x', idempotencyKey: 'key', idempotency_key: 'key' },
    { reason: 'x', idempotencyKey: 'key', expectedOutput: 'untrusted' },
    { reason: '😀'.repeat(4001), idempotencyKey: 'key' },
    { reason: 'x', idempotencyKey: '😀'.repeat(161) },
  ])('rejects invalid confirmation body %# without echoing input', body => {
    expect(() => parseGoldenSampleConfirm(body)).toThrow('量规或样本请求字段不符合要求')
    try { parseGoldenSampleConfirm(body) } catch (error) { expect(error.status).toBe(422) }
  })
  it.each([['POST', ''], ['PATCH', '/candidate'], ['DELETE', '/candidate'], ['GET', '/candidate/confirm'],
    ['POST', '/candidate/confirm/extra'], ['POST', '/candidate/publish']])('excludes %s %s', (method, suffix) => {
    expect(resolveFeedbackRoute(method, `/api/workspaces/workspace/feedback-candidates${suffix}`)).toBeNull()
  })
  it.each(['%2F', '%5C', '%00', '%7F', '%ZZ'])('rejects unsafe identifiers %s', id => {
    expect(resolveFeedbackRoute('GET', `/api/workspaces/${id}/feedback-candidates`)).toBeNull()
    expect(resolveFeedbackRoute('GET', `/api/workspaces/workspace/feedback-candidates/${id}`)).toBeNull()
  })
  it('rejects a foreign confirmation Origin before backend access', async () => {
    let called = false
    const response = await createFeedbackHandler(async () => { called = true; return {} })(new Request(
      'https://synthetic.invalid/api/workspaces/workspace/feedback-candidates/candidate/confirm', {
        method: 'POST', headers: { Origin: 'https://foreign.invalid' }, body: '{}',
      }))
    expect(response.status).toBe(403)
    expect(called).toBe(false)
  })
  it('forwards session and CSRF without inventing expert authorization', async () => {
    let received
    const response = await createFeedbackHandler(async input => { received = input; return { status: 201, body: { id: 'sample' } } })(
      new Request('https://synthetic.invalid/api/workspaces/workspace/feedback-candidates/candidate/confirm', {
        method: 'POST', headers: { Cookie: 'arc_one_session=synthetic', 'X-CSRF-Token': 'csrf' },
        body: JSON.stringify({ reason: 'Reason', idempotencyKey: 'key' }),
      }))
    expect(response.status).toBe(201)
    expect(received.sessionToken).toBe('synthetic')
    expect(received.csrfToken).toBe('csrf')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
