// Isolated loopback fixtures only. No environment or application config is loaded.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
export async function applyTestMigrations(client) {
  const migrations = new URL('../netlify/database/migrations/', import.meta.url)
  for (const name of readdirSync(migrations).sort()) {
    const path = new URL(`${name}/migration.sql`, migrations)
    if (name.includes('seed') || !existsSync(path)) continue
    await client.query(readFileSync(path, 'utf8'))
  }
}
export async function runtimeTestDatabase() {
  const port = Number(process.env.ARC_RUNTIME_TEST_PORT ?? '55432')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid synthetic PostgreSQL port')
  const connection = { host: '127.0.0.1', port, database: 'arc_identity_test', user: 'postgres', connectionTimeoutMillis: 3000 }
  const schema = `runtime_${randomUUID().replaceAll('-', '')}`
  const admin = new Pool(connection)
  const pool = new Pool({ ...connection, options: `-c search_path=${schema}`, statement_timeout: 5000 })
  await admin.query(`CREATE SCHEMA ${schema}`)
  try {
    await applyTestMigrations(pool)
  } catch (error) {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); throw error
  }
  return { pool, async close() {
    await pool.end()
    // schema is a fixed prefix + generated hex, never a user-supplied SQL identifier.
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    const exists = (await admin.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [schema])).rows.length
    await admin.end()
    if (exists) throw new Error('Synthetic schema cleanup failed')
  } }
}
