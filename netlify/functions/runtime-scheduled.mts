// No schedule registration before the production cutover. Shared tick logic is independently testable.
export default async (_request: Request): Promise<Response> => {
  return Response.json({ detail: '原生调度尚未启用' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}
