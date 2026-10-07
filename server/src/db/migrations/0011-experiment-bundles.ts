import { createHash } from 'node:crypto'

/** Metadata-only imports. Records are insert-only through the API and removed
 * with their workspace. No uploaded paths, commands or URLs are executed. */
export const EXPERIMENT_BUNDLES_SQL = `
CREATE TABLE IF NOT EXISTS experiment_bundles (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  title          TEXT NOT NULL,
  run_count      INTEGER NOT NULL,
  bundle_sha256  TEXT NOT NULL,
  payload        JSONB NOT NULL,
  imported_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT experiment_bundles_company_fk FOREIGN KEY (company_id)
    REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT experiment_bundles_company_digest_key UNIQUE (company_id, bundle_sha256),
  CONSTRAINT experiment_bundles_digest_check CHECK (bundle_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT experiment_bundles_run_count_check CHECK (run_count BETWEEN 1 AND 20),
  CONSTRAINT experiment_bundles_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_experiment_bundles_company_imported
  ON experiment_bundles(company_id, imported_at DESC, id DESC);
`

export function experimentBundlesChecksum(): string {
  return createHash('sha256').update(EXPERIMENT_BUNDLES_SQL).digest('hex')
}
