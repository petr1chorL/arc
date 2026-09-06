import { createApiHandler, type BackendResult, type HandlerOptions, type RequestBackendInput } from '../identity-workspace/handler.ts'
import { resolveDataObjectRoute, type DataObjectRoute } from './routes.ts'

export type DataObjectsInput = RequestBackendInput<DataObjectRoute>
export type DataObjectsBackend = (input: DataObjectsInput) => Promise<BackendResult>

/** Reuse HTTP protections; session/CSRF authorization remains in the backend. */
export function createDataObjectsHandler(backend: DataObjectsBackend, options: HandlerOptions = {}) {
  return createApiHandler(backend, resolveDataObjectRoute,
    route => ['create', 'update', 'publish'].includes(route.operation), options)
}
