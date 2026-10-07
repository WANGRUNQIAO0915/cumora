import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import express from 'express'
import { readFile } from 'node:fs/promises'
import type { StoredExperiment } from '../../../shared/experiments.js'
import { pool } from '../db/pool.js'
import { createSession } from '../auth.js'
import { experimentFixture } from '../__tests__/fixtures/experiment-bundle.js'
import { ensureSchemaOnce, resetAllTables, seedUserMembership, teardownAll } from './_helpers.js'

const USER = 'experiment-user'
const COMPANY_A = 'experiment-company-a'
const COMPANY_B = 'experiment-company-b'
const OUTSIDER = 'experiment-company-outsider'
let server: Server
let baseUrl = ''
let token = ''

before(async () => {
  await ensureSchemaOnce()
  const { api } = await import('../api/router.js')
  const app = express()
  app.use('/api', api)
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(async () => {
  await resetAllTables()
  for (const company of [COMPANY_A, COMPANY_B, OUTSIDER]) {
    await pool.query(`INSERT INTO companies (id, name, slug, owner_user_id) VALUES ($1, $1, $1, $2)`, [company, USER])
  }
  await seedUserMembership(USER, COMPANY_A)
  await seedUserMembership(USER, COMPANY_B)
  token = (await createSession(USER, {})).token
})

after(async () => { await teardownAll(server) })

async function call(path = '', method = 'GET', body?: unknown, company = COMPANY_A, auth = true) {
  const response = await fetch(`${baseUrl}/api/experiments${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-company-id': company, ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, json: await response.json() as { experiment: StoredExperiment; experiments: StoredExperiment[]; duplicate: boolean; error: string } }
}

test('[integration] experiment routes enforce real authentication and company membership', async () => {
  for (const [path, method, body] of [['', 'GET', undefined], ['/exp-00000000-0000-0000-0000-000000000000', 'GET', undefined], ['', 'POST', { bundle: experimentFixture() }]] as const) {
    assert.equal((await call(path, method, body, COMPANY_A, false)).status, 401)
    assert.equal((await call(path, method, body, OUTSIDER)).status, 403)
  }
  assert.equal((await pool.query('SELECT id FROM experiment_bundles')).rows.length, 0)
})

test('[integration] imports survive database readback and stay isolated to their company', async () => {
  const created = await call('', 'POST', { bundle: experimentFixture() })
  assert.equal(created.status, 201)
  assert.equal(created.json.duplicate, false)
  const record = created.json.experiment
  assert.equal(record.runCount, 2)
  assert.match(record.bundleSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(record.bundle, experimentFixture())
  assert.deepEqual((await call(`/${record.id}`)).json.experiment, record)
  assert.equal((await call(`/${record.id}`, 'GET', undefined, COMPANY_B)).status, 404)
  assert.deepEqual((await call('', 'GET', undefined, COMPANY_B)).json.experiments, [])
  const listed = await call()
  assert.equal(listed.json.experiments.length, 1)
  assert.equal(listed.json.experiments[0].id, record.id)
  assert.ok(!('bundle' in listed.json.experiments[0]))
  const other = await call('', 'POST', { bundle: experimentFixture() }, COMPANY_B)
  assert.equal(other.status, 201)
  assert.notEqual(other.json.experiment.id, record.id)
  assert.equal(other.json.experiment.bundleSha256, record.bundleSha256)
})

test('[integration] reordered and concurrent duplicate imports reuse an immutable record', async () => {
  const bundle = experimentFixture()
  const results = await Promise.all(Array.from({ length: 6 }, () => call('', 'POST', { bundle })))
  assert.equal(results.filter((result) => result.status === 201).length, 1)
  assert.equal(results.filter((result) => result.json.duplicate).length, 5)
  assert.equal(new Set(results.map((result) => result.json.experiment.id)).size, 1)
  assert.equal(new Set(results.map((result) => result.json.experiment.importedAt)).size, 1)
  bundle.runs[0].parameters = Object.fromEntries(Object.entries(bundle.runs[0].parameters).reverse())
  const reordered = await call('', 'POST', { bundle })
  assert.equal(reordered.json.duplicate, true)
  assert.deepEqual(reordered.json.experiment, results[0].json.experiment)
  bundle.runs[0].results.accuracy = 0.9
  const changed = await call('', 'POST', { bundle })
  assert.equal(changed.status, 201)
  assert.notEqual(changed.json.experiment.id, reordered.json.experiment.id)
  assert.equal((await call(`/${reordered.json.experiment.id}`)).json.experiment.bundle.runs[0].results.accuracy, 0.75)
  assert.equal((await pool.query('SELECT id FROM experiment_bundles')).rows.length, 2)
})

test('[integration] malformed, oversized and tenant-injected imports leave no records', async () => {
  const invalid = experimentFixture()
  invalid.comparisons[0].rightRunId = 'missing'
  for (const body of [{ bundle: invalid }, { bundle: experimentFixture(), companyId: COMPANY_B }, { bundle: { ...experimentFixture(), arbitrary: {} } }]) {
    assert.equal((await call('', 'POST', body)).status, 400)
  }
  assert.equal((await call('', 'POST', { padding: 'x'.repeat(300 * 1024) })).status, 413)
  assert.equal((await pool.query('SELECT id FROM experiment_bundles')).rows.length, 0)
})

test('[integration] the database enforces company-scoped digest uniqueness and workspace cascade deletion', async () => {
  const created = await call('', 'POST', { bundle: experimentFixture() })
  const id = created.json.experiment.id
  await assert.rejects(() => pool.query(
    `INSERT INTO experiment_bundles (id, company_id, title, run_count, bundle_sha256, payload)
     SELECT 'duplicate-test-id', company_id, title, run_count, bundle_sha256, payload FROM experiment_bundles WHERE id = $1`, [id],
  ), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
  await assert.rejects(() => pool.query(
    `INSERT INTO experiment_bundles (id, company_id, title, run_count, bundle_sha256, payload)
     SELECT 'foreign-key-test-id', 'missing-company', title, run_count, bundle_sha256, payload FROM experiment_bundles WHERE id = $1`, [id],
  ), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23503')
  await pool.query(`DELETE FROM companies WHERE id = $1`, [COMPANY_A])
  assert.equal((await pool.query('SELECT id FROM experiment_bundles WHERE id = $1', [id])).rows.length, 0)
})

test('[integration] list returns the latest 100 records while older detail remains readable', async () => {
  const first = await call('', 'POST', { bundle: experimentFixture() })
  const record = first.json.experiment
  await pool.query(
    `INSERT INTO experiment_bundles (id, company_id, title, run_count, bundle_sha256, payload, imported_at)
     SELECT 'exp-list-' || n::text, $1, 'Record ' || n::text, 2, lpad(n::text, 64, '0'), $2::jsonb,
            NOW() + (n * INTERVAL '1 second') FROM generate_series(1, 101) AS n`,
    [COMPANY_A, JSON.stringify(record.bundle)],
  )
  const listed = await call()
  assert.equal(listed.json.experiments.length, 100)
  assert.equal(listed.json.experiments[0].title, 'Record 101')
  assert.ok(listed.json.experiments.every((item) => item.id !== record.id))
  assert.equal((await call(`/${record.id}`)).status, 200)
})


test('[integration] the committed Chongqing experiment imports unchanged and repeats idempotently', async () => {
  const bundle = JSON.parse(await readFile(new URL('../../../examples/experiments/chongqing-slope.json', import.meta.url), 'utf8'))
  const created = await call('', 'POST', { bundle })
  assert.equal(created.status, 201)
  assert.deepEqual(created.json.experiment.bundle, bundle)
  assert.equal(created.json.experiment.runCount, 2)
  assert.deepEqual((await call(`/${created.json.experiment.id}`)).json.experiment.bundle, bundle)
  const repeated = await call('', 'POST', { bundle })
  assert.equal(repeated.status, 200)
  assert.equal(repeated.json.duplicate, true)
  assert.equal(repeated.json.experiment.id, created.json.experiment.id)
})
