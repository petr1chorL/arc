// Shared synthetic fixture, no test registration or production configuration.
import assert from 'node:assert/strict'
import { runtimeTestDatabase } from './runtime-test-db.mjs'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { createReferenceAssetsHandler } from '../netlify/functions/_shared/reference-assets/handler.ts'
import { createPostgresReferenceAssetsBackend } from '../netlify/functions/_shared/reference-assets/postgres.ts'
import { createRuntimeHandler } from '../netlify/functions/_shared/runtime/handler.ts'
import { createPostgresRuntimeBackend } from '../netlify/functions/_shared/runtime/postgres.ts'

export async function toolTestFixture() {
  const db=await runtimeTestDatabase()
  try{
    await db.pool.query("INSERT INTO organizations VALUES('org','Synthetic','synthetic','active',now(),now())")
    for(const id of ['a','b'])await db.pool.query("INSERT INTO workspaces(id,organization_id,name,slug,status,created_at,updated_at) VALUES($1,'org',$1,$1,'active',now(),now())",[id])
    await db.pool.query(`INSERT INTO users(id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,failed_login_count,created_at,updated_at)
      VALUES('actor','org','actor@example.invalid','actor@example.invalid','Synthetic',$1,'active',false,0,now(),now())`,[await hashPassword('Synthetic-only-test-123!')])
    for(const id of ['a','b'])await db.pool.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status,created_at,updated_at) VALUES($1,$1,'actor','builder','active',now(),now())",[id])
    for(const id of ['a','b'])await db.pool.query(`INSERT INTO tool_skill_assets(id,workspace_id,asset_type,name,description,parameter_schema,adapter_type,adapter_config,status,created_by,created_at,updated_at)
      VALUES($1,$2,'tool','Synthetic Tool','','{}','http',$3,'active','actor',now(),now())`,[`tool-${id}`,id,{url:'https://tools.example.invalid/lookup',method:'POST'}])
    const login=async()=>{
      const response=await createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(db.pool))(new Request('https://synthetic.invalid/api/auth/login',
        {method:'POST',body:JSON.stringify({email:'actor@example.invalid',password:'Synthetic-only-test-123!'})}))
      assert.equal(response.status,200)
      const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
      return {Cookie:cookie,'X-CSRF-Token':decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])}
    }
    const headers=await login()
    const assets=createReferenceAssetsHandler(createPostgresReferenceAssetsBackend(db.pool))
    const runtime=createRuntimeHandler(createPostgresRuntimeBackend(db.pool))
    const request=(path,method='GET',body,extra={},handler=path.startsWith('asset-library/')?assets:runtime)=>handler(new Request(`https://synthetic.invalid/api/workspaces/a/${path}`,
      {method,headers:{...headers,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}))
    const submit=(key='test',parameters={sku:'A001'})=>request('asset-library/tool-a/test-invocations','POST',{parameters},{'Idempotency-Key':key})
    return {...db,login,headers,request,submit}
  }catch(error){await db.close();throw error}
}
