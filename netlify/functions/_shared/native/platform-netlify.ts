import { getDatabase } from '@netlify/database'
import { AsyncWorkloadsClient } from '@netlify/async-workloads'
import type { SqlPool } from '../identity-workspace/postgres.ts'
import type { RuntimeEvent, RuntimeSender } from '../runtime/netlify.ts'
import { ensureFreshIdentity } from './bootstrap.ts'
import { createNativePlatformHost } from './platform-host.ts'

/** The transport payload contains only a durable identity, never input/configuration or credentials. */
export function createOperationSender(client: Pick<AsyncWorkloadsClient<RuntimeEvent>, 'send'>): RuntimeSender {
  return id => client.send('arc-one:runtime', { data: { operationId: id } })
}

/** SDK/database construction is deferred until the exact server-side mode permits it. */
export function createNetlifyPlatformHost() {
  return createNativePlatformHost({
    readEnv: name => Netlify.env.get(name),
    loadPool: () => getDatabase().pool as unknown as SqlPool,
    initializeIdentity: ensureFreshIdentity,
    createSender: () => createOperationSender(new AsyncWorkloadsClient<RuntimeEvent>()),
  })
}
