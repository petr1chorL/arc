import type {SqlClient,SqlPool} from '../identity-workspace/postgres.ts'
export type Row = Record<string, unknown>
export type EnqueueInput = {workspaceId:string;kind:string;idempotencyKey:string;input:Record<string,unknown>;targetId?:string;actorId?:string}
export type ClosureDeps = {enqueue:(client:SqlClient,input:EnqueueInput)=>Promise<Row>}
export type EffectContext = {pool:SqlPool;effect:(key:string,input:unknown,send:()=>Promise<unknown>)=>Promise<unknown>}
export async function transaction<T>(pool:SqlPool,fn:(c:SqlClient)=>Promise<T>):Promise<T> { const c=await pool.connect();try {await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()} }
