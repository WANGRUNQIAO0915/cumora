# Experiment records (first bounded workbench slice)

## What is available

Open **Experiments / 实验记录** from the desktop rail. On mobile, open
**Library → Experiments**. An unpaired free workspace can open records from
the onboarding screen without pairing a computer; other views keep the existing
onboarding requirement. Existing login and workspace membership remain required.

1. Choose **Import JSON** and select a metadata bundle.
2. Review its title, run count, and destination workspace. **Cancel** discards
   the preview. **Import into workspace** saves it and makes it readable by all
   current members of that workspace. Check the file for private information first.
3. Select a recorded run to inspect results, input/code/output fingerprints,
   parameters, environment, command text, and stdout/stderr.
4. Check two runs and choose **Compare runs**. Changed fields are highlighted.
   Summary deltas are right minus left. Imported pairwise reports keep their
   original direction and are clearly separate from derived summary deltas.

This feature neither executes commands nor reads referenced paths/URLs. Hashes
and success labels are claims from the imported record, not independently
verified by the viewer. Raw artifacts are not uploaded, fetched or stored.
No model/provider calls, local execution agent, automatic replay, or autonomous
multi-agent orchestration are added.

## Real, metadata-only Chongqing example

Import [`examples/experiments/chongqing-slope.json`](../examples/experiments/chongqing-slope.json).
Its [README](../examples/experiments/README.md) gives the exact source mapping and
reproducible conversion/validation commands. It contains two genuinely recorded
GDAL 3.10.3 runs, Horn and Zevenbergen–Thorne, rather than invented demonstration
metrics. The preserved input is a previously bilinear-resampled 100 m Int16 DSM,
not a native 100 m DTM. Replay evidence starts at that preserved input and was
verified on Linux; Windows and reconstruction from raw source tiles were not
executed. Large rasters and private local paths/Library identifiers are excluded.

## UI development preview (no sign-in, no server, no saved data)

```sh
npm ci
npm run dev
```

Open `http://localhost:5180/dev/experiments.html`. This separate development-only
entry renders the **same React workspace component** using an explicitly labelled
in-memory adapter and real archived fixture. **Records**, **Empty**, and **Error**
controls exercise starting states. **EN / 中文** changes the normal locale store.
Imports in this preview disappear on reload. It is not an authentication bypass:
`src/App.tsx` never routes to this harness and the normal production build does
not include its HTML entry or example JSON.

## Portable metadata contract

`shared/experiments.ts` defines schema version 1. The browser preview and API
both use `parseExperimentBundle` from `shared/experiment-validation.ts`.
Unknown fields are rejected. A bundle has a title, description, provenance notes,
1–20 run records, and up to 40 pairwise evidence records. Each run has:

- Stable ID, human label, recorded succeeded/failed status, ISO timestamps
- Input, code and output filenames plus SHA-256 fingerprints
- Flat parameter, environment and result maps (string/finite number/boolean/null)
- A command argument array displayed as inert text
- stdout/stderr and an exit code; explanatory notes

No external IDs, company choice or user IDs are accepted in the payload. Names,
paths, logs and URLs remain text; React escapes them. The server does not resolve
or dereference them. Original sub-millisecond timestamp precision is retained.

Limits: 240 KiB canonical UTF-8 bundle and a 256 KiB HTTP JSON envelope; the file
picker conservatively limits the source file itself to 240 KiB. Each map has at
most 64 keys; each log at most 8,192 UTF-16 characters; input/output lists at most
20 files each; command at most 64 arguments of at most 2,000 characters each.
See the shared validator for exact per-field bounds.

## API and storage

- `GET /api/experiments`: `{ experiments: ExperimentSummary[] }`, latest 100.
- `GET /api/experiments/:id`: `{ experiment: StoredExperiment }`.
- `POST /api/experiments`: `{ bundle: ExperimentBundle }` →
  `{ experiment: StoredExperiment, duplicate: boolean }`; 201 new / 200 duplicate.

All three routes call the existing `requireCompany` membership check. Company
scope comes exclusively from the authenticated request. Cross-workspace IDs
return 404. The UI drops all local records and pending files when its user or
active company changes; late reads are discarded. Bundles are immutable; no
update/delete endpoint is introduced. A changed import is a new record.

SHA-256 is computed server-side over recursively sorted object keys (array order
is meaningful). `UNIQUE(company_id, bundle_sha256)` makes repeated and concurrent
identical imports idempotent without rewriting the original timestamp. IDs are
server-generated UUIDs. Workspace deletion cascades to its bundles. There is no
new cross-workspace sharing or persistent browser cache. Refresh explicitly
reloads the latest summaries; no realtime event stream is introduced.

Migration **0011_experiment_bundles** creates a new table and index without
altering hot existing tables. Both supported schema bounds move to 11, following
Cumora's existing exact-version policy. Apply with `npm run migrate` before
running the corresponding server build. An older image will refuse the newer
ledger; this draft does not claim rollout-undo compatibility. No migration was
applied to any user's or deployed database during development.

## Verification

```sh
npm run lint
npm run typecheck
npm run server:typecheck
npm run build
npm test
npm run guard:big-brain
npm run guard:llm-tracked
npm run guard:engine-registry
npm run guard:migration-locks
```

The real PostgreSQL tests in `server/src/__integration__/experiments.test.ts`
exercise authentication, revoked membership, company isolation, concurrent
imports, database constraints/cascade, payload ceilings and the latest-100 bound.
Run with a **throwaway** `INTEGRATION_DATABASE_URL` and the repository's integration
runner; the runner truncates tables. A skipped integration suite is not a pass.

Windows packaging, a signed installer, and live Windows execution remain later
verification steps. This slice is ordinary React/HTTP/PostgreSQL code with no
new OS-specific runtime dependency.

Optional DOM interaction regression (no browser/layout claims; no app dependency added):

```sh
npm install --prefix /tmp/cumora-ui-test --ignore-scripts jsdom@26
node scripts/test-experiments-ui.mjs /tmp/cumora-ui-test/node_modules/jsdom/lib/api.js
```

The checks mount the real workspace component and cover preview/Cancel/import,
a stale list arriving after import, input hashes, keyboard tabs, logs, two-run
comparison/Back, duplicate imports, and malformed JSON without an upload.
Use an equivalent temporary absolute dependency path on Windows.
