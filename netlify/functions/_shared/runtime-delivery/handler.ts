import { createApiHandler, type BackendResult, type HandlerOptions, type RequestBackendInput } from '../identity-workspace/handler.ts'
import { resolveRuntimeDeliveryRoute, type RuntimeDeliveryRoute } from './routes.ts'

export type RuntimeDeliveryInput = RequestBackendInput<RuntimeDeliveryRoute>
/** Origin and CSRF protection is shared with the other native workspace domains. */
export function createRuntimeDeliveryHandler(backend: (input: RuntimeDeliveryInput) => Promise<BackendResult>, options: HandlerOptions = {}) {
  return createApiHandler(backend, resolveRuntimeDeliveryRoute, route => !['schedule-list','schedule-dispatches','channel-list','outbox-list'].includes(route.operation), options)
}
