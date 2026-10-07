import { http } from './client'
import type { ExperimentBundle, ExperimentSummary, StoredExperiment } from '../../shared/experiments'

export interface ExperimentsApi {
  list(): Promise<{ experiments: ExperimentSummary[] }>
  get(id: string): Promise<{ experiment: StoredExperiment }>
  import(bundle: ExperimentBundle): Promise<{ experiment: StoredExperiment; duplicate: boolean }>
}

export const experimentsApi: ExperimentsApi = {
  list: () => http('/experiments'),
  get: (id) => http(`/experiments/${encodeURIComponent(id)}`),
  import: (bundle) => http('/experiments', { method: 'POST', body: JSON.stringify({ bundle }) }),
}
