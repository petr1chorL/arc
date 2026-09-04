export type DatabaseCheck = () => Promise<void>

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

export function createPlatformHealthHandler(checkDatabase: DatabaseCheck) {
  return async (_request: Request): Promise<Response> => {
    try {
      await checkDatabase()
      return Response.json(
        { status: 'ok', database: 'ready' },
        { status: 200, headers: responseHeaders },
      )
    } catch {
      return Response.json(
        { status: 'unavailable', database: 'unavailable' },
        { status: 503, headers: responseHeaders },
      )
    }
  }
}
