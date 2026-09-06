import {spawnSync} from 'node:child_process'
// All targets are source-controlled. Each PG check owns and drops its random synthetic schema.
const checks=[
  'cutover-source-inventory.test.mjs',
  'native-api-host.test.mjs',
  'native-deployment.test.mjs','native-runtime-config.test.mjs','provider-compat.test.mjs','runtime-legacy-control.test.mjs',
  'runtime-ledger.test.mjs','runtime-gateway.test.mjs','runtime-workflow.test.mjs','runtime-http.test.mjs','runtime-entry.test.mjs',
  'runtime-delivery.test.mjs','runtime-delivery-postgres.mjs','runtime-agent-tools.test.mjs',
  'runtime-closure.test.mjs','runtime-closure-postgres.mjs','runtime-closure-evaluation-postgres.mjs',
  'runtime-closure-workflow-postgres.mjs',
]
for(const file of checks) {
  const result=spawnSync(process.execPath,['--experimental-transform-types',`scripts/${file}`],{stdio:'inherit',windowsHide:true})
  if(result.error)throw result.error
  if(result.status!==0)process.exit(result.status??1)
}
console.log(`Native runtime verification: ${checks.length} test programs passed (synthetic only).`)
