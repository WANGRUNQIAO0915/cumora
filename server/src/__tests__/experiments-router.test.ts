import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import express, { type NextFunction, type Request, type Response } from 'express'
import type { Pool } from 'pg'
import type { StoredExperiment } from '../../../shared/experiments.js'
import { createExperimentsRouter, EXPERIMENT_LIST_LIMIT } from '../api/experiments-router.js'
import { publicBodyParserError } from '../body-parser-errors.js'
import { experimentFixture } from './fixtures/experiment-bundle.js'

class AuthError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function harness() {
  const records: Array<StoredExperiment & { companyId: string }> = []
  const statements: string[] = []
  const pool = { query: async (sql: string, args: unknown[]) => {
    statements.push(sql)
    if (sql.startsWith('INSERT')) {
      const [id, companyId, title, runCount, bundleSha256, payload] = args as [string, string, string, number, string, string]
      assert.match(sql, /ON CONFLICT \(company_id, bundle_sha256\) DO NOTHING/)
      if (records.some((r) => r.companyId === companyId && r.bundleSha256 === bundleSha256)) return { rows: [] }
      const row = { id, companyId, title, runCount, bundleSha256, bundle: JSON.parse(payload), importedAt: new Date().toISOString() }
      records.push(row)
      const { companyId: _companyId, ...stored } = row
      return { rows: [stored] }
    }
    assert.match(sql, /WHERE .*company_id = \$[12]/)
    let found = records.filter((r) => {
      if (sql.includes('WHERE id = $1')) return r.id === args[0] && r.companyId === args[1]
      if (sql.includes('bundle_sha256 = $2')) return r.companyId === args[0] && r.bundleSha256 === args[1]
      assert.equal(args[1], EXPERIMENT_LIST_LIMIT)
      return r.companyId === args[0]
    })
    if (sql.includes('LIMIT')) found = found.slice(-EXPERIMENT_LIST_LIMIT).reverse()
    return { rows: found.map(({ companyId: _companyId, bundle, ...summary }) => sql.includes('payload AS bundle') ? { ...summary, bundle } : summary) }
  } } as unknown as Pick<Pool, 'query'>
  const app = express()
  app.use(express.json({ limit: '256kb' }))
  app.use('/api/experiments', createExperimentsRouter({ pool, requireCompany: async (req) => {
    if (req.headers.authorization !== 'Bearer test') throw new AuthError(401, 'authentication required')
    const companyId = req.header('x-company-id') ?? 'company-a'
    if (!['company-a', 'company-b'].includes(companyId)) throw new AuthError(403, 'not a member of this company')
    return { userId: 'test-user', companyId }
  } }))
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AuthError) { res.status(err.status).json({ error: err.message }); return }
    const bodyError = publicBodyParserError(err)
    if (bodyError) { res.status(bodyError.status).json({ error: bodyError.message }); return }
    res.status(500).json({ error: String(err) })
  })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    records, statements,
    call: async (path = '', method = 'GET', body?: unknown, companyId = 'company-a', authenticated = true) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/experiments${path}`, {
        method, headers: { 'content-type': 'application/json', 'x-company-id': companyId, ...(authenticated ? { authorization: 'Bearer test' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, json: await response.json() as { experiments: StoredExperiment[]; experiment: StoredExperiment; duplicate: boolean; error: string } }
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

test('experiment routes authenticate and validate membership before touching records', async () => {
  const h = await harness()
  try {
    for (const [path, method, body] of [['', 'GET', undefined], ['/exp-123', 'GET', undefined], ['', 'POST', { bundle: experimentFixture() }]] as const) {
      assert.equal((await h.call(path, method, body, 'company-a', false)).status, 401)
      assert.equal((await h.call(path, method, body, 'outsider')).status, 403)
    }
    assert.equal(h.statements.length, 0)
  } finally { await h.close() }
})

test('experiment import returns immutable metadata, tenant-scoped details, and idempotent duplicates', async () => {
  const h = await harness()
  try {
    const created = await h.call('', 'POST', { bundle: experimentFixture() })
    assert.equal(created.status, 201)
    assert.equal(created.json.duplicate, false)
    assert.match(created.json.experiment.id, /^exp-/)
    assert.match(created.json.experiment.bundleSha256, /^[a-f0-9]{64}$/)
    const id = created.json.experiment.id
    const duplicate = await h.call('', 'POST', { bundle: experimentFixture() })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.json.duplicate, true)
    assert.deepEqual(duplicate.json.experiment, created.json.experiment)
    assert.equal(h.records.length, 1)
    assert.deepEqual((await h.call(`/${id}`)).json.experiment, created.json.experiment)
    assert.equal((await h.call(`/${id}`, 'GET', undefined, 'company-b')).status, 404)
    assert.deepEqual((await h.call('', 'GET', undefined, 'company-b')).json.experiments, [])
    const second = await h.call('', 'POST', { bundle: experimentFixture() }, 'company-b')
    assert.equal(second.status, 201)
    assert.notEqual(second.json.experiment.id, id)
    assert.equal(second.json.experiment.bundleSha256, created.json.experiment.bundleSha256)
    assert.equal((await h.call('', 'GET')).json.experiments.length, 1)
    assert.ok(h.statements.every((sql) => !/\bUPDATE\b|\bDELETE\b/.test(sql)))
  } finally { await h.close() }
})

test('invalid or oversized imports persist nothing', async () => {
  const h = await harness()
  try {
    for (const body of [null, [], {}, { bundle: {} }, { bundle: experimentFixture(), companyId: 'company-b' }, { bundle: { ...experimentFixture(), secret: 'extra' } }]) {
      assert.equal((await h.call('', 'POST', body)).status, 400)
    }
    assert.equal((await h.call('', 'POST', { padding: 'x'.repeat(300 * 1024) })).status, 413)
    assert.equal(h.statements.length, 0)
    assert.equal(h.records.length, 0)
  } finally { await h.close() }
})

test('list caps newest summaries at 100 and malformed record IDs cannot reach storage', async () => {
  const h = await harness()
  try {
    for (let i = 0; i < 102; i++) {
      h.records.push({ id: `exp-${i}`, title: `Record ${i}`, companyId: 'company-a', runCount: 2, bundleSha256: 'a'.repeat(64), importedAt: new Date(i).toISOString(), bundle: experimentFixture() })
    }
    const listed = await h.call()
    assert.equal(listed.json.experiments.length, 100)
    assert.equal(listed.json.experiments[0].title, 'Record 101')
    assert.ok(listed.json.experiments.every((row) => !('bundle' in row) && !('companyId' in row)))
    const count = h.statements.length
    assert.equal((await h.call('/invalid-id')).status, 404)
    assert.equal(h.statements.length, count)
  } finally { await h.close() }
})
