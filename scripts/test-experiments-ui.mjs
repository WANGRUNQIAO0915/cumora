import { fileURLToPath } from 'node:url'
import path from 'node:path'
// Optional DOM test dependency stays outside the application dependency graph.
const { JSDOM } = await import(process.argv[2] || 'jsdom')
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { strict as assert } from 'node:assert'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(await readFile(root+'/examples/experiments/chongqing-slope.json','utf8'))
const dom = new JSDOM('<!doctype html><div id="root"></div>', {url:'http://test.invalid',runScripts:'dangerously',pretendToBeVisual:true})
dom.window.TextEncoder=TextEncoder
dom.window.ResizeObserver=class {observe(){} disconnect(){}}
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
dom.window.fetch=()=>{throw new Error('Unexpected network request')}
const source = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ExperimentWorkspace, ExperimentWorkspaceContent} from './src/components/ExperimentWorkspace'; import {useAuth} from './src/stores/auth'; window.mountPreview=(client)=>{window.__testRoot??=createRoot(document.getElementById('root'));window.__testRoot.render(<ExperimentWorkspaceContent client={client} workspaceName="Test workspace"/>)}; window.setTestAuth=(company)=>useAuth.setState({user: {id:'test-user'},activeCompanyId:company,companies:[{id:'a',name:'Workspace A'},{id:'b',name:'Workspace B'}]}); window.mountAuthed=()=>{window.__testRoot=createRoot(document.getElementById('root'));window.__testRoot.render(<ExperimentWorkspace/>)};`
const built=await build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':root+'/src'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},loader:{'.css':'empty'},logLevel:'silent'})
dom.window.eval(built.outputFiles[0].text)
const wait=()=>new Promise(r=>setTimeout(r,35))
const click=(el)=>el.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}))
const text=()=>dom.window.document.body.textContent
const buttons=()=>[...dom.window.document.querySelectorAll('button')]
const button=(name)=>buttons().find(e=>e.textContent===name)
const record={id:'exp-test',title:fixture.title,bundle:fixture,runCount:2,importedAt:'2026-10-07T10:00:00Z',bundleSha256:'a'.repeat(64)}
let listResolve; let imports=0
const client={list:()=>new Promise(r=>{listResolve=r}),get:async()=>({experiment:record}),import:async()=>{imports++; return {experiment:record,duplicate:imports>1}}}
dom.window.mountPreview(client); await wait()
// Select/confirm a file before the pending initial list returns.
const input=dom.window.document.querySelector('input[type=file]')
Object.defineProperty(input,'files',{configurable:true,value:[{name:'real.json',size:12584,text:async()=>JSON.stringify(fixture)}]})
input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await wait()
assert.match(text(),/Review import/);assert.match(text(),/workspace members can read/)
click(button('Cancel'));await wait(); assert.doesNotMatch(text(),/Review import/); assert.equal(imports,0)
input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await wait();click(button('Import into workspace'));await wait(); await wait()
assert.equal(imports,1); assert.match(text(),/Run record/)
listResolve({experiments:[]});await wait(); assert.match(text(),/Horn · 100 m/);assert.match(text(),/Run record/)
console.log('PASS preview, cancel, import, and stale pre-import list race')
const tabs=[...dom.window.document.querySelectorAll('[role=tab]')]
click(tabs[1]);await wait();assert.match(text(),/289b8e5d59786/)
tabs[1].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));await wait();assert.equal(dom.window.document.activeElement.id,'experiment-tab-logs');assert.match(text(),/stdout/)
console.log('PASS fingerprints, keyboard End navigation and logs')
for (const checkbox of dom.window.document.querySelectorAll('input[type=checkbox]')) click(checkbox)
await wait();click(button('Compare runs (2/2)'));await wait();assert.match(text(),/Same recorded input hashes/);assert.match(text(),/Imported pairwise evidence/);assert.match(text(),/1.42336520599818/)
click(button('Back to run'));await wait();assert.match(text(),/Run record/)
console.log('PASS two-run comparison, recorded pairwise evidence, and Back')
input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await wait();click(button('Import into workspace'));await wait();assert.equal(imports,2);assert.match(text(),/already saved/)
Object.defineProperty(input,'files',{configurable:true,value:[{name:'bad.json',size:10,text:async()=>'{bad'}]});input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await wait();assert.ok(dom.window.document.querySelector('[role=alert]'));assert.equal(imports,2)
console.log('PASS duplicate import and malformed JSON without upload')
// Component cleanup also invalidates outstanding list and file-read operations.
dom.window.__testRoot.unmount();await wait()
let resolveOldDetail
const response=(body)=>({ok:true,status:200,json:async()=>body})
dom.window.fetch=async(url,init)=>{
  const company=init.headers['x-company-id']
  if(url==='/api/experiments') return response({experiments:company==='a'?[record]:[]})
  return new Promise(resolve=>{resolveOldDetail=()=>resolve(response({experiment:record}))})
}
dom.window.setTestAuth('a');dom.window.mountAuthed();await wait();await wait()
assert.ok(resolveOldDetail)
dom.window.setTestAuth('b');await wait();resolveOldDetail();await wait()
assert.doesNotMatch(text(),/Horn · 100 m/);assert.match(text(),/Every experiment deserves a record/)
console.log('PASS workspace switch clears old data and discards delayed old detail')
dom.window.__testRoot.unmount();await wait();dom.window.close()
console.log('All component DOM checks passed (jsdom; not browser layout validation).')
