/** Development-only UI harness. It never signs in, stores records remotely, or executes runs. */
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { ExperimentWorkspaceContent } from '../src/components/ExperimentWorkspace'
import { parseExperimentBundle } from '../shared/experiment-validation'
import type { ExperimentBundle, StoredExperiment } from '../shared/experiments'
import type { ExperimentsApi } from '../src/api/experiments'
import { useLocaleStore } from '../src/lib/i18n'
import fixture from '../examples/experiments/chongqing-slope.json'
import '../src/styles/globals.css'

const bundle = parseExperimentBundle(fixture)
const digest = async (value: ExperimentBundle) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))).map((n) => n.toString(16).padStart(2, '0')).join('')
const seed: StoredExperiment = { id: 'exp-preview', title: bundle.title, bundle, runCount: bundle.runs.length, importedAt: '2026-10-07T10:00:00Z', bundleSha256: await digest(bundle) }
function makeClient(empty: boolean, failure: boolean): ExperimentsApi {
  let records = empty ? [] : [seed]
  return {
    async list() { if (failure) throw new Error('Preview: simulated network failure'); return { experiments: records } },
    async get(id) { const experiment = records.find((e) => e.id === id); if (!experiment) throw new Error('Preview: not found'); return { experiment } },
    async import(input) {
      const normalized = parseExperimentBundle(input)
      const hash = await digest(normalized)
      const existing = records.find((e) => e.bundleSha256 === hash)
      if (existing) return { experiment: existing, duplicate: true }
      const experiment = { id: `exp-preview-${records.length}`, title: normalized.title, runCount: normalized.runs.length, importedAt: new Date().toISOString(), bundleSha256: hash, bundle: normalized }
      records = [experiment, ...records]
      return { experiment, duplicate: false }
    },
  }
}
function Preview() {
  const [mode, setMode] = useState<'records' | 'empty' | 'error'>('records')
  const [client, setClient] = useState(() => makeClient(false, false))
  const locale = useLocaleStore((s) => s.locale)
  function reset(next: typeof mode) { setMode(next); setClient(makeClient(next === 'empty', next === 'error')) }
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ background: '#152c3e', color: '#e5eef6', padding: '9px 20px', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 11 }}>
      <strong>CUMORA · DEVELOPMENT PREVIEW</strong><span>Real archived slope records · in-memory UI adapter · no server writes</span>
      <button type="button" onClick={() => reset('records')}>Records</button><button type="button" onClick={() => reset('empty')}>Empty</button><button type="button" onClick={() => reset('error')}>Error</button><button type="button" onClick={() => useLocaleStore.getState().setLocale(locale === 'en' ? 'zh-CN' : 'en')}>EN / 中文</button>
    </div>
    <div style={{ flex: 1, minHeight: 0 }}><ExperimentWorkspaceContent key={mode} client={client} workspaceName="Development preview (not saved)" /></div>
  </div>
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Preview />)
else document.getElementById('root')!.textContent = 'This preview is available only through the Vite development server.'
