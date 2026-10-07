import { Router, type Request, type Response, type NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { ExperimentSummary, StoredExperiment } from '../../../shared/experiments.js'
import { ExperimentValidationError, parseExperimentBundle } from '../../../shared/experiment-validation.js'
import type { AuthedRequest } from '../auth.js'
import { experimentBundleSha256 } from '../experiments/bundle.js'

export interface ExperimentsRouterDeps {
  pool: Pick<Pool, 'query'>
  requireCompany(req: Request & AuthedRequest): Promise<{ userId: string; companyId: string }>
}

/** This first slice returns only the newest 100 summaries; details remain addressable by ID. */
export const EXPERIMENT_LIST_LIMIT = 100
const SUMMARY_COLUMNS = `id, title, run_count AS "runCount", imported_at AS "importedAt", bundle_sha256 AS "bundleSha256"`
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, payload AS bundle`
const RECORD_ID = /^exp-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export function createExperimentsRouter(deps: ExperimentsRouterDeps): Router {
  const router = Router()
  const { pool } = deps

  router.get('/', async (req, res) => {
    const { companyId } = await deps.requireCompany(req)
    const { rows } = await pool.query<ExperimentSummary>(
      `SELECT ${SUMMARY_COLUMNS} FROM experiment_bundles WHERE company_id = $1
       ORDER BY imported_at DESC, id DESC LIMIT $2`, [companyId, EXPERIMENT_LIST_LIMIT],
    )
    res.json({ experiments: rows })
  })

  router.get('/:id', async (req, res) => {
    const { companyId } = await deps.requireCompany(req)
    if (!RECORD_ID.test(req.params.id)) { res.status(404).json({ error: 'experiment not found' }); return }
    const { rows } = await pool.query<StoredExperiment>(
      `SELECT ${DETAIL_COLUMNS} FROM experiment_bundles WHERE id = $1 AND company_id = $2`,
      [req.params.id, companyId],
    )
    if (!rows[0]) { res.status(404).json({ error: 'experiment not found' }); return }
    res.json({ experiment: rows[0] })
  })

  router.post('/', async (req, res) => {
    const { companyId } = await deps.requireCompany(req)
    const body: unknown = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'bundle')) {
      throw new ExperimentValidationError('request must contain only a bundle field')
    }
    const bundle = parseExperimentBundle((body as { bundle?: unknown }).bundle)
    const digest = experimentBundleSha256(bundle)
    const { rows } = await pool.query<StoredExperiment>(
      `INSERT INTO experiment_bundles (id, company_id, title, run_count, bundle_sha256, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (company_id, bundle_sha256) DO NOTHING RETURNING ${DETAIL_COLUMNS}`,
      [`exp-${randomUUID()}`, companyId, bundle.title, bundle.runs.length, digest, JSON.stringify(bundle)],
    )
    if (rows[0]) { res.status(201).json({ experiment: rows[0], duplicate: false }); return }
    // A separate statement gets a fresh read-committed snapshot after a racing
    // insert commits. DO NOTHING preserves both original payload and import time.
    const existing = await pool.query<StoredExperiment>(
      `SELECT ${DETAIL_COLUMNS} FROM experiment_bundles WHERE company_id = $1 AND bundle_sha256 = $2`,
      [companyId, digest],
    )
    if (!existing.rows[0]) throw new Error('duplicate experiment disappeared before readback')
    res.json({ experiment: existing.rows[0], duplicate: true })
  })

  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ExperimentValidationError) { res.status(400).json({ error: err.message }); return }
    next(err)
  })
  return router
}
