import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { comparisonRows, sameFingerprints, experimentValueText } from '../src/lib/experiment-comparison.js'

test('fingerprints compare multisets of SHA-256 values independently of names and order', () => {
  assert.equal(sameFingerprints([{name:'a',sha256:'A'},{name:'b',sha256:'b'}], [{name:'x',sha256:'B'},{name:'y',sha256:'a'}]), true)
  assert.equal(sameFingerprints([], []), false)
  assert.equal(sameFingerprints([{name:'a',sha256:'a'}], [{name:'a',sha256:'a'},{name:'a',sha256:'a'}]), false)
})
test('comparison joins fields and only computes numeric right-minus-left summary deltas', () => {
  assert.deepEqual(comparisonRows({mean:2,algorithm:'Horn',missing:null}, {mean:3,algorithm:'ZT',extra:false}), [
    {key:'mean',left:2,right:3,changed:true,delta:1},
    {key:'algorithm',left:'Horn',right:'ZT',changed:true,delta:null},
    {key:'missing',left:null,right:undefined,changed:true,delta:null},
    {key:'extra',left:undefined,right:false,changed:true,delta:null},
  ])
})

test('scientific values remain exact rather than rounding to false zero', () => {
  assert.equal(experimentValueText(1e-9), '1e-9')
  assert.equal(experimentValueText(2e-9), '2e-9')
  assert.equal(experimentValueText(14.389192582967581), '14.389192582967581')
})
test('prototype-named metrics are missing unless owned; overflowing deltas are unavailable', () => {
  assert.deepEqual(comparisonRows({toString: 2}, {}), [{key:'toString',left:2,right:undefined,changed:true,delta:null}])
  assert.equal(comparisonRows({x:-1e308}, {x:1e308})[0].delta, null)
})
