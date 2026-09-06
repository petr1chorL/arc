import type { AsyncWorkloadConfig } from '@netlify/async-workloads'
// An eventFilter or config.status alone is not a verified off switch in SDK 0.0.106.
export default async (_request: Request): Promise<Response> => {
  return Response.json({ detail: '原生工作负载尚未启用' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}
export const asyncWorkloadConfig: AsyncWorkloadConfig = { events: [], maxRetries: 4 }
