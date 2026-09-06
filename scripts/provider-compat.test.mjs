// Synthetic loopback database only; never loads application credentials.
import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeTestDatabase } from './runtime-test-db.mjs'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { createReferenceAssetsHandler } from '../netlify/functions/_shared/reference-assets/handler.ts'
import { createPostgresReferenceAssetsBackend } from '../netlify/functions/_shared/reference-assets/postgres.ts'
import { createAgentsHandler } from '../netlify/functions/_shared/agents/handler.ts'
import { createPostgresAgentsBackend } from '../netlify/functions/_shared/agents/postgres.ts'

async function loginHeaders(pool) {
  const login=await createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))(new Request('https://synthetic.invalid/api/auth/login',
    {method:'POST',body:JSON.stringify({email:'actor@example.invalid',password:'Synthetic-only-test-123!'})}))
  assert.equal(login.status,200)
  const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  return {Cookie:cookie,'X-CSRF-Token':decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])}
}

async function fixture(options) {
  const db = await runtimeTestDatabase()
  try {
    await db.pool.query("INSERT INTO organizations VALUES('org','Synthetic','synthetic','active',now(),now())")
    for (const id of ['a','b']) await db.pool.query("INSERT INTO workspaces(id,organization_id,name,slug,status,created_at,updated_at) VALUES($1,'org',$1,$1,'active',now(),now())",[id])
    await db.pool.query(`INSERT INTO users(id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,failed_login_count,created_at,updated_at)
      VALUES('actor','org','actor@example.invalid','actor@example.invalid','Synthetic',$1,'active',false,0,now(),now())`,[await hashPassword('Synthetic-only-test-123!')])
    for (const id of ['a','b']) await db.pool.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status,created_at,updated_at) VALUES($1,$1,'actor','builder','active',now(),now())",[id])
    const login = await createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(db.pool))(new Request('https://synthetic.invalid/api/auth/login',{method:'POST',body:JSON.stringify({email:'actor@example.invalid',password:'Synthetic-only-test-123!'})}))
    assert.equal(login.status,200)
    const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
    const csrf=decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
    const handler=createReferenceAssetsHandler(createPostgresReferenceAssetsBackend(db.pool,options))
    const request=(suffix,body,headers={})=>handler(new Request(`https://synthetic.invalid/api/workspaces/a/model-providers/${suffix}`,{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}))
    for(const [id,workspace] of [['source','a'],['target','a'],['foreign','b']]) await db.pool.query(`INSERT INTO model_providers VALUES($1,$2,$1,'openai-compatible','https://models.example.invalid/v1',$1,'SYNTHETIC_PROVIDER_KEY','draft','actor',now(),now())`,[id,workspace])
    return {...db,request,headers:{Cookie:cookie,'X-CSRF-Token':csrf}}
  }catch(error){await db.close();throw error}
}

test('provider configuration check defaults to missing_secret without reading secrets',async()=>{
  const db=await fixture()
  try{
    const response=await db.request('source/test')
    assert.equal(response.status,200)
    assert.deepEqual(await response.json(),{providerId:'source',status:'missing_secret',message:'密钥引用 SYNTHETIC_PROVIDER_KEY 未在后端环境变量中配置'})
  }finally{await db.close()}
})

function signal() {
  let resolve
  const promise=new Promise(done=>{resolve=done})
  return {resolve,async wait(){
    let timer
    try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Synthetic concurrency barrier timed out')),3000)})])}
    finally{clearTimeout(timer)}
  }}
}

// Observes real SQL boundaries without replacing database reads/writes or row locks.
function observedPool(pool,{started,after}={}) {
  return {async connect(){
    const client=await pool.connect()
    return {async query(sql,values){const pending=client.query(sql,values);await started?.(sql,client.processID);const result=await pending;await after?.(sql);return result},release(){client.release()}}
  }}
}
const send=(handler,path,headers,body)=>handler(new Request(`https://synthetic.invalid/api/workspaces/a/${path}`,
  {method:'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}))

test('different Sessions concurrently hold Provider locks before contending for editable Agent rows',async()=>{
  const db=await fixture()
  try{
    await seedAgents(db)
    const second=await loginHeaders(db.pool)
    assert.notEqual(db.headers.Cookie,second.Cookie)
    const both=signal();let arrivals=0
    const observed=observedPool(db.pool,{async after(sql){
      if(sql.startsWith('SELECT * FROM model_providers') && sql.endsWith('FOR SHARE')) {
        if(++arrivals===2)both.resolve()
        await both.wait()
      }
    }})
    const handler=createReferenceAssetsHandler(createPostgresReferenceAssetsBackend(observed))
    const responses=await Promise.all([db.headers,second].map(headers=>send(handler,'model-providers/source/migrate-drafts',headers,{targetProviderId:'target',reason:'independent session'})))
    assert.equal(arrivals,2)
    assert.deepEqual(responses.map(r=>r.status),[200,200])
    assert.deepEqual((await Promise.all(responses.map(r=>r.json()))).map(r=>r.migratedCount).sort(),[0,1])
    assert.equal((await db.pool.query("SELECT model_provider_id FROM agents WHERE id='agent-a'")).rows[0].model_provider_id,'target')
  }finally{await db.close()}
})

test('independent Session publish and migration serialize at the Agent lock in either order',async()=>{
  for(const first of ['publish','migration']) {
    const db=await fixture()
    const releaseHolder=signal()
    try{
      await seedAgents(db)
      const second=await loginHeaders(db.pool)
      assert.notEqual(db.headers.Cookie,second.Cookie)
      const holderLocked=signal(),contenderStarted=signal()
      let providerShared=false,contenderPid
      const publishPool=observedPool(db.pool,{
        started(sql,pid){if(first==='migration' && sql.startsWith('SELECT * FROM agents') && sql.endsWith('FOR UPDATE')){contenderPid=pid;contenderStarted.resolve()}},
        async after(sql){if(first==='publish' && sql.startsWith('SELECT * FROM agents') && sql.endsWith('FOR UPDATE')){holderLocked.resolve();await releaseHolder.wait()}},
      })
      const migrationPool=observedPool(db.pool,{
        started(sql,pid){if(first==='publish' && sql.startsWith('SELECT id,name,model FROM agents')){assert.equal(providerShared,true);contenderPid=pid;contenderStarted.resolve()}},
        async after(sql){
          if(sql.startsWith('SELECT * FROM model_providers') && sql.endsWith('FOR SHARE'))providerShared=true
          if(first==='migration' && sql.startsWith('SELECT id,name,model FROM agents')){holderLocked.resolve();await releaseHolder.wait()}
        },
      })
      const publish=()=>send(createAgentsHandler(createPostgresAgentsBackend(publishPool)),'agents/agent-a/publish',db.headers,{note:'race'})
      const migrate=()=>send(createReferenceAssetsHandler(createPostgresReferenceAssetsBackend(migrationPool)),
        'model-providers/source/migrate-drafts',second,{targetProviderId:'target',reason:'race'})
      const leading=first==='publish'?publish():migrate()
      await holderLocked.wait()
      const trailing=first==='publish'?migrate():publish()
      await contenderStarted.wait()
      let blockers=[]
      for(let attempt=0;attempt<50;attempt++) {
        blockers=(await db.pool.query('SELECT pg_blocking_pids($1) AS blockers',[contenderPid])).rows[0].blockers
        if(blockers.length)break
        await new Promise(resolve=>setTimeout(resolve,10))
      }
      assert.ok(blockers.length,'PostgreSQL confirms contender is waiting on the held Agent lock')
      releaseHolder.resolve()
      const results=await Promise.all([leading,trailing])
      assert.deepEqual(results.map(r=>r.status).sort(),[200,201])
      const version=(await db.pool.query("SELECT snapshot FROM agent_versions WHERE note='race'")).rows[0].snapshot
      assert.equal(version.modelProviderId,first==='publish'?'source':'target')
      assert.equal(version.model,first==='publish'?'source':'target')
      assert.deepEqual((await db.pool.query("SELECT snapshot FROM agent_versions WHERE id='version-a'")).rows[0].snapshot,
        {id:'agent-a',modelProviderId:'source',model:'old-model'})
      const row=(await db.pool.query("SELECT model_provider_id,model FROM agents WHERE id='agent-a'")).rows[0]
      assert.deepEqual(row,{model_provider_id:'target',model:'target'})
      const audits=(await db.pool.query("SELECT action FROM audit_events WHERE outcome='success' AND action IN ('agent.publish','model_provider.migrate_drafts')")).rows
      assert.equal(audits.length,2)
    }finally{releaseHolder.resolve();await db.close()}
  }
})

async function seedAgents(db) {
  for(const workspace of ['a','b']) {
    await db.pool.query(`INSERT INTO agents
      (id,workspace_id,name,role,owner,model,model_provider_id,model_provider,model_base_url,temperature,
       max_output_tokens,status,version,pass_rate,runs,tools,skills,tool_asset_refs,skill_asset_refs,
       system_prompt,runtime_manifest,created_at,updated_at)
      VALUES($1,$2,'Synthetic agent','','','old-model','source','openai-compatible','',0,100,'published','v1',0,0,
       '[]','[]','[]','[]','','{}',now(),now())`,[`agent-${workspace}`,workspace])
    await db.pool.query(`INSERT INTO agent_versions VALUES($1,$2,$3,'v1',$4,'',now())`,
      [`version-${workspace}`,workspace,`agent-${workspace}`,{id:`agent-${workspace}`,modelProviderId:'source',model:'old-model'}])
  }
}

test('draft migration updates editable records atomically, not immutable versions or another Workspace',async()=>{
  const db=await fixture()
  try{
    await seedAgents(db)
    const response=await db.request('source/migrate-drafts',{targetProviderId:'target',reason:' rotate '})
    assert.equal(response.status,200)
    assert.deepEqual(await response.json(),{sourceProviderId:'source',targetProviderId:'target',migratedCount:1,
      migratedAgents:[{agentId:'agent-a',agentName:'Synthetic agent',previousModel:'old-model',nextModel:'target'}]})
    assert.deepEqual((await db.pool.query('SELECT model_provider_id,model FROM agents ORDER BY id')).rows,
      [{model_provider_id:'target',model:'target'},{model_provider_id:'source',model:'old-model'}])
    assert.deepEqual((await db.pool.query('SELECT snapshot FROM agent_versions ORDER BY id')).rows.map(r=>r.snapshot.modelProviderId),['source','source'])
    const audit=(await db.pool.query("SELECT metadata FROM audit_events WHERE action='model_provider.migrate_drafts'")).rows[0]
    assert.deepEqual(audit.metadata,{sourceProviderId:'source',targetProviderId:'target',reason:'rotate',migratedAgentIds:['agent-a']})
    assert.equal((await (await db.request('source/migrate-drafts',{target_provider_id:'target',reason:'repeat'})).json()).migratedCount,0)
  }finally{await db.close()}
})

test('presence port is scoped, authorized and never exposes resolver values or failures',async()=>{
  const calls=[]
  const db=await fixture({secretPresence:binding=>{calls.push(binding);return true}})
  try{
    assert.equal((await db.request('source/test',undefined,{'X-CSRF-Token':''})).status,403)
    assert.equal((await db.request('source/test',undefined,{Origin:'https://foreign.invalid'})).status,403)
    assert.equal((await db.request('source/test',undefined,{Cookie:''})).status,401)
    assert.equal((await db.request('foreign/test')).status,404)
    await db.pool.query("UPDATE workspace_memberships SET role='viewer' WHERE id='a'")
    assert.equal((await db.request('source/test')).status,403)
    assert.equal(calls.length,0)
    await db.pool.query("UPDATE workspace_memberships SET role='builder' WHERE id='a'")
    assert.deepEqual(await (await db.request('source/test')).json(),{providerId:'source',status:'ready',message:'模型 Provider 配置完整，密钥引用已在后端环境变量中解析'})
    assert.deepEqual(calls,[{workspaceId:'a',providerId:'source',secretRef:'SYNTHETIC_PROVIDER_KEY',baseUrl:'https://models.example.invalid/v1'}])
    await db.pool.query("UPDATE model_providers SET secret_ref='synthetic-raw-marker' WHERE id='source'")
    const unsafe=await db.request('source/test')
    assert.equal(unsafe.status,409);assert.equal((await unsafe.text()).includes('synthetic-raw-marker'),false)
    assert.equal(calls.length,1)
  }finally{await db.close()}
  const failing=await fixture({secretPresence:()=>{throw new Error('synthetic-resolver-value')}})
  try{
    const response=await failing.request('source/test')
    assert.equal(response.status,503);assert.equal((await response.text()).includes('synthetic-resolver-value'),false)
  }finally{await failing.close()}
})

test('migration rejects invalid targets and permissions; audit failure rolls back all edits',async()=>{
  const db=await fixture()
  try{
    await seedAgents(db)
    const payload={targetProviderId:'target',reason:'rotate'}
    for(const body of [{...payload,reason:' '},{...payload,reason:'x'.repeat(1001)},
      {...payload,extra:true},{...payload,targetProviderId:'source'},{...payload,targetProviderId:''},
      {...payload,target_provider_id:'target'}]) assert.equal((await db.request('source/migrate-drafts',body)).status,422)
    assert.equal((await db.request('source/migrate-drafts',{...payload,targetProviderId:'foreign'})).status,404)
    assert.equal((await db.request('foreign/migrate-drafts',payload)).status,404)
    assert.equal((await db.request('source/migrate-drafts',payload,{'X-CSRF-Token':''})).status,403)
    await db.pool.query("UPDATE workspace_memberships SET role='viewer' WHERE id='a'")
    assert.equal((await db.request('source/migrate-drafts',payload)).status,403)
    await db.pool.query("UPDATE workspace_memberships SET role='builder' WHERE id='a'")
    await db.pool.query("UPDATE model_providers SET status='disabled' WHERE id='target'")
    assert.equal((await db.request('source/migrate-drafts',payload)).status,422)
    await db.pool.query("UPDATE model_providers SET status='draft' WHERE id='target'")
    await db.pool.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_migration_audit CHECK(action<>'model_provider.migrate_drafts') NOT VALID")
    assert.equal((await db.request('source/migrate-drafts',payload)).status,503)
    assert.equal((await db.pool.query("SELECT model_provider_id FROM agents WHERE id='agent-a'")).rows[0].model_provider_id,'source')
    await db.pool.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_migration_audit')
    await db.pool.query("UPDATE model_providers SET status='disabled' WHERE id='source'")
    const concurrent=await Promise.all([db.request('source/migrate-drafts',payload),db.request('source/migrate-drafts',payload)])
    assert.deepEqual((await Promise.all(concurrent.map(r=>r.json()))).map(r=>r.migratedCount).sort(),[0,1])
  }finally{await db.close()}
})

test('migration preserves Python strip semantics for NEL/control separators and BOM',async()=>{
  const db=await fixture()
  try{
    for(const whitespace of ['\u0085','\u001c','\u001d\u001e\u001f']) {
      assert.equal((await db.request('source/migrate-drafts',{targetProviderId:'target',reason:whitespace})).status,422)
      assert.equal((await db.request('source/migrate-drafts',{targetProviderId:whitespace,reason:'reason'})).status,422)
      const result=await db.request('source/migrate-drafts',{targetProviderId:`${whitespace}target${whitespace}`,reason:`${whitespace}reason${whitespace}`})
      assert.equal(result.status,200)
    }
    assert.equal((await db.request('source/migrate-drafts',{targetProviderId:'target',reason:'\ufeff'})).status,200)
    assert.equal((await db.request('source/migrate-drafts',{targetProviderId:'\ufefftarget\ufeff',reason:'reason'})).status,404)
    const reasons=(await db.pool.query("SELECT metadata->>'reason' AS reason FROM audit_events WHERE action='model_provider.migrate_drafts' ORDER BY created_at")).rows.map(row=>row.reason)
    assert.deepEqual(reasons,['reason','reason','reason','\ufeff'])
  }finally{await db.close()}
})
