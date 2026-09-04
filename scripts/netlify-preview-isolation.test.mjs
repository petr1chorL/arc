import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'netlify/database/migrations/20260904050000_preview-isolation-gate/migration.sql',
)

describe('Netlify preview isolation gate migration', () => {
  it('writes a preview-only marker without changing existing rows', async () => {
    const sql = await readFile(migrationPath, 'utf8')

    expect(sql).toContain("'preview-isolation-gate-20260904'")
    expect(sql).toContain('ON CONFLICT (operation_id) DO NOTHING')
    expect(sql).not.toMatch(/DELETE|DROP|TRUNCATE/i)
  })
})
