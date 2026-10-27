import type { Config } from '@netlify/functions'
import { createNetlifyPlatformHost } from './_shared/native/platform-netlify.ts'

export default (): Promise<Response> => createNetlifyPlatformHost().scheduled()

// Every UTC minute (also every local minute); closed mode returns 404 without consuming work.
export const config: Config = { schedule: '* * * * *' }
