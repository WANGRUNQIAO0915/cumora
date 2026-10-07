import { createHash } from 'node:crypto'
import type { ExperimentBundle } from '../../../shared/experiments.js'

/** Object property ordering is immaterial; array ordering is part of the record. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Hash only the validated payload, never caller IDs, tenant fields or import time. */
export function experimentBundleSha256(bundle: ExperimentBundle): string {
  return createHash('sha256').update(canonicalize(bundle)).digest('hex')
}
