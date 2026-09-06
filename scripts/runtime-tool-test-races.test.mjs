import test from 'node:test'
import assert from 'node:assert/strict'
import { toolTestFixture } from './runtime-tool-test-fixture.mjs'
import { processRuntimeOperation } from '../netlify/functions/_shared/runtime/service.ts'

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
async function blocked(pool,pid){
  const until=Date.now()+3000
  while(Date.now()<until){const rows=(await pool.query('SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[pid])).rows;if(rows.length)return rows[0].pid;await new Promise(done=>setTimeout(done,10))}
  throw Error('expected PostgreSQL lock contention not observed')
}
const deps=fetch=>({complete:async()=>{throw Error()},toolOptions:{allowedBindings:[{workspaceId:'a',host:'tools.example.invalid'}],fetch}})

for(const first of ['deactivate','intent'])test(`${first} locks first: independent Session deactivation and send intention have a committed ordering`,async()=>{
  const db=await toolTestFixture(),gate=await db.pool.connect(),sent=deferred(),finish=deferred()
  let work,deactivation
  try{
    await db.pool.query("UPDATE users SET is_organization_admin=true WHERE id='actor'")
    const independent=await db.login();assert.notEqual(independent.Cookie,db.headers.Cookie)
    const {operationId:id}=await (await db.submit()).json()
    const schema=(await gate.query('SELECT current_schema() schema,pg_backend_pid() pid')).rows[0]
    await gate.query('SELECT pg_advisory_lock(hashtext($1))',[schema.schema])
    await db.pool.query(`CREATE FUNCTION synthetic_tool_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext(current_schema())); RETURN NEW; END $$`)
    await db.pool.query(first==='intent'
      ? 'CREATE TRIGGER synthetic_tool_gate BEFORE INSERT ON runtime_effects FOR EACH ROW EXECUTE FUNCTION synthetic_tool_gate()'
      : 'CREATE TRIGGER synthetic_tool_gate BEFORE UPDATE ON tool_skill_assets FOR EACH ROW EXECUTE FUNCTION synthetic_tool_gate()')
    let calls=0
    const consume=()=>processRuntimeOperation(db.pool,id,deps(async()=>{calls++;sent.resolve();await finish.promise;return Response.json({ok:true})}))
    const deactivate=()=>db.request('asset-library/tool-a/deactivate','POST',{reason:'synthetic deactivation'},independent)
    if(first==='intent')work=consume();else deactivation=deactivate()
    const firstPid=await blocked(db.pool,schema.pid)
    if(first==='intent')deactivation=deactivate();else work=consume()
    await blocked(db.pool,firstPid)
    await gate.query('SELECT pg_advisory_unlock(hashtext($1))',[schema.schema])
    if(first==='intent')await sent.promise
    assert.equal((await deactivation).status,200)
    finish.resolve()
    const op=await work
    assert.equal(calls,first==='intent'?1:0)
    assert.equal(op.status,first==='intent'?'succeeded':'failed')
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM runtime_effects')).rows[0].n,first==='intent'?1:0)
  }finally{
    finish.resolve();await gate.query('SELECT pg_advisory_unlock_all()');await Promise.allSettled([work,deactivation]);gate.release();await db.close()
  }
})

test('cancel during an in-flight send retains unknown evidence; a late receipt cannot advance fenced business state',async()=>{
  const db=await toolTestFixture(),sent=deferred(),finish=deferred();let work
  try{
    const {operationId:id}=await (await db.submit()).json();let calls=0
    work=processRuntimeOperation(db.pool,id,deps(async()=>{calls++;sent.resolve();await finish.promise;return Response.json({private:'late-body'})}))
    await sent.promise
    const response=await db.request(`operations/${id}/cancel`,'POST',{reason:'stop while sent'})
    assert.equal(response.status,200);assert.equal((await response.json()).status,'needs_reconciliation')
    finish.resolve();await work
    assert.equal((await db.pool.query('SELECT status FROM tool_skill_asset_invocations')).rows[0].status,'needs_reconciliation')
    assert.equal((await db.pool.query('SELECT status FROM runtime_effects')).rows[0].status,'succeeded')
    await processRuntimeOperation(db.pool,id,deps(async()=>{calls++;return Response.json({})}));assert.equal(calls,1)
    await db.pool.query("UPDATE users SET is_organization_admin=true WHERE id='actor'")
    assert.equal((await db.request(`operations/${id}/reconcile`,'POST',{reason:'verified receipt',decision:'retry',acknowledgeDuplicateRisk:true})).status,200)
    await db.pool.query("UPDATE tool_skill_assets SET status='disabled' WHERE id='tool-a'")
    const resumed=await processRuntimeOperation(db.pool,id,{complete:async()=>{throw Error()},toolOptions:{allowedBindings:[],fetch:async()=>{calls++;throw Error()}}})
    assert.equal(resumed.status,'succeeded');assert.equal(calls,1)
    assert.equal(JSON.stringify(resumed.result).includes('late-body'),false)
  }finally{finish.resolve();await work;await db.close()}
})
