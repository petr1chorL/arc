import { describe, expect, it } from 'vitest'
import { resolveAuthRedirectPath } from './authNavigation'
const workspace = { id:'ws',name:'WS',slug:'workspace' }
describe('durable task auth redirect', () => {
  it('preserves the operation query through login', () => {
    expect(resolveAuthRedirectPath(workspace, '/w/workspace/runs', '?operationId=op-1')).toBe('/w/workspace/runs?operationId=op-1')
  })
  it('does not follow protocol-relative or backslash destinations', () => {
    expect(resolveAuthRedirectPath(workspace, '//other.example', '?operationId=op-1')).toBe('/w/workspace')
    expect(resolveAuthRedirectPath(workspace, '/\\other.example')).toBe('/w/workspace')
  })
})
