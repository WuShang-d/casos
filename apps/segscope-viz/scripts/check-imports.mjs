import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { parseE1Records, parseE1Report, parseE2Log, parseE3Result, parseE4TSV, importResults } from '../src/lib/parse.js'
import { readTracePickles } from '../src/lib/pickle.js'

const fixtures = JSON.parse(execFileSync('python3', ['-c', `
import pickle, base64, json
records = [([[1, 2.5, 2**40, 0]], 'example.org'), ([4, 5, 6], '测试.example')]
print(json.dumps({str(p): base64.b64encode(b''.join(pickle.dumps(r, protocol=p) for r in records)).decode() for p in range(2, 6)}))
`], { encoding: 'utf8' }))
const buffer = (s) => Uint8Array.from(Buffer.from(s, 'base64')).buffer
for (const [protocol, encoded] of Object.entries(fixtures)) {
  const traces = parseE1Records(readTracePickles(buffer(encoded)))
  assert.equal(traces.length, 2, `pickle protocol ${protocol}`)
  assert.equal(traces[0].samples[2], 2 ** 40)
  assert.equal(traces[1].site, '测试.example')
  assert.throws(() => readTracePickles(buffer(encoded).slice(0, -1)))
}
assert.throws(() => readTracePickles(new TextEncoder().encode('cos\nsystem\n.').buffer), /不支持/)
assert.throws(() => parseE1Records([[[NaN], 'site']]))
assert.throws(() => parseE1Records([[[true], 'site']]))
assert.deepEqual(parseE1Report('top1 accuracy: 85.3% (+/- 5.5%)\ntop5 accuracy: 100.0%'), { top1: 85.3, top5: 100 })
assert.throws(() => parseE1Report('top1 accuracy: 110%'))
assert.throws(() => parseE1Report('nothing'))
const csv = '100000,0.559,53889,51200.8,irq=750 ,after_filter:0.098'
assert.equal(parseE2Log(csv)[0].after, 0.098)
for (const invalid of [csv.replace('0.559', 'Infinity'), csv.replace('0.559', ''), csv.replace('0.098', '-0.1'), csv.replace('53889', 'oops'), csv.replace('irq=750', 'irq=-2'), csv + '\nbroken']) assert.throws(() => parseE2Log(invalid))
assert.equal(parseE2Log(csv + '\n' + csv.replace('100000', '93000'))[0].timeout, 93000)
const scores = Array.from({ length: 512 }, (_, i) => i === 42 ? 999 : 1)
assert.equal(parseE3Result(scores.join('\n')).top5[0].offset, 42)
assert.deepEqual(parseE3Result(scores.join('\n')).top5.map((r) => r.offset), [42, 0, 1, 2, 3])
assert.throws(() => parseE3Result(scores.slice(1).join('\n')))
assert.throws(() => parseE3Result(scores.join('\n').replace('999', 'NaN')))
const header = 'case\tlibrary\tversion\talgorithm\toverhead_pct\tbin_size_base\tbin_size_inst\tfunc_overhead_pct\trc\trc_base\tlog'
const tsv = header + '\ncase1\tmbedtls\t3.6.1\tAES\t-2.5\t100\t120\t-\t0\t0\t'
const row = parseE4TSV(tsv).rows[0]
assert.equal(row.bloat, 20)
assert.equal(row.overhead, -2.5)
assert.equal(row.funcOverhead, null)
assert.equal(row.valid, true)
assert.equal(parseE4TSV(tsv.replace('\t0\t0\t', '\t1\t0\t')).rows[0].valid, false)
assert.equal(parseE4TSV(tsv.replace('\t100\t120', '\t0\t120')).rows[0].bloat, null)
const manifest = 'variant\tinstr_mode\trepeat_id\tstatus\tresult_tsv\nnone\tbranch\t1\tok\t/tmp/known_cases_results.tsv'
assert.equal(parseE4TSV(manifest).kind, 'manifest')
assert.throws(() => parseE4TSV(tsv.replace('-2.5', 'bad')))
assert.throws(() => parseE4TSV('a\tb\n1\t2'))
const file = (name, text) => ({ name, size: text.length, text: async () => text })
const imported = await importResults('E4', [file('manifest.tsv', manifest), file('known_cases_results.tsv', tsv), file('other.tsv', 'unrelated')])
assert.equal(imported.rows.length, 1)
assert.equal(imported.manifest.length, 1)
assert.equal((await importResults('E4', [file('manifest.tsv', manifest)])).rows.length, 0)
await assert.rejects(importResults('E1', [file('report.txt', 'top1 accuracy: 90%')]))
await assert.rejects(importResults('E3', [file('a', ''), file('b', '')]))
await assert.rejects(importResults('E2', [{ ...file('huge.csv', csv), size: 33 * 1024 * 1024 }]))
const binary = { name: 'traces.pkl', size: 300, arrayBuffer: async () => buffer(fixtures['4']) }
assert.equal((await importResults('E1', [binary, file('report.txt', 'top1 accuracy: 85.3%')])).top1, 85.3)
console.log('PASS: pickle protocols 2–5, concatenated traces, rejected object opcodes; E1/E2/E3/E4 valid, missing, malformed and failed-run inputs')

const { computeReadiness } = await import('../src/lib/score.js')
const { projects, projectRequirements, readinessSummary } = await import('../src/lib/projects.js')
const machine = { KERNEL: 'Linux 5.4', ARCH: 'x86_64', VENDOR: 'GenuineIntel', VIRT: 'none', WAITPKG: 'no', KALLSYMS: 'restricted' }
const ready = computeReadiness(machine)
assert.equal(ready.score, 80)
assert.equal(ready.supported, 2)
assert.deepEqual(readinessSummary(ready, { E1: {} }), { yes: 2, warn: 0, no: 1, info: 1, imported: 1 })
assert.equal(computeReadiness({ ...machine, WAITPKG: 'waitpkg', KALLSYMS: 'readable' }).score, 100)
assert.equal(computeReadiness({ ...machine, VIRT: 'kvm', WAITPKG: 'waitpkg' }).experiments[1].status, 'warn')
assert.ok(computeReadiness({ KERNEL: 'Darwin', ARCH: 'arm64', VIRT: 'none' }).score <= 20)
assert.equal(computeReadiness({ KERNEL: 'Darwin', ARCH: 'arm64' }).supported, 0)
for (const project of projects) {
  assert.ok(project.outputs.length > 0)
  assert.equal(projectRequirements(project.id, null).every((r) => r.status === 'pending'), true)
}
assert.equal(projectRequirements('E1', { ...machine, BROWSER: 'missing' }).find((r) => r.title === '网页记录环境').status, 'pending')
assert.equal(projectRequirements('E4', { ...machine, CLANG18: 'present', CMAKE: 'present', LLVM_OPT: 'present' }).filter((r) => r.status === 'yes').length, 4)
console.log('PASS: shared readiness scoring, summary counts, virtualized E2 restriction and per-project preparation checks')

assert.equal(computeReadiness({ ...machine, CLANG18: 'present', CMAKE: 'present', LLVM_OPT: 'present' }).supported, 3)

const { normalizeHosts, readHosts, rememberHost } = await import('../src/lib/hostHistory.js')
assert.deepEqual(normalizeHosts([' 192.0.2.1 ', '192.0.2.1', null, {}, '../bad', 'bad host']), ['192.0.2.1'])
assert.deepEqual(readHosts({ getItem: () => '{broken' }), [])
assert.deepEqual(readHosts({ getItem: () => '{"password":"never"}' }), [])
assert.deepEqual(rememberHost(['192.0.2.1', '192.0.2.2'], '192.0.2.2'), ['192.0.2.2', '192.0.2.1'])
assert.equal(normalizeHosts(Array.from({length: 10}, (_, i) => `192.0.2.${i}`)).length, 8)
console.log('PASS: bounded address-only history, deduplication, malformed storage and recent-first ordering')
