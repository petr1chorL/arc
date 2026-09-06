import { readFileSync, readdirSync } from 'node:fs'
import { matchesGlob, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Node and Vitest runner ownership', () => {
  it('excludes every node:test program from jsdom and keeps it in the independent CI verifier', () => {
    const directory = resolve(process.cwd(), 'scripts')
    const programs = readdirSync(directory).filter(file => file.endsWith('.test.mjs') &&
      /from\s+['"]node:test['"]/.test(readFileSync(resolve(directory, file), 'utf8')))
    const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
    const exclusion = config.match(/exclude:\s*\[([^\]]*)\]/)?.[1] ?? ''
    const patterns = [...exclusion.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1])
    const verifier = readFileSync(resolve(directory, 'verify-runtime-local.mjs'), 'utf8')
    expect(programs.length).toBeGreaterThan(0)
    for (const file of programs) {
      expect(patterns.some(pattern => matchesGlob(`scripts/${file}`, pattern)), `${file} must not run in jsdom`).toBe(true)
      expect(verifier.includes(`'${file}'`), `${file} must still run in the independent verifier`).toBe(true)
    }
    expect(patterns.some(pattern => matchesGlob('scripts/test-runner-boundary.test.mjs', pattern))).toBe(false)
  })
})
