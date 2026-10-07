import { useEffect, useRef, useState } from 'react'
import type { ExperimentBundle, ExperimentFile, ExperimentRun, ExperimentSummary, ExperimentValue, StoredExperiment } from '../../shared/experiments'
import { parseExperimentBundle } from '../../shared/experiment-validation'
import { experimentsApi, type ExperimentsApi } from '@/api/experiments'
import { useAuth } from '@/stores/auth'
import { useT } from '@/lib/i18n'
import { comparisonRows, sameFingerprints, experimentValueText as valueText } from '@/lib/experiment-comparison'
import { cn } from '@/lib/utils'
import '@/styles/experiments.css'

type Tab = 'results' | 'inputs' | 'parameters' | 'logs'

function dateText(value: string) { return new Date(value).toLocaleString(undefined, { timeZone: 'UTC', hour12: false }) + ' UTC' }
function Button({ children, onClick, disabled, primary = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={cn('experiment-button', primary && 'experiment-primary')}>{children}</button>
}
function Values({ values }: { values: Record<string, ExperimentValue> }) {
  return <dl className="experiment-values">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{valueText(value)}</dd></div>)}</dl>
}
function Files({ files }: { files: ExperimentFile[] }) {
  const t = useT()
  return <div className="experiment-files">{files.map((file, index) => <div className="experiment-file" key={`${file.name}-${index}`}><strong>{file.name}</strong>{file.sizeBytes !== undefined && <span>{file.sizeBytes.toLocaleString()} {t('experiment.bytes')}</span>}<code>SHA-256 {file.sha256}</code></div>)}</div>
}

/** The key drops every in-memory record, selection and pending file on account/workspace changes. */
export function ExperimentWorkspace() {
  const companyId = useAuth((s) => s.activeCompanyId)
  const userId = useAuth((s) => s.user?.id)
  const companyName = useAuth((s) => s.companies.find((c) => c.id === s.activeCompanyId)?.name)
  if (!companyId || !userId) return null
  return <ExperimentWorkspaceContent key={`${userId}:${companyId}`} client={experimentsApi} workspaceName={companyName ?? companyId} />
}

/** Same real UI can be exercised with an explicitly labelled development-only adapter. */
export function ExperimentWorkspaceContent({ client, workspaceName }: { client: ExperimentsApi; workspaceName: string }) {
  const t = useT()
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [record, setRecord] = useState<StoredExperiment | null>(null)
  const [runId, setRunId] = useState('')
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [tab, setTab] = useState<Tab>('results')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<{ name: string; bundle: ExperimentBundle } | null>(null)
  const [importing, setImporting] = useState(false)
  const [readingFile, setReadingFile] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const request = useRef(0)
  const fileRequest = useRef(0)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; fileRequest.current++ } }, [])

  async function loadList() {
    const version = ++request.current
    setLoading(true); setError('')
    try {
      const response = await client.list()
      if (!mounted.current || request.current !== version) return
      setExperiments(response.experiments)
      setSelectedId((previous) => response.experiments.some((e) => e.id === previous) ? previous : response.experiments[0]?.id ?? '')
    } catch (e) {
      if (mounted.current && request.current === version) setError(e instanceof Error ? e.message : t('experiment.loadFailed'))
    } finally {
      if (mounted.current && request.current === version) setLoading(false)
    }
  }
  useEffect(() => { void loadList() }, [client])

  useEffect(() => {
    if (!selectedId) { setRecord(null); return }
    let cancelled = false
    setRecord(null); setLoading(true); setError(''); setComparing(false); setCompareIds([]); setTab('results')
    void client.get(selectedId).then(({ experiment }) => {
      if (cancelled) return
      setRecord(experiment); setRunId(experiment.bundle.runs[0]?.id ?? '')
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : t('experiment.loadFailed'))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [client, selectedId])

  async function chooseFile(file?: File) {
    if (!file) return
    const version = ++fileRequest.current
    setPending(null); setError(''); setNotice(''); setReadingFile(true)
    try {
      // Reserve room for the enclosing API envelope under the server's 256 KiB parser.
      if (file.size > 240 * 1024) throw new Error(t('experiment.tooLarge'))
      const bundle = parseExperimentBundle(JSON.parse(await file.text()))
      if (mounted.current && fileRequest.current === version) setPending({ name: file.name, bundle })
    } catch (e) {
      if (mounted.current && fileRequest.current === version) setError(e instanceof Error ? e.message : t('experiment.invalidFile'))
    } finally {
      if (mounted.current && fileRequest.current === version) setReadingFile(false)
    }
  }
  async function importPending() {
    if (!pending || importing) return
    setImporting(true); setError('')
    try {
      const { experiment, duplicate } = await client.import(pending.bundle)
      if (!mounted.current) return
      // A pre-import list snapshot must never hide a newly saved record.
      request.current++; setLoading(false)
      setExperiments((previous) => [experiment, ...previous.filter((e) => e.id !== experiment.id)])
      setPending(null); setSelectedId(experiment.id); setRecord(experiment)
      setRunId(experiment.bundle.runs[0]?.id ?? ''); setCompareIds([]); setComparing(false)
      setNotice(t(duplicate ? 'experiment.duplicate' : 'experiment.imported'))
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : t('experiment.importFailed'))
    } finally { if (mounted.current) setImporting(false) }
  }
  const run = record?.bundle.runs.find((r) => r.id === runId)
  const compared = compareIds.map((id) => record?.bundle.runs.find((r) => r.id === id)).filter((r): r is ExperimentRun => Boolean(r))
  return <section className="experiment-workspace">
    <header className="experiment-header">
      <div><div className="experiment-eyebrow">{t('experiment.eyebrow')}</div><h1>{t('nav.experiments')}</h1><p>{t('experiment.subtitle')}</p></div>
      <div className="experiment-actions"><Button onClick={() => void loadList()} disabled={loading || importing}>{t('experiment.refresh')}</Button><Button primary onClick={() => inputRef.current?.click()} disabled={importing || readingFile}>{t(readingFile ? 'experiment.reading' : 'experiment.import')}</Button></div>
      <input ref={inputRef} type="file" accept=".json,application/json" hidden aria-label={t('experiment.chooseFile')} onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = '' }} />
    </header>
    <div className="experiment-scroll">
      {error && <div className="experiment-alert experiment-error" role="alert">{error}<Button onClick={() => { setError(''); if (!pending) { setSelectedId(''); void loadList() } }}>{t('experiment.retry')}</Button></div>}
      {notice && <div className="experiment-alert" role="status">{notice}</div>}
      {pending && <section className="experiment-import" aria-label={t('experiment.reviewImport')}><div className="experiment-eyebrow">{t('experiment.reviewImport')}</div><h2>{pending.bundle.title}</h2><p>{pending.name} · {pending.bundle.runs.length} {t('experiment.runs')}</p><p>{t('experiment.shareWarning', { workspace: workspaceName })}</p><div className="experiment-actions"><Button onClick={() => setPending(null)} disabled={importing}>{t('common.cancel')}</Button><Button primary onClick={() => void importPending()} disabled={importing}>{t(importing ? 'experiment.importing' : 'experiment.confirmImport')}</Button></div></section>}
      {experiments.length > 0 && <div className="experiment-picker"><label htmlFor="experiment-select">{t('experiment.collection')}</label><select id="experiment-select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={importing}>{experiments.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select><span>{t('experiment.listLimit')}</span></div>}
      {loading && !record && <div className="experiment-empty" role="status">{t('common.loading')}</div>}
      {!loading && !record && !error && <div className="experiment-empty"><div className="experiment-empty-icon">◇</div><h2>{t('experiment.empty')}</h2><p>{t('experiment.emptyHint')}</p><p>{t('experiment.noExecution')}</p><Button primary onClick={() => inputRef.current?.click()}>{t('experiment.import')}</Button></div>}
      {record && <>
        <div className="experiment-collection"><div><h2>{record.bundle.title}</h2><p>{record.bundle.description}</p></div><span className="experiment-badge">{record.bundle.runs.length} {t('experiment.recordedRuns')}</span></div>
        <div className="experiment-layout"><aside className="experiment-runlist"><div className="experiment-runlist-heading"><h3>{t('experiment.runs')}</h3><span>{t('experiment.pickTwo')}</span></div>{record.bundle.runs.map((item) => <div key={item.id} className={cn('experiment-runrow', runId === item.id && !comparing && 'experiment-selected')}><button type="button" className="experiment-runbutton" onClick={() => { setRunId(item.id); setComparing(false); setTab('results') }}><span className={cn('experiment-status-dot', item.status === 'failed' && 'experiment-failed')} /><strong>{item.label}</strong><small>{t(item.status === 'succeeded' ? 'experiment.succeeded' : 'experiment.failed')}</small><time>{dateText(item.startedAt)}</time></button><input type="checkbox" aria-label={`${t('experiment.selectCompare')} ${item.label}`} checked={compareIds.includes(item.id)} disabled={compareIds.length === 2 && !compareIds.includes(item.id)} onChange={(e) => { setComparing(false); setCompareIds((previous) => e.target.checked ? [...previous, item.id].slice(0, 2) : previous.filter((id) => id !== item.id)) }} /></div>)}<Button primary disabled={compared.length !== 2} onClick={() => setComparing(true)}>{t('experiment.compare')} ({compareIds.length}/2)</Button><p className="experiment-muted">{t('experiment.noExecution')}</p></aside>
          <main className="experiment-main">{comparing && compared.length === 2 ? <CompareRuns left={compared[0]} right={compared[1]} bundle={record.bundle} onBack={() => setComparing(false)} /> : run && <>
            <div className="experiment-detail-heading"><div><span className="experiment-eyebrow">{t('experiment.recordedRun')}</span><h2>{run.label}</h2><code>{run.id}</code></div><span className={cn('experiment-badge', run.status === 'failed' && 'experiment-badge-failed')}>{t(run.status === 'succeeded' ? 'experiment.succeeded' : 'experiment.failed')}</span></div>
            <div className="experiment-tabs" role="tablist" aria-label={t('experiment.details')}>{(['results', 'inputs', 'parameters', 'logs'] as const).map((key) => <button type="button" key={key} role="tab" id={`experiment-tab-${key}`} aria-controls={`experiment-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onKeyDown={(event) => { const tabs: Tab[] = ['results', 'inputs', 'parameters', 'logs']; const index = tabs.indexOf(key); const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null; if (next) { event.preventDefault(); setTab(next); document.getElementById(`experiment-tab-${next}`)?.focus() } }} onClick={() => setTab(key)}>{t(`experiment.${key}`)}</button>)}</div>
            <div className="experiment-panel" role="tabpanel" id={`experiment-panel-${tab}`} aria-labelledby={`experiment-tab-${tab}`}>
              {tab === 'results' && <><h3>{t('experiment.recordedMetrics')}</h3><Values values={run.results} /><h3>{t('experiment.outputs')}</h3><Files files={run.outputs} /><p className="experiment-muted">{t('experiment.referencesOnly')}</p><Notes notes={run.notes} /></>}
              {tab === 'inputs' && <><h3>{t('experiment.inputs')}</h3><Files files={run.inputs} /><h3>{t('experiment.code')}</h3><Files files={[run.code]} /><p className="experiment-muted">{t('experiment.hashHint')}</p><h3>{t('experiment.provenance')}</h3><Notes notes={record.bundle.provenance} /></>}
              {tab === 'parameters' && <><h3>{t('experiment.parameters')}</h3><Values values={run.parameters} /><h3>{t('experiment.environment')}</h3><Values values={run.environment} /><h3>{t('experiment.command')}</h3><pre>{run.command.join(' ')}</pre><p className="experiment-muted">{t('experiment.commandHint')}</p></>}
              {tab === 'logs' && <><div className="experiment-timing"><span>{t('experiment.started')}: {dateText(run.startedAt)}</span><span>{t('experiment.finished')}: {dateText(run.finishedAt)}</span><span>{t('experiment.exitCode')}: {run.logs.exitCode}</span></div><h3>stdout</h3><pre>{run.logs.stdout || t('experiment.emptyLog')}</pre><h3>stderr</h3><pre>{run.logs.stderr || t('experiment.emptyLog')}</pre></>}
            </div>
          </>}</main></div>
        <footer className="experiment-footer"><span>{t('experiment.importedAt')}: {dateText(record.importedAt)}</span><code>{t('experiment.bundleHash')}: {record.bundleSha256}</code></footer>
      </>}
    </div>
  </section>
}

function Notes({ notes }: { notes: string[] }) {
  return notes.length > 0 ? <ul className="experiment-notes">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : null
}
function CompareRuns({ left, right, bundle, onBack }: { left: ExperimentRun; right: ExperimentRun; bundle: ExperimentBundle; onBack: () => void }) {
  const t = useT()
  const evidence = bundle.comparisons.filter((c) => (c.leftRunId === left.id && c.rightRunId === right.id) || (c.leftRunId === right.id && c.rightRunId === left.id))
  return <>
    <div className="experiment-detail-heading"><div><div className="experiment-eyebrow">{t('experiment.comparison')}</div><h2>{left.label} <span className="experiment-muted">/</span> {right.label}</h2></div><Button onClick={onBack}>{t('experiment.back')}</Button></div>
    <div className="experiment-panel">
      <div className="experiment-comparison-checks"><span className="experiment-badge">{t(sameFingerprints(left.inputs, right.inputs) ? 'experiment.sameInput' : 'experiment.differentInput')}</span><span className="experiment-badge">{t(left.code.sha256 === right.code.sha256 ? 'experiment.sameCode' : 'experiment.differentCode')}</span></div>
      <p className="experiment-muted">{t('experiment.compareHint')}</p>
      <h3>{t('experiment.parameters')}</h3><CompareTable left={left.parameters} right={right.parameters} labels={[left.label, right.label]} />
      <h3>{t('experiment.recordedMetrics')}</h3><CompareTable left={left.results} right={right.results} labels={[left.label, right.label]} deltas />
      <h3>{t('experiment.environment')}</h3><CompareTable left={left.environment} right={right.environment} labels={[left.label, right.label]} />
      {evidence.length > 0 ? evidence.map((evidence, index) => <div className="experiment-evidence" key={index}><div className="experiment-eyebrow">{t('experiment.importedEvidence')}</div><h3>{evidence.label}</h3><p className="experiment-muted">{t('experiment.evidenceDirection')}: {evidence.leftRunId} → {evidence.rightRunId}</p><Values values={evidence.metrics} /><Notes notes={evidence.notes} /></div>) : <p className="experiment-muted">{t('experiment.noPairEvidence')}</p>}
    </div>
  </>
}
function CompareTable({ left, right, labels, deltas = false }: { left: Record<string, ExperimentValue>; right: Record<string, ExperimentValue>; labels: [string, string]; deltas?: boolean }) {
  const t = useT()
  return <div className="experiment-table-scroll"><table className="experiment-table"><thead><tr><th scope="col">{t('experiment.field')}</th><th scope="col">{labels[0]}</th><th scope="col">{labels[1]}</th>{deltas && <th scope="col">{t('experiment.delta')}</th>}</tr></thead><tbody>{comparisonRows(left, right).map((row) => <tr key={row.key} className={row.changed ? 'experiment-changed' : undefined}><th scope="row">{row.key}{row.changed && <small>{t('experiment.changed')}</small>}</th><td>{valueText(row.left)}</td><td>{valueText(row.right)}</td>{deltas && <td>{row.delta === null ? '—' : `${row.delta > 0 ? '+' : ''}${valueText(row.delta)}`}</td>}</tr>)}</tbody></table></div>
}
