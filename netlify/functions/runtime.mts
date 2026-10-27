import type { Config, Context } from '@netlify/functions'
import { createNetlifyPlatformHost } from './_shared/native/platform-netlify.ts'

export default (request: Request, context: Context): Promise<Response> => createNetlifyPlatformHost().api(request, context)

// Do not compete with the existing /api proxy until the native candidate is accepted.
export const config: Config = { path: ['/native-api/*'] }
