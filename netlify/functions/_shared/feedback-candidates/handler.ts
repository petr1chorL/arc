import { createApiHandler, type BackendResult, type HandlerOptions, type RequestBackendInput } from '../identity-workspace/handler.ts'
import { resolveFeedbackRoute, type FeedbackRoute } from './routes.ts'

export type FeedbackInput = RequestBackendInput<FeedbackRoute>
export type FeedbackBackend = (input: FeedbackInput) => Promise<BackendResult>

/** Reuse HTTP protection; active membership and expert qualification remain persistence responsibilities. */
export function createFeedbackHandler(backend: FeedbackBackend, options: HandlerOptions = {}) {
  return createApiHandler(backend, resolveFeedbackRoute, route => route.operation === 'confirm', options)
}
