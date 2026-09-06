import {createApiHandler,type HandlerOptions,type RequestBackendInput,type BackendResult} from '../identity-workspace/handler.ts'
export type ClosureRoute={operation:string;write:boolean;params:{workspaceId:string;id?:string}}
export type ClosureInput=RequestBackendInput<ClosureRoute>
/** Explicit route inventory; legacy review decisions cannot bypass HumanTask. */
export function resolveRuntimeClosureRoute(method:string,path:string):ClosureRoute|null {
 const m=/^\/api\/workspaces\/([^/]+)\/(.+)$/.exec(path);if(!m)return null
 let ws:string;try{ws=decodeURIComponent(m[1])}catch{return null}if(invalidSegment(ws))return null
 const routes:[string,RegExp,string][]=[
 ['GET',/^evaluations\/sample-sets$/,'samples.list'],['POST',/^evaluations\/sample-sets$/,'samples.create'],['POST',/^evaluations\/sample-sets\/([^/]+)\/samples$/,'samples.add'],
 ['GET',/^human-tasks$/,'human.list'],['GET',/^human-tasks\/([^/]+)$/,'human.detail'],['POST',/^human-tasks\/([^/]+)\/(claim|transfer|decisions|retry-resume)$/,'human.mutate'],
 ['GET',/^reviews$/,'reviews.list'],['POST',/^reviews\/([^/]+)\/decision$/,'reviews.blocked'],
 ['GET',/^evaluations\/records$/,'evaluation.list'],['GET',/^evaluations\/overview$/,'evaluation.overview'],['POST',/^evaluations\/rubrics\/([^/]+)\/evaluate$/,'evaluation.create'],
 ['GET',/^evaluations\/regression-runs$/,'regression.list'],['POST',/^evaluations\/regression-runs$/,'regression.create'],['GET',/^evaluations\/regression-runs\/([^/]+)$/,'regression.detail'],
 ['GET',/^evaluations\/remediation-tasks$/,'remediation.list'],['POST',/^evaluations\/remediation-tasks$/,'remediation.create'],['GET',/^evaluations\/remediation-tasks\/([^/]+)$/,'remediation.detail'],['PATCH',/^evaluations\/remediation-tasks\/([^/]+)$/,'remediation.update'],['POST',/^evaluations\/remediation-tasks\/([^/]+)\/(activities|retest)$/,'remediation.action'],
 ['GET',/^artifacts$/,'artifacts.list'],['GET',/^observability\/(overview|human-sla|cost-usage|execution-events)$/,'observability.read'],['GET',/^observability\/runs\/([^/]+)$/,'observability.run'],
 ]
 for(const [verb,pattern,operation] of routes){const match=pattern.exec(m[2]);if(method.toUpperCase()!==verb||!match)continue;let id=match[1];try{if(id)id=decodeURIComponent(id)}catch{return null}if(id&&invalidSegment(id))return null;return{operation:match[2]?`${operation}.${match[2]}`:operation,write:verb!=='GET',params:{workspaceId:ws,...(id?{id}:{})}}}
 return null
}
function invalidSegment(v:string){return !v||Array.from(v).some(c=>c==='/'||c==='\\'||c.charCodeAt(0)<32||c.charCodeAt(0)===127)}
export function createRuntimeClosureHandler(backend:(input:ClosureInput)=>Promise<BackendResult>,options:HandlerOptions={}) {return createApiHandler(backend,resolveRuntimeClosureRoute,r=>r.write,options)}
