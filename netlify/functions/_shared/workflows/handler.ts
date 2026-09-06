import { createApiHandler, type BackendResult, type HandlerOptions, type RequestBackendInput } from '../identity-workspace/handler.ts'
import { resolveWorkflowRoute, type WorkflowRoute } from './routes.ts'

export type WorkflowsInput = RequestBackendInput<WorkflowRoute>
export type WorkflowsBackend = (input: WorkflowsInput) => Promise<BackendResult>

/** Preserve read-only validation POST semantics; mutations retain Origin/CSRF guards. */
export function createWorkflowsHandler(backend: WorkflowsBackend, options: HandlerOptions = {}) {
  return createApiHandler(backend, resolveWorkflowRoute,
    route => ['create', 'update', 'delete', 'publish'].includes(route.operation), options)
}
