import type { SqlPool } from '../identity-workspace/postgres.ts'
import type { HandlerOptions } from '../identity-workspace/handler.ts'
import {createRuntimeHandler,resolveRuntimeRoute} from './handler.ts'
import {createPostgresRuntimeBackend} from './postgres.ts'
import {createRuntimeClosureHandler,resolveRuntimeClosureRoute} from '../runtime-closure/handler.ts'
import {createPostgresRuntimeClosureBackend} from '../runtime-closure/postgres.ts'
import {createRuntimeDeliveryHandler} from '../runtime-delivery/handler.ts'
import {resolveRuntimeDeliveryRoute} from '../runtime-delivery/routes.ts'
import {createPostgresRuntimeDeliveryBackend} from '../runtime-delivery/postgres.ts'

/** Explicit domain routing for local verification and a later separately authorized cutover. */
export function createNativeRuntimeRouter(pool:SqlPool,options:HandlerOptions={}) {
  const runtime=createRuntimeHandler(createPostgresRuntimeBackend(pool),options)
  const closure=createRuntimeClosureHandler(createPostgresRuntimeClosureBackend(pool),options)
  const delivery=createRuntimeDeliveryHandler(createPostgresRuntimeDeliveryBackend(pool),options)
  return (request:Request)=>{
    const path=new URL(request.url).pathname,method=request.method
    if(resolveRuntimeRoute(method,path))return runtime(request)
    if(resolveRuntimeClosureRoute(method,path))return closure(request)
    if(resolveRuntimeDeliveryRoute(method,path))return delivery(request)
    return Promise.resolve(Response.json({detail:'接口不存在'},{status:404,headers:{'Cache-Control':'no-store'}}))
  }
}
