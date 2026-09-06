import test from 'node:test'
import assert from 'node:assert/strict'
test('dormant API and workload deny before any environment, database or event access', async () => {
  let reads=0
  Object.defineProperty(globalThis,'Netlify',{configurable:true,get(){reads++;throw Error('dormant entry read environment')}})
  try {
    const api=await import('../netlify/functions/runtime.mts')
    const worker=await import('../netlify/functions/runtime-workload-background.mts')
    const scheduled=await import('../netlify/functions/runtime-scheduled.mts')
    for(const mod of [api,worker,scheduled])assert.equal((await mod.default(new Request('https://synthetic.invalid/.netlify/functions/runtime'))).status,404)
    assert.equal(reads,0);assert.deepEqual(worker.asyncWorkloadConfig.events,[])
    assert.equal(scheduled.config?.schedule,undefined)
  }finally{delete globalThis.Netlify}
})
