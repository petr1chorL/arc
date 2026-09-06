import { createApiHandler, type RequestBackendInput, type HandlerOptions, type BackendResult } from '../identity-workspace/handler.ts'
export type RuntimeRoute = { operation: string; params: Record<string, string | undefined> }
export type RuntimeInput = RequestBackendInput<RuntimeRoute>
export function resolveRuntimeRoute(method: string, path: string): RuntimeRoute | null {
  const match = /^\/api\/workspaces\/([^/]+)\/(.+)$/.exec(path)
  if (!match) return null
  const routes: [string, RegExp, string, string[]][] = [
    ['GET', /^operations$/, 'operations.list', []], ['GET', /^operations\/([^/]+)$/, 'operations.get', ['id']],
    ['POST', /^operations\/([^/]+)\/(cancel|requeue|reconcile)$/, 'operations.control', ['id','action']],
    ['POST', /^workflows\/([^/]+)\/runs$/, 'workflow.submit', ['workflowId']],
    ['POST', /^agents\/([^/]+)\/test-runs$/, 'agent.submit', ['agentId']],
    ['GET', /^runs$/, 'runs.list', []], ['GET', /^runs\/([^/]+)$/, 'runs.get', ['id']],
    ['DELETE', /^runs\/([^/]+)$/, 'runs.delete', ['id']],
    ['GET', /^runs\/([^/]+)\/operation-history$/, 'runs.history', ['id']],
    ['POST', /^runs\/([^/]+)\/(rerun|resume-from-failed-node)$/, 'runs.control', ['id','action']],
    ['POST', /^runs\/(batch-rerun|batch-resume-from-failed-node)$/, 'runs.batch', ['action']],
    ['GET', /^execution-jobs$/, 'jobs.list', []], ['GET', /^execution-jobs\/([^/]+)$/, 'jobs.get', ['id']],
    ['POST', /^execution-jobs\/next$/, 'jobs.next', []],
    ['POST', /^execution-jobs\/([^/]+)\/(cancel|requeue|heartbeat)$/, 'jobs.control', ['id','action']],
  ]
  for (const [verb, pattern, operation, fields] of routes) {
    const found = verb === method && pattern.exec(match[2])
    if (!found) continue
    try { return { operation, params: { workspaceId: decodeURIComponent(match[1]), ...Object.fromEntries(fields.map((field, i) => [field, decodeURIComponent(found[i + 1])])) } } }
    catch { return null }
  }
  return null
}
export function createRuntimeHandler(backend: (input: RuntimeInput) => Promise<BackendResult>, options: HandlerOptions = {}) {
  return createApiHandler(backend, resolveRuntimeRoute, route => !['operations.list','operations.get','runs.list','runs.get','runs.history','jobs.list','jobs.get'].includes(route.operation), options)
}
