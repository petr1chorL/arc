import { createApiHandler, type BackendResult, type HandlerOptions, type RequestBackendInput } from '../identity-workspace/handler.ts'
import { resolveAgentRoute, type AgentRoute } from './routes.ts'

export type AgentsInput = RequestBackendInput<AgentRoute>
export type AgentsBackend = (input: AgentsInput) => Promise<BackendResult>

/** Share request protections; authentication and capability checks remain in persistence. */
export function createAgentsHandler(backend: AgentsBackend, options: HandlerOptions = {}) {
  return createApiHandler(backend, resolveAgentRoute,
    route => ['create', 'update', 'publish', 'deactivate', 'activate'].includes(route.operation), options)
}
