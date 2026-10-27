import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { computeErrorRate, validateThermalRecord, buildThermalCharts } from '../src/lib/thermal.js'
import { parseModelPickles, readTracePickles } from '../src/lib/pickle.js'
import { validateModelTraces, computeConfusionMatrix, parsePredictionsJSON } from '../src/lib/modelAnalysis.js'
import { parseMapCountFile, computeDistributionStats, buildComparisonHistogram } from '../src/lib/locationAnalysis.js'
import { readHosts, normalizeHosts, rememberHost } from '../src/lib/hostHistory.js'
import { computeReadiness } from '../src/lib/readiness.js'

const result = computeErrorRate('01001101', '01011101')
assert.equal(result.editDistance, 1)
assert.equal(result.mismatchRatio, 12.5)
assert.equal(computeErrorRate('101', '10').mismatchRatio, null)
assert.equal(computeErrorRate('1', '0000').editRatio, 400)
assert.ok(computeErrorRate('bad', '01').error)
assert.throws(() => computeErrorRate('0'.repeat(2049), '1'))
console.log('PASS bit records: substitutions, insertions/deletions, unequal lengths, invalid input and bounded work')

const fixtures = JSON.parse(execFileSync('python3', ['-c', `
import pickle,base64,json
records=[([[1,2.5,2**40]],'resnet18'),([6,5,4],'模型B')]
encode=lambda value:base64.b64encode(value).decode()
output={str(p):encode(b''.join(pickle.dumps(r,protocol=p) for r in records)) for p in range(2,6)}
output['nan']=encode(pickle.dumps(([float('nan')],'bad'),protocol=4))
a=[];a.append(a)
output['cycle']=encode(pickle.dumps((a,'cycle'),protocol=4))
print(json.dumps(output))
`], { encoding: 'utf8' }))
const buffer = (encoded) => Uint8Array.from(Buffer.from(encoded, 'base64')).buffer
for (const protocol of ['2', '3', '4', '5']) {
  const decoded = parseModelPickles(buffer(fixtures[protocol]))
  assert.equal(decoded.traces.length, 2)
  assert.equal(decoded.traces[0].label, 'resnet18')
  assert.equal(decoded.traces[0].samples[1], 2.5)
  assert.equal(decoded.traces[0].samples[2], 2 ** 40)
  assert.equal(decoded.traces[1].label, '模型B')
  assert.ok(parseModelPickles(buffer(fixtures[protocol]).slice(0, -1)).error)
}
assert.ok(parseModelPickles(buffer(fixtures.nan)).error)
assert.ok(parseModelPickles(buffer(fixtures.cycle)).error)
assert.throws(() => readTracePickles(new TextEncoder().encode('cos\nsystem\n.').buffer))
assert.throws(() => readTracePickles(new Uint8Array([0x80, 4, 0x52]).buffer))
assert.ok(validateModelTraces([]).error)
assert.ok(validateModelTraces([{ samples: [1] }]).error)
assert.ok(validateModelTraces([{ label: 'a', samples: [] }]).error)
assert.ok(validateModelTraces([{ label: 'a', samples: [true] }]).error)
assert.ok(validateModelTraces([{ label: 'a', samples: [Infinity] }]).error)
console.log('PASS genuine Python pickle protocols 2–5: labels and values preserved; executable opcodes, cycles and malformed data refused')

const prediction = [{ actual: 'A', predicted: 'A' }, { actual: 'B', predicted: 'A' }, { actual: 'B', predicted: 'B' }]
const matrix = computeConfusionMatrix(prediction)
assert.equal(matrix.correct, 2)
assert.equal(matrix.total, 3)
assert.equal(matrix.matrix.B.A, 1)
assert.ok(Math.abs(matrix.accuracy - 200 / 3) < 1e-10)
assert.equal(computeConfusionMatrix([]), null)
assert.throws(() => computeConfusionMatrix([...prediction, {}]))
assert.ok(parsePredictionsJSON('{"predictions":[{"actual":42,"predicted":"A"}]}').error)
assert.equal(computeConfusionMatrix([{ actual: '__proto__', predicted: '__proto__' }, { actual: 'constructor', predicted: 'constructor' }]).correct, 2)
console.log('PASS prediction statistics: no fabricated accuracy, malformed rows refused, prototype-like labels handled as data')

const record = () => ({ version: 1, source: 'thermal-observation', startedAt: '2026-10-24T06:00:00Z', durationSeconds: 2, intervalSeconds: 1, sources: [{ id: 'temp', label: 'Test sensor', kind: 'temperature', unit: '°C', path: '/test/temp' }, { id: 'trm', label: 'Test event counter', kind: 'trm', unit: 'events/interval', path: '/test/TRM' }], samples: [{ seconds: 0.001, values: { temp: 42, trm: null } }, { seconds: 1.002, values: { temp: null, trm: 0 } }, { seconds: 2.001, values: { temp: 43, trm: null } }], resets: [{ sourceId: 'trm', seconds: 2.001 }] })
assert.deepEqual(validateThermalRecord(record()), { ok: true })
assert.equal(buildThermalCharts(record()).eventData[0].trm, null)
assert.equal(buildThermalCharts(record()).eventData[1].trm, 0)
for (const corrupt of [
  (r) => { r.samples = [] }, (r) => { r.sources = [] },
  (r) => { r.sources[0].unit = 'K' }, (r) => { r.samples[1].seconds = Infinity },
  (r) => { r.samples[1].seconds = r.samples[0].seconds },
  (r) => { r.samples[1].values.trm = -1 }, (r) => { r.samples[1].values.trm = 1.5 },
  (r) => { delete r.samples[1].values.temp }, (r) => { r.sources[1].id = 'temp' },
  (r) => { r.resets[0].sourceId = 'temp' }, (r) => { r.resets = {} },
]) { const invalid = record(); corrupt(invalid); assert.ok(validateThermalRecord(invalid).error) }
console.log('PASS thermal data contract: source units, timestamps, missing values and resets remain distinct from observed zero')

assert.deepEqual(parseMapCountFile('10\n11\n12\n13\n14').values, [10, 11, 12, 13, 14])
for (const input of ['', '-1', 'NaN', 'Infinity', '1.5', '0x10', '1e3', '9007199254740992']) assert.ok(parseMapCountFile(input).error)
assert.equal(computeDistributionStats([10, 11, 12, 13, 14]).median, 12)
assert.equal(computeDistributionStats([2, 3, 4, 5]).median, 3.5)
const histogram = buildComparisonHistogram([10, 11, 12, 13, 14], [2, 3, 4, 5])
assert.equal(histogram.reduce((n, row) => n + row.map, 0), 5)
assert.equal(histogram.reduce((n, row) => n + row.unmap, 0), 4)
for (const row of histogram) if (row.range.includes('–')) { const [lo, hi] = row.range.split('–').map(Number); assert.ok(hi >= lo) }
const disjoint = buildComparisonHistogram([100, 101], [1, 2])
assert.equal(disjoint.filter((row) => row.map && row.unmap).length, 0)
console.log('PASS position distributions: unequal groups, common bins, real sample totals and invalid counts')

assert.deepEqual(readHosts({ getItem: () => '{broken' }), [])
assert.deepEqual(readHosts({ getItem: () => '{"password":"not-history"}' }), [])
assert.deepEqual(normalizeHosts([' a ', 'a', null, {}, 'bad host']), ['a'])
assert.equal(normalizeHosts(Array.from({ length: 12 }, (_, i) => `host-${i}`)).length, 8)
assert.deepEqual(rememberHost(['a', 'b'], 'b'), ['b', 'a'])
const facts = { KERNEL: 'Linux 5.15', ARCH: 'x86_64', VENDOR: 'GenuineIntel', PYTHON3: 'present', TEMPERATURE: 'present', TRM: 'missing', THROTTLE: 'missing' }
assert.equal(computeReadiness(facts).canStart, true)
assert.equal(computeReadiness({ ...facts, ARCH: 'arm64' }).canStart, false)
assert.equal(computeReadiness({ ...facts, TEMPERATURE: 'missing' }).canStart, false)
assert.equal(computeReadiness(null).score, 0)
console.log('PASS address-only history and shared readiness against actual backend field values')
