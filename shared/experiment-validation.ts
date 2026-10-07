import type { ExperimentBundle, ExperimentComparison, ExperimentFile, ExperimentRun, ExperimentValue } from './experiments.js'

/** Limits apply equally to client previews and server imports; the API also caps requests at 256 KiB. */
export const MAX_EXPERIMENT_BUNDLE_BYTES = 240 * 1024
export const MAX_EXPERIMENT_RUNS = 20

export class ExperimentValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ExperimentValidationError' }
}

function fail(path: string, reason: string): never {
  throw new ExperimentValidationError(`${path}: ${reason}`)
}

function object(value: unknown, path: string, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  const record = value as Record<string, unknown>
  if (keys && Object.keys(record).some((key) => !keys.includes(key))) fail(path, 'contains an unknown field')
  return record
}

function text(value: unknown, path: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    fail(path, `must be ${required ? 'nonempty ' : ''}text of at most ${max} characters`)
  }
  // JSONB cannot store NUL or unpaired UTF-16 surrogates. Fail with a useful 400
  // instead of letting malformed Unicode become a database error.
  if (/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    fail(path, 'contains invalid Unicode')
  }
  return value
}

function list<T>(value: unknown, path: string, max: number, parse: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `must be an array of at most ${max} items`)
  return value.map((item, index) => parse(item, `${path}[${index}]`))
}

function notes(value: unknown, path: string): string[] {
  return list(value, path, 20, (item, itemPath) => text(item, itemPath, 2000))
}

function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) {
    fail(path, 'must be 1–80 letters, digits, dots, underscores or hyphens, starting with a letter or digit')
  }
  return value
}

function timestamp(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be an ISO 8601 timestamp with timezone')
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) fail(path, 'must be an ISO 8601 timestamp with timezone')
  const [, year, month, day, hour, minute, second, , zone] = match
  const leap = +year % 4 === 0 && (+year % 100 !== 0 || +year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (+month < 1 || +month > 12 || +day < 1 || +day > days[+month - 1] || +hour > 23 || +minute > 59 || +second > 59 ||
      (zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59))) {
    fail(path, 'must be a valid calendar timestamp')
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() < 1 || parsed.getUTCFullYear() > 9999) fail(path, 'must be a valid timestamp in years 0001–9999')
  return value
}

/** Date validates calendar/offsets; retain up to nanosecond precision for ordering. */
function epochNanoseconds(value: string): bigint {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? ''
  return BigInt(Date.parse(value)) * 1_000_000n + BigInt(fraction.padEnd(9, '0').slice(3))
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(path, `must be an integer from ${min} to ${max}`)
  }
  return value
}

function file(value: unknown, path: string): ExperimentFile {
  const record = object(value, path, ['name', 'sha256', 'sizeBytes'])
  const name = text(record.name, `${path}.name`, 512, true)
  if (typeof record.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(record.sha256)) fail(`${path}.sha256`, 'must be a SHA-256 hex digest')
  return {
    name, sha256: record.sha256.toLowerCase(),
    ...(record.sizeBytes === undefined ? {} : { sizeBytes: integer(record.sizeBytes, `${path}.sizeBytes`, 0, Number.MAX_SAFE_INTEGER) }),
  }
}

function primitiveMap(value: unknown, path: string): Record<string, ExperimentValue> {
  const record = object(value, path)
  if (Object.keys(record).length > 64) fail(path, 'must have at most 64 entries')
  const entries = Object.entries(record).map(([key, item]): [string, ExperimentValue] => {
    text(key, `${path} key`, 80, true)
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(path, 'contains a reserved key')
    if (typeof item === 'string') return [key, text(item, `${path}.${key}`, 2000)]
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return [key, item]
    return fail(`${path}.${key}`, 'must be text, a finite number, a boolean or null')
  })
  return Object.fromEntries(entries)
}

function run(value: unknown, path: string): ExperimentRun {
  const record = object(value, path, ['id', 'label', 'status', 'startedAt', 'finishedAt', 'inputs', 'code', 'parameters', 'environment', 'command', 'logs', 'results', 'outputs', 'notes'])
  if (record.status !== 'succeeded' && record.status !== 'failed') fail(`${path}.status`, 'must be succeeded or failed')
  const startedAt = timestamp(record.startedAt, `${path}.startedAt`)
  const finishedAt = timestamp(record.finishedAt, `${path}.finishedAt`)
  if (epochNanoseconds(finishedAt) < epochNanoseconds(startedAt)) fail(`${path}.finishedAt`, 'must not precede startedAt')
  const logs = object(record.logs, `${path}.logs`, ['stdout', 'stderr', 'exitCode'])
  return {
    id: id(record.id, `${path}.id`), label: text(record.label, `${path}.label`, 200, true), status: record.status,
    startedAt, finishedAt,
    inputs: list(record.inputs, `${path}.inputs`, 20, file), code: file(record.code, `${path}.code`),
    parameters: primitiveMap(record.parameters, `${path}.parameters`), environment: primitiveMap(record.environment, `${path}.environment`),
    command: list(record.command, `${path}.command`, 64, (item, itemPath) => text(item, itemPath, 2000)),
    logs: { stdout: text(logs.stdout, `${path}.logs.stdout`, 8192), stderr: text(logs.stderr, `${path}.logs.stderr`, 8192), exitCode: integer(logs.exitCode, `${path}.logs.exitCode`, -2147483648, 2147483647) },
    results: primitiveMap(record.results, `${path}.results`), outputs: list(record.outputs, `${path}.outputs`, 20, file),
    notes: notes(record.notes, `${path}.notes`),
  }
}

function comparison(value: unknown, path: string): ExperimentComparison {
  const record = object(value, path, ['leftRunId', 'rightRunId', 'label', 'metrics', 'notes'])
  return {
    leftRunId: id(record.leftRunId, `${path}.leftRunId`), rightRunId: id(record.rightRunId, `${path}.rightRunId`),
    label: text(record.label, `${path}.label`, 200, true), metrics: primitiveMap(record.metrics, `${path}.metrics`), notes: notes(record.notes, `${path}.notes`),
  }
}

/** Produces a fresh, allowlisted metadata bundle. No file reads, URL fetches or execution. */
export function parseExperimentBundle(value: unknown): ExperimentBundle {
  const record = object(value, 'bundle', ['schemaVersion', 'title', 'description', 'provenance', 'runs', 'comparisons'])
  if (record.schemaVersion !== 1) fail('bundle.schemaVersion', 'must be 1')
  const runs = list(record.runs, 'bundle.runs', MAX_EXPERIMENT_RUNS, run)
  if (runs.length === 0) fail('bundle.runs', 'must contain at least one run')
  const ids = new Set(runs.map((item) => item.id))
  if (ids.size !== runs.length) fail('bundle.runs', 'run IDs must be unique')
  const comparisons = list(record.comparisons, 'bundle.comparisons', 40, comparison)
  comparisons.forEach((item, index) => {
    if (item.leftRunId === item.rightRunId || !ids.has(item.leftRunId) || !ids.has(item.rightRunId)) {
      fail(`bundle.comparisons[${index}]`, 'must reference two distinct runs in this bundle')
    }
  })
  const bundle: ExperimentBundle = {
    schemaVersion: 1, title: text(record.title, 'bundle.title', 200, true), description: text(record.description, 'bundle.description', 4000),
    provenance: notes(record.provenance, 'bundle.provenance'), runs, comparisons,
  }
  if (new TextEncoder().encode(JSON.stringify(bundle)).byteLength > MAX_EXPERIMENT_BUNDLE_BYTES) {
    fail('bundle', `must be at most ${MAX_EXPERIMENT_BUNDLE_BYTES} UTF-8 bytes after normalization`)
  }
  return bundle
}
