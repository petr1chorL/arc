import type { AsyncWorkloadConfig } from '@netlify/async-workloads'
import type { Config, Context } from '@netlify/functions'
import { createNetlifyPlatformHost } from './_shared/native/platform-netlify.ts'

export default (request: Request, context: Context): Promise<Response | void> => createNetlifyPlatformHost().workload(request, context)

// The application gate runs before the SDK; eventFilter/status are not security off switches.
export const asyncWorkloadConfig: AsyncWorkloadConfig = { events: ['arc-one:runtime'], maxRetries: 4 }
export const config: Config = { background: true }
