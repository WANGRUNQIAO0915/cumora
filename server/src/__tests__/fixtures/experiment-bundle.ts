import type { ExperimentBundle, ExperimentRun } from '../../../../shared/experiments.js'

export function experimentFixture(): ExperimentBundle {
  const run: ExperimentRun = {
    id: 'baseline', label: 'Baseline', status: 'succeeded',
    startedAt: '2026-10-01T10:00:00.000Z', finishedAt: '2026-10-01T10:00:01.000Z',
    inputs: [{ name: 'data.csv', sha256: 'a'.repeat(64), sizeBytes: 123 }],
    code: { name: 'analysis.py', sha256: 'b'.repeat(64) },
    parameters: { alpha: 0.1, seed: 42, normalize: true, optional: null },
    environment: { python: '3.12', platform: 'local' }, command: ['python', 'analysis.py'],
    logs: { stdout: 'Finished\n', stderr: '', exitCode: 0 }, results: { accuracy: 0.75 },
    outputs: [{ name: 'result.json', sha256: 'c'.repeat(64) }], notes: ['Recorded locally.'],
  }
  return {
    schemaVersion: 1, title: 'Test experiment', description: 'Two recorded runs.', provenance: ['Synthetic test metadata'],
    runs: [run, { ...structuredClone(run), id: 'candidate', label: 'Candidate', results: { accuracy: 0.8 } }],
    comparisons: [{ leftRunId: 'baseline', rightRunId: 'candidate', label: 'Accuracy', metrics: { delta: 0.05 }, notes: [] }],
  }
}
