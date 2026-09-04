import type { Context } from '@netlify/functions'


type RehearsalContext = Pick<Context, 'deploy'>
type ReportLoader = () => Promise<unknown>

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

export function createSchemaRehearsalHandler(loadReport: ReportLoader) {
  return async (request: Request, context: RehearsalContext): Promise<Response> => {
    if (context.deploy.context !== 'deploy-preview') {
      return Response.json(
        { status: 'not-found' },
        { status: 404, headers: responseHeaders },
      )
    }
    if (request.method !== 'GET') {
      return Response.json(
        { status: 'method-not-allowed' },
        { status: 405, headers: { ...responseHeaders, Allow: 'GET' } },
      )
    }

    try {
      return Response.json(
        await loadReport(),
        { status: 200, headers: responseHeaders },
      )
    } catch {
      return Response.json(
        { status: 'unavailable' },
        { status: 503, headers: responseHeaders },
      )
    }
  }
}
