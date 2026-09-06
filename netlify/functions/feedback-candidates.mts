import { getDatabase } from '@netlify/database'
import type { Context } from '@netlify/functions'
import type { SqlPool } from './_shared/identity-workspace/postgres.ts'
import { createFeedbackHandler } from './_shared/feedback-candidates/handler.ts'
import { createPostgresFeedbackBackend } from './_shared/feedback-candidates/postgres.ts'
import { resolveFeedbackRoute } from './_shared/feedback-candidates/routes.ts'

// Deliberately no public path config until migration acceptance and cutover.
export default async (request: Request, context: Context): Promise<Response> => {
  if (!resolveFeedbackRoute(request.method, new URL(request.url).pathname)) {
    return Response.json({ detail: '接口不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  const backend = createPostgresFeedbackBackend({
    async connect() {
      return getDatabase().pool.connect() as unknown as Awaited<ReturnType<SqlPool['connect']>>
    },
  })
  return createFeedbackHandler(backend, {
    clientAddress: context.ip,
    allowedOrigins: (Netlify.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean),
  })(request)
}
