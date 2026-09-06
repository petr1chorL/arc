import { getDatabase } from '@netlify/database'
import type { Context } from '@netlify/functions'
import type { SqlPool } from './_shared/identity-workspace/postgres.ts'
import { createAgentsHandler } from './_shared/agents/handler.ts'
import { createPostgresAgentsBackend } from './_shared/agents/postgres.ts'
import { resolveAgentRoute } from './_shared/agents/routes.ts'

// No public path config: production continues to use the existing routing.
export default async (request: Request, context: Context): Promise<Response> => {
  if (!resolveAgentRoute(request.method, new URL(request.url).pathname)) {
    return Response.json({ detail: '接口不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  const backend = createPostgresAgentsBackend({
    async connect() {
      return getDatabase().pool.connect() as unknown as Awaited<ReturnType<SqlPool['connect']>>
    },
  })
  return createAgentsHandler(backend, {
    clientAddress: context.ip,
    allowedOrigins: (Netlify.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean),
  })(request)
}
