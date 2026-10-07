import type { ExperimentFile, ExperimentValue } from '../../shared/experiments'

export function sameFingerprints(left: ExperimentFile[], right: ExperimentFile[]): boolean {
  const hashes = (files: ExperimentFile[]) => files.map((f) => f.sha256.toLowerCase()).sort().join('\n')
  return left.length > 0 && hashes(left) === hashes(right)
}

/** Retain small scientific values; decimal-place rounding can turn real evidence into zero. */
export function experimentValueText(value: ExperimentValue | undefined): string {
  if (value === undefined || value === null) return '—'
  return String(value)
}

/** Summary deltas are not pixel-wise raster differences or accuracy scores. */
export function comparisonRows(left: Record<string, ExperimentValue>, right: Record<string, ExperimentValue>) {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].map((key) => {
    const a = Object.hasOwn(left, key) ? left[key] : undefined
    const b = Object.hasOwn(right, key) ? right[key] : undefined
    const difference = typeof a === 'number' && typeof b === 'number' ? b - a : null
    return { key, left: a, right: b, changed: a !== b,
      delta: difference !== null && Number.isFinite(difference) ? difference : null }
  })
}
