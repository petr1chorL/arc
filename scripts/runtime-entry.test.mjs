import test from 'node:test'
import assert from 'node:assert/strict'
test('disabled entries never read business configuration or secrets; SDK metadata is explicitly bounded', async () => {
  const reads=[]
  Object.defineProperty(globalThis,'Netlify',{configurable:true,value:{env:{get(name){
    reads.push(name);assert.ok(['ARC_NATIVE_MODE','NODE_ENV'].includes(name));return undefined
  }}}})
  try {
    const api=await import('../netlify/functions/runtime.mts')
    const worker=await import('../netlify/functions/runtime-workload-background.mts')
    const scheduled=await import('../netlify/functions/runtime-scheduled.mts')
    assert.equal(reads.includes('ARC_NATIVE_MODE'),false)
    for(const mod of [api,worker,scheduled])assert.equal((await mod.default(new Request('https://synthetic.invalid/.netlify/functions/runtime'))).status,404)
    assert.deepEqual(reads.filter(name=>name!=='NODE_ENV'),['ARC_NATIVE_MODE','ARC_NATIVE_MODE','ARC_NATIVE_MODE'])
    assert.deepEqual(api.config.path,['/native-api/*'])
    assert.deepEqual(worker.asyncWorkloadConfig.events,['arc-one:runtime'])
    assert.equal(scheduled.config?.schedule,'* * * * *')
  }finally{delete globalThis.Netlify}
})
