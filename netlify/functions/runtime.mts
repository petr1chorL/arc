// Deliberately hard-dormant until a separately authorized database and API cutover.
// The tested implementation is _shared/runtime/router.ts; no config.path is registered here.
export default async (_request: Request): Promise<Response> => {
  return Response.json({ detail: '原生运行服务尚未切流' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}
