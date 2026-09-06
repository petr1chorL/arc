import { createRequire } from 'node:module'

export default async function teardown() {
  const ready = await (await fetch('http://127.0.0.1:48200/__ready')).json()
  if (!/^assets_browser_[a-f0-9]{32}$/.test(ready.schema) || !/^\d{1,5}$/.test(ready.port)
    || Number(ready.port) < 1 || Number(ready.port) > 65535) throw new Error('Unexpected synthetic database identity')
  const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
  const pool = new Pool({ connectionString: `postgresql://postgres@127.0.0.1:${ready.port}/arc_identity_test`,
    connectionTimeoutMillis: 5000 })
  const errors: unknown[] = []
  try {
    const exists = async () => (await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [ready.schema])).rowCount !== 0
    if (!await exists()) throw new Error('Synthetic schema was not present before cleanup')
    const response = await fetch('http://127.0.0.1:48200/__shutdown', {
      method: 'POST', headers: { 'X-ARC-Synthetic-Shutdown': '1' }, signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error('Synthetic database cleanup was not acknowledged')
    const deadline = Date.now() + 5000
    while (await exists()) {
      if (Date.now() >= deadline) throw new Error('Synthetic schema still exists after shutdown')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    console.log('Synthetic PostgreSQL schema removal independently verified')
  } catch (error) {
    errors.push(error)
  } finally {
    await pool.end().catch((error: unknown) => errors.push(error))
  }
  try {
    const web = await fetch('http://127.0.0.1:48273/__shutdown', {
      method: 'POST', headers: { 'X-ARC-Synthetic-Shutdown': '1' }, signal: AbortSignal.timeout(5000),
    })
    if (!web.ok) throw new Error('Synthetic web shutdown was not acknowledged')
  } catch (error) {
    errors.push(error)
  }
  if (errors.length) throw new AggregateError(errors, 'Synthetic environment cleanup failed')
}
