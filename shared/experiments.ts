/** Portable, metadata-only experiment import. Paths and commands are inert text. */
export interface ExperimentFile {
  name: string
  sha256: string
  sizeBytes?: number
}
export type ExperimentValue = string | number | boolean | null
export interface ExperimentRun {
  id: string
  label: string
  status: 'succeeded' | 'failed'
  startedAt: string
  finishedAt: string
  inputs: ExperimentFile[]
  code: ExperimentFile
  parameters: Record<string, ExperimentValue>
  environment: Record<string, ExperimentValue>
  command: string[]
  logs: { stdout: string; stderr: string; exitCode: number }
  results: Record<string, ExperimentValue>
  outputs: ExperimentFile[]
  notes: string[]
}
export interface ExperimentComparison {
  leftRunId: string
  rightRunId: string
  label: string
  metrics: Record<string, ExperimentValue>
  notes: string[]
}
export interface ExperimentBundle {
  schemaVersion: 1
  title: string
  description: string
  provenance: string[]
  runs: ExperimentRun[]
  comparisons: ExperimentComparison[]
}
export interface ExperimentSummary {
  id: string
  title: string
  runCount: number
  importedAt: string
  bundleSha256: string
}
export interface StoredExperiment extends ExperimentSummary {
  bundle: ExperimentBundle
}
