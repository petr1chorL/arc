import {
  createApiHandler,
  type BackendResult,
  type HandlerOptions,
  type RequestBackendInput,
} from '../identity-workspace/handler.ts'
import { resolveReferenceAssetRoute, type ReferenceAssetRoute } from './routes.ts'

export type ReferenceAssetsInput = RequestBackendInput<ReferenceAssetRoute>
export type ReferenceAssetsBackend = (input: ReferenceAssetsInput) => Promise<BackendResult>

/** Reuse identity request parsing, cookies, size limits and fixed error responses. */
export function createReferenceAssetsHandler(backend: ReferenceAssetsBackend, options: HandlerOptions = {}) {
  return createApiHandler(backend, resolveReferenceAssetRoute,
    route => ['create', 'update', 'deactivate'].includes(route.operation), options)
}
