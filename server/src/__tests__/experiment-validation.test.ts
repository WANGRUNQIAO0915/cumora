import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ExperimentValidationError, parseExperimentBundle } from '../../../shared/experiment-validation.js'
import { experimentBundleSha256 } from '../experiments/bundle.js'
import { experimentFixture } from './fixtures/experiment-bundle.js'

test('experiment validation clones and normalizes an allowlisted payload', () => {
  const input = experimentFixture()
  input.runs[0].inputs[0].sha256 = 'A'.repeat(64)
  input.runs[0].startedAt = '2026-10-01T12:00:00+02:00'
  const parsed = parseExperimentBundle(input)
  assert.notEqual(parsed, input)
  assert.notEqual(parsed.runs[0], input.runs[0])
  assert.equal(parsed.runs[0].inputs[0].sha256, 'a'.repeat(64))
  assert.equal(parsed.runs[0].startedAt, '2026-10-01T12:00:00+02:00')
  assert.equal(input.runs[0].inputs[0].sha256, 'A'.repeat(64))
})

test('canonical content digest ignores property order while retaining all metadata and array order', () => {
  const input = experimentFixture()
  const reordered = JSON.parse(JSON.stringify(input, (_key, value: unknown) => {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value
  }))
  const expected = experimentBundleSha256(parseExperimentBundle(input))
  assert.match(expected, /^[a-f0-9]{64}$/)
  assert.equal(experimentBundleSha256(parseExperimentBundle(reordered)), expected)
  input.runs.reverse()
  assert.notEqual(experimentBundleSha256(parseExperimentBundle(input)), expected)
  input.runs.reverse()
  input.runs[0].notes.push('Additional evidence')
  assert.notEqual(experimentBundleSha256(parseExperimentBundle(input)), expected)
})

test('paths, shell-like text and URLs remain inert metadata', () => {
  const input = experimentFixture()
  input.runs[0].command = ['sh', '-c', 'touch /tmp/never-execute-experiment']
  input.runs[0].inputs[0].name = 'https://example.invalid/never-fetch'
  input.runs[0].outputs[0].name = '../../never-read'
  const parsed = parseExperimentBundle(input)
  assert.deepEqual(parsed.runs[0].command, input.runs[0].command)
  assert.equal(parsed.runs[0].inputs[0].name, input.runs[0].inputs[0].name)
  assert.equal(parsed.runs[0].outputs[0].name, input.runs[0].outputs[0].name)
})

const invalidCases: Array<[string, (input: ReturnType<typeof experimentFixture>) => unknown]> = [
  ['schema version', (b) => ({ ...b, schemaVersion: 2 })],
  ['unknown bundle field', (b) => ({ ...b, companyId: 'other-tenant' })],
  ['missing title', (b) => ({ ...b, title: undefined })],
  ['empty title', (b) => ({ ...b, title: '   ' })],
  ['oversized title', (b) => ({ ...b, title: 'a'.repeat(201) })],
  ['empty runs', (b) => ({ ...b, runs: [] })],
  ['too many runs', (b) => ({ ...b, runs: Array.from({ length: 21 }, (_, i) => ({ ...b.runs[0], id: `run-${i}` })) })],
  ['duplicate run IDs', (b) => { b.runs[1].id = b.runs[0].id; return b }],
  ['invalid run ID', (b) => { b.runs[0].id = '../escape'; return b }],
  ['missing comparison run', (b) => { b.comparisons[0].leftRunId = 'missing'; return b }],
  ['self comparison', (b) => { b.comparisons[0].rightRunId = 'baseline'; return b }],
  ['invalid status', (b) => ({ ...b, runs: [{ ...b.runs[0], status: 'running' }] })],
  ['invalid hash', (b) => { b.runs[0].code.sha256 = 'not-a-hash'; return b }],
  ['invalid file size', (b) => { b.runs[0].code.sizeBytes = -1; return b }],
  ['unknown file field', (b) => { Object.assign(b.runs[0].code, { data: 'contents' }); return b }],
  ['missing timezone', (b) => { b.runs[0].startedAt = '2026-10-01T10:00:00'; return b }],
  ['invalid calendar day', (b) => { b.runs[0].startedAt = '2026-02-30T10:00:00Z'; return b }],
  ['non-leap February', (b) => { b.runs[0].startedAt = '2025-02-29T10:00:00Z'; return b }],
  ['invalid hour', (b) => { b.runs[0].startedAt = '2026-10-01T24:00:00Z'; return b }],
  ['backwards time', (b) => { b.runs[0].finishedAt = '2026-09-01T00:00:00Z'; return b }],
  ['nested maps', (b) => { Object.assign(b.runs[0].parameters, { nested: { unwanted: true } }); return b }],
  ['array maps', (b) => { Object.assign(b.runs[0], { parameters: [] }); return b }],
  ['non-finite values', (b) => { b.runs[0].results.accuracy = Infinity; return b }],
  ['too many map keys', (b) => { b.runs[0].environment = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i])); return b }],
  ['reserved map keys', (b) => { b.runs[0].parameters = JSON.parse('{"__proto__": "unsafe"}'); return b }],
  ['oversized logs', (b) => { b.runs[0].logs.stdout = 'a'.repeat(8193); return b }],
  ['non-integer exit', (b) => { b.runs[0].logs.exitCode = 0.5; return b }],
  ['NUL text', (b) => { b.description = '\u0000'; return b }],
  ['unpaired Unicode surrogate', (b) => { b.description = '\ud800'; return b }],
  ['aggregate UTF-8 limit', (b) => {
    b.runs = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(b.runs[0]), id: `run-${i}`, logs: { stdout: '界'.repeat(8192), stderr: '', exitCode: 0 } }))
    b.comparisons = []
    return b
  }],
]
for (const [name, mutate] of invalidCases) {
  test(`experiment import rejects ${name}`, () => {
    assert.throws(() => parseExperimentBundle(mutate(experimentFixture())), ExperimentValidationError)
  })
}

test('failure records, valid leap days and valid Unicode are preserved', () => {
  const input = experimentFixture()
  input.runs[0].status = 'failed'
  input.runs[0].logs = { stdout: '', stderr: 'Error: failure 💥', exitCode: 1 }
  input.runs[0].startedAt = '2024-02-29T10:00:00Z'
  assert.equal(parseExperimentBundle(input).runs[0].logs.stderr, 'Error: failure 💥')
})


test('timestamps preserve recorded microsecond and nanosecond precision', () => {
  const input = experimentFixture()
  input.runs[0].startedAt = '2026-10-07T09:37:34.774836Z'
  input.runs[0].finishedAt = '2026-10-07T11:37:34.774836001+02:00'
  const parsed = parseExperimentBundle(input)
  assert.equal(parsed.runs[0].startedAt, input.runs[0].startedAt)
  assert.equal(parsed.runs[0].finishedAt, input.runs[0].finishedAt)
  input.runs[0].finishedAt = '2026-10-07T09:37:34.774835Z'
  assert.throws(() => parseExperimentBundle(input), /must not precede/)
})
