import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('frontend CI test isolation policy', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')

  it('runs the suite in bounded shards with a fresh Vitest process per shard', () => {
    expect(workflow).toContain('for shard in {1..8}; do')
    expect(workflow).toContain('--maxWorkers=1 --no-file-parallelism --shard="${shard}/8"')
  })
})
