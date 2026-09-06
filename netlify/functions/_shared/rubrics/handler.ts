import { createApiHandler, type BackendResult, type HandlerOptions, type RequestBackendInput } from '../identity-workspace/handler.ts'
import { resolveRubricRoute, type RubricRoute } from './routes.ts'

export type RubricsInput = RequestBackendInput<RubricRoute>
export type RubricsBackend = (input: RubricsInput) => Promise<BackendResult>

/** Reuse HTTP protections; the persistence backend must still validate session, CSRF and capabilities. */
export function createRubricsHandler(backend: RubricsBackend, options: HandlerOptions = {}) {
  return createApiHandler(backend, resolveRubricRoute,
    route => ['create', 'update', 'publish', 'deactivate'].includes(route.operation), options)
}
