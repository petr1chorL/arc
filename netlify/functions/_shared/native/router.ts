import { createIdentityWorkspaceHandler, type HandlerOptions } from '../identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend, type SqlPool } from '../identity-workspace/postgres.ts'
import { resolveIdentityWorkspaceRoute } from '../identity-workspace/routes.ts'
import { createReferenceAssetsHandler } from '../reference-assets/handler.ts'
import { createPostgresReferenceAssetsBackend } from '../reference-assets/postgres.ts'
import { resolveReferenceAssetRoute } from '../reference-assets/routes.ts'
import { createAgentsHandler } from '../agents/handler.ts'
import { createPostgresAgentsBackend } from '../agents/postgres.ts'
import { resolveAgentRoute } from '../agents/routes.ts'
import { createDataObjectsHandler } from '../data-objects/handler.ts'
import { createPostgresDataObjectsBackend } from '../data-objects/postgres.ts'
import { resolveDataObjectRoute } from '../data-objects/routes.ts'
import { createRubricsHandler } from '../rubrics/handler.ts'
import { createPostgresRubricsBackend } from '../rubrics/postgres.ts'
import { resolveRubricRoute } from '../rubrics/routes.ts'
import { createFeedbackHandler } from '../feedback-candidates/handler.ts'
import { createPostgresFeedbackBackend } from '../feedback-candidates/postgres.ts'
import { resolveFeedbackRoute } from '../feedback-candidates/routes.ts'
import { createWorkflowsHandler } from '../workflows/handler.ts'
import { createPostgresWorkflowsBackend } from '../workflows/postgres.ts'
import { resolveWorkflowRoute } from '../workflows/routes.ts'
import { createRuntimeHandler, resolveRuntimeRoute } from '../runtime/handler.ts'
import { createPostgresRuntimeBackend } from '../runtime/postgres.ts'
import { createRuntimeClosureHandler, resolveRuntimeClosureRoute } from '../runtime-closure/handler.ts'
import { createPostgresRuntimeClosureBackend } from '../runtime-closure/postgres.ts'
import { createRuntimeDeliveryHandler } from '../runtime-delivery/handler.ts'
import { createPostgresRuntimeDeliveryBackend } from '../runtime-delivery/postgres.ts'
import { resolveRuntimeDeliveryRoute } from '../runtime-delivery/routes.ts'

/** Compose existing authenticated domains without seed data, transport adapters or platform globals. */
export function createNativeApiRouter(pool: SqlPool, options: HandlerOptions) {
  const domains = [
    { resolve: resolveIdentityWorkspaceRoute, handle: createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool), options) },
    { resolve: resolveRuntimeRoute, handle: createRuntimeHandler(createPostgresRuntimeBackend(pool), options) },
    { resolve: resolveRuntimeClosureRoute, handle: createRuntimeClosureHandler(createPostgresRuntimeClosureBackend(pool), options) },
    { resolve: resolveRuntimeDeliveryRoute, handle: createRuntimeDeliveryHandler(createPostgresRuntimeDeliveryBackend(pool), options) },
    { resolve: resolveReferenceAssetRoute, handle: createReferenceAssetsHandler(createPostgresReferenceAssetsBackend(pool), options) },
    { resolve: resolveAgentRoute, handle: createAgentsHandler(createPostgresAgentsBackend(pool), options) },
    { resolve: resolveDataObjectRoute, handle: createDataObjectsHandler(createPostgresDataObjectsBackend(pool), options) },
    { resolve: resolveRubricRoute, handle: createRubricsHandler(createPostgresRubricsBackend(pool), options) },
    { resolve: resolveFeedbackRoute, handle: createFeedbackHandler(createPostgresFeedbackBackend(pool), options) },
    { resolve: resolveWorkflowRoute, handle: createWorkflowsHandler(createPostgresWorkflowsBackend(pool), options) },
  ]
  return async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname
      const domain = domains.find(candidate => candidate.resolve(request.method, path))
      if (domain) return domain.handle(request)
      return Response.json({ detail: '接口不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (!(error instanceof URIError)) throw error
      return Response.json({ detail: '接口路径无效' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    }
  }
}
