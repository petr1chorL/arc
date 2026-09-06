import { describe, expect, it } from 'vitest'
import { createWorkflowsHandler } from '../netlify/functions/_shared/workflows/handler.ts'

describe('Workflow governance route boundary', () => {
  it.each([
    ['GET', '/reviewers', 'reviewers'], ['GET', '/review-groups', 'review-groups'],
    ['GET', '/workflows', 'list'], ['POST', '/workflows', 'create'],
    ['GET', '/workflows/flow', 'get'], ['PATCH', '/workflows/flow', 'update'],
    ['DELETE', '/workflows/flow', 'delete'], ['POST', '/workflows/flow/validate', 'validate'],
    ['GET', '/workflows/flow/versions', 'versions'], ['POST', '/workflows/flow/publish', 'publish'],
  ])('resolves approved %s %s', async (method, path, operation) => {
    const { resolveWorkflowRoute } = await import('../netlify/functions/_shared/workflows/routes.ts')
    expect(resolveWorkflowRoute(method, `/api/workspaces/a${path}`)).toEqual({
      operation, params: { workspaceId: 'a', ...(path.includes('/flow') ? { workflowId: 'flow' } : {}) },
    })
  })
  it.each([
    ['POST', '/reviewers'], ['DELETE', '/review-groups'], ['GET', '/reviewers/person'],
    ['POST', '/workflows/flow/runs'], ['GET', '/workflows/flow/publish'],
    ['GET', '/workflows/%2f'], ['GET', '/workflows/%5c'], ['GET', '/workflows/%00'],
    ['GET', '/workflows/%ZZ'], ['POST', '/workflows/flow/publish/extra'],
  ])('excludes %s %s', async (method, path) => {
    const { resolveWorkflowRoute } = await import('../netlify/functions/_shared/workflows/routes.ts')
    expect(resolveWorkflowRoute(method, `/api/workspaces/a${path}`)).toBeNull()
  })
})

describe('Workflow HTTP protections', () => {
  it('keeps the public Function URL dormant before accessing environment or database', async () => {
    const { default: entry } = await import('../netlify/functions/workflows.mts')
    const response = await entry(new Request('https://synthetic.invalid/.netlify/functions/workflows?route=/api/workspaces/a/workflows'), {})
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it.each([['POST', ''], ['PATCH', '/flow'], ['DELETE', '/flow'], ['POST', '/flow/publish']])(
    'rejects foreign Origin before backend on %s %s', async (method, suffix) => {
      let called = false
      const response = await createWorkflowsHandler(async () => { called = true; return {} })(
        new Request(`https://synthetic.invalid/api/workspaces/a/workflows${suffix}`, {
          method, headers: { Origin: 'https://foreign.invalid' }, body: '{}',
        }))
      expect(response.status).toBe(403)
      expect(called).toBe(false)
    })
  it('preserves the existing read-only validate POST and no-store response', async () => {
    let received
    const response = await createWorkflowsHandler(async input => { received = input; return { body: { valid: false, errors: ['Synthetic'] } } })(
      new Request('https://synthetic.invalid/api/workspaces/a/workflows/flow/validate', {
        method: 'POST', headers: { Cookie: 'arc_one_session=synthetic' },
      }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(received.sessionToken).toBe('synthetic')
    expect(received.route.operation).toBe('validate')
  })
})

describe('Workflow full write contract', () => {
  it('keeps defaults, aliases, nested extras and position coercion', async () => {
    const { parseWorkflowWrite } = await import('../netlify/functions/_shared/workflows/policy.ts')
    expect(parseWorkflowWrite({ name: ' Flow ', ignored: true, input_schema: { properties: {} },
      nodes: [{ id: 'start', type: 'trigger', position: { x: '1.5', y: true }, data: {}, extra: 1 }] }))
      .toEqual({ name: 'Flow', nodes: [{ id: 'start', type: 'trigger', position: { x: 1.5, y: 1 }, data: {} }],
        edges: [], input_schema: { properties: {} }, output_schema: { type: 'object', properties: {} } })
  })
  it.each([null, [], {}, { name: '' }, { name: 3 }, { name: 'x', nodes: null },
    { name: 'x', inputSchema: [] }, { name: 'x', edges: [{ id: 'x', source: 1, target: 'a' }] },
    { name: 'x', nodes: [{ id: 'x', type: 'trigger', data: {}, position: { x: 'Infinity' } }] }])(
    'rejects invalid requests without reflecting input %#', async value => {
      const { parseWorkflowWrite } = await import('../netlify/functions/_shared/workflows/policy.ts')
      expect(() => parseWorkflowWrite(value)).toThrow('Workflow 请求字段不符合要求')
    })
})

describe('Workflow structural validation', () => {
  it('accepts a connected trigger/end and rejects missing endpoints, cycles and bad mappings', async () => {
    const { structuralErrors } = await import('../netlify/functions/_shared/workflows/validation.ts')
    const nodes = [{ id: 's', type: 'trigger', data: {}, position: {} }, { id: 'e', type: 'end', data: {}, position: {} }]
    expect(structuralErrors(nodes, [{ id: 'edge', source: 's', target: 'e' }])).toEqual([])
    expect(structuralErrors(nodes, [{ id: 'bad', source: 's', target: 'missing' }])).toContain('连线 bad 引用了不存在的节点')
    expect(structuralErrors(nodes, [{ id: 'loop', source: 's', target: 's' }])).toContain('工作流不能包含有向环')
    expect(structuralErrors(nodes, [{ id: 'map', source: 's', target: 'e', data: { mappings: [{ sourcePath: '', targetPath: '$.x' }] } }])).not.toEqual([])
    expect(structuralErrors(nodes, [{ id: 'map', source: 's', target: 'e', data: { mappings: null } }])).toEqual(['连线 map 的映射必须是数组'])
  })
})
