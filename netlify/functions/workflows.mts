import { getDatabase } from '@netlify/database'
import type { Context } from '@netlify/functions'
import type { SqlPool } from './_shared/identity-workspace/postgres.ts'
import { createWorkflowsHandler } from './_shared/workflows/handler.ts'
import { createPostgresWorkflowsBackend } from './_shared/workflows/postgres.ts'
import { resolveWorkflowRoute } from './_shared/workflows/routes.ts'

// Dormant until migration acceptance and an explicitly authorized cutover.
export default async (request: Request, context: Context): Promise<Response> => {
  if (!resolveWorkflowRoute(request.method, new URL(request.url).pathname)) {
    return Response.json({ detail: '接口不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  const backend = createPostgresWorkflowsBackend({
    async connect() { return getDatabase().pool.connect() as unknown as Awaited<ReturnType<SqlPool['connect']>> },
  })
  return createWorkflowsHandler(backend, { clientAddress: context.ip,
    allowedOrigins: (Netlify.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean),
  })(request)
}
