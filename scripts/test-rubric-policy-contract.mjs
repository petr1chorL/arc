// Compare synthetic JSON field contracts only; no application/database or credentials.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { parseRubricWrite } from '../netlify/functions/_shared/rubrics/policy.ts'
import { ApiError } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { casefold } from '../netlify/functions/_shared/rubrics/casefold.ts'
import { DEFAULT_RUBRICS } from '../netlify/functions/_shared/rubrics/defaults.ts'

const cases = JSON.parse(readFileSync(new URL('../fixtures/rubric-policy.json', import.meta.url), 'utf8'))
const python = spawnSync(process.argv[2] ?? 'python', ['scripts/rubric-policy-python.py'], {
  input: JSON.stringify(cases), encoding: 'utf8', timeout: 30000,
})
assert.equal(python.status, 0, python.stderr)
const expected = JSON.parse(python.stdout)
for (const [index, test] of cases.entries()) {
  let actual
  try { actual = { status: 200, body: parseRubricWrite(test.body) } } catch (error) {
    assert.ok(error instanceof ApiError, `${test.name}: unexpected exception`)
    actual = { status: error.status, body: { detail: error.message } }
  }
  assert.equal(expected[index].status, test.status, `${test.name}: Python behavior differs from explicit expectation`)
  assert.deepEqual(actual, expected[index], test.name)
}
console.log(`Rubric policy: ${cases.length} shared JSON requests match Python, including normalized values`)
const unicode = spawnSync(process.argv[2] ?? 'python', ['scripts/rubric-policy-python.py', '--casefold'], {
  encoding: 'utf8', timeout: 30000,
})
assert.equal(unicode.status, 0, unicode.stderr)
const reference = JSON.parse(unicode.stdout)
assert.equal(reference.unicodeVersion, '15.0.0', 'Review casefold mapping when the authoritative Python Unicode version changes')
const actualMapping = {}
for (let i = 0; i < 0x110000; i++) {
  const char = String.fromCodePoint(i), folded = casefold(char)
  if (folded !== char) actualMapping[i] = folded
}
assert.deepEqual(actualMapping, reference.mapping)
console.log('Unicode casefold: all 1,114,112 code points match project Python Unicode 15.0.0')
const defaults = spawnSync(process.argv[2] ?? 'python', ['scripts/rubric-policy-python.py', '--defaults'], {
  input: readFileSync('apps/api/app/main.py', 'utf8'), encoding: 'utf8', timeout: 30000,
})
assert.equal(defaults.status, 0, defaults.stderr)
assert.deepEqual(DEFAULT_RUBRICS, JSON.parse(defaults.stdout))
console.log('Three default rubrics exactly match Python literal baseline')
