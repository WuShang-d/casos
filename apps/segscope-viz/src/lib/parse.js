import { readTracePickles } from './pickle.js'

const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const lines = (text) => text.replace(/^\uFEFF/, '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
const numeric = (s) => typeof s === 'string' && numberPattern.test(s.trim()) && Number.isFinite(Number(s)) ? Number(s) : null
const fail = (message) => { throw new Error(message) }

export function parseE2Log(text) {
  const rows = []
  for (const [i, line] of lines(text).entries()) {
    if (/^timeout\s*,/i.test(line)) continue
    const parts = line.split(',').map((s) => s.trim())
    const [timeout, before, speed, capacity] = parts.slice(0, 4).map(numeric)
    const irq = numeric(parts[4]?.replace(/^irq\s*=\s*/, ''))
    const after = numeric(parts[5]?.replace(/^after_filter\s*:\s*/, ''))
    if (parts.length !== 6 || [timeout, before, speed, capacity, irq, after].some((n) => n == null)
      || !Number.isInteger(timeout) || timeout <= 0 || !Number.isInteger(irq) || irq < 0
      || speed < 0 || capacity < 0 || before < 0 || before > 100 || after < 0 || after > 100) {
      fail(`E2 第 ${i + 1} 条记录无效；需要 timeout,原始误码率,speed,capacity,irq=N,after_filter:N`)
    }
    rows.push({ timeout, before, speed, capacity, irq, after })
  }
  if (!rows.length) fail('文件中没有 E2 扫描数据')
  return rows.sort((a, b) => a.timeout - b.timeout)
}

export function parseE3Result(text) {
  const values = lines(text).map(numeric)
  if (values.length !== 512 || values.some((v) => v === null || v < 0)) fail('E3 result-512 必须包含 512 行有限、非负的测量分数')
  const measurements = values.map((score, offset) => ({ offset, score }))
  return { measurements, top5: [...measurements].sort((a, b) => b.score - a.score || a.offset - b.offset).slice(0, 5) }
}

export function parseE4TSV(text) {
  const input = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((s) => s.trim() && !s.startsWith('#'))
  const headers = input.shift()?.split('\t') || []
  const manifest = ['variant', 'instr_mode', 'repeat_id', 'status', 'result_tsv'].every((h) => headers.includes(h))
  if (!manifest && !['case', 'library', 'version', 'algorithm', 'overhead_pct', 'bin_size_base', 'bin_size_inst'].every((h) => headers.includes(h))) {
    fail('E4 需要原始 manifest.tsv 或 known_cases_results.tsv 表头')
  }
  const rows = input.map((line, i) => {
    const fields = line.split('\t')
    if (fields.length !== headers.length) fail(`E4 第 ${i + 2} 行列数与表头不一致`)
    const row = Object.fromEntries(headers.map((h, j) => [h, fields[j]]))
    if (manifest) return row
    const metric = (key) => {
      if (['', '-', 'NA', 'N/A'].includes(row[key] ?? '')) return null
      const value = numeric(row[key])
      if (value === null) fail(`E4 第 ${i + 2} 行 ${key} 不是有效数值`)
      return value
    }
    const base = metric('bin_size_base'), inst = metric('bin_size_inst')
    if ((base !== null && base < 0) || (inst !== null && inst < 0)) fail('二进制大小不能为负数')
    return { ...row, overhead: metric('overhead_pct'), funcOverhead: metric('func_overhead_pct'),
      bloat: base > 0 && inst !== null ? (inst - base) / base * 100 : null,
      valid: row.rc === '0' && row.rc_base === '0' }
  })
  if (!rows.length) fail('E4 文件中没有结果行')
  return { kind: manifest ? 'manifest' : 'metrics', rows }
}

export function parseE1Records(records) {
  const traces = []
  for (const record of records) {
    if (!Array.isArray(record) || record.length !== 2 || typeof record[1] !== 'string' || !record[1].trim()) fail('E1 记录需要 (trace, domain) 结构')
    const [raw, site] = record
    if (!Array.isArray(raw) || !raw.length) fail('E1 trace 不能为空')
    const runs = Array.isArray(raw[0]) ? raw : [raw]
    for (const samples of runs) {
      if (!Array.isArray(samples) || !samples.length || samples.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) fail('E1 trace 只能包含有限、非负的数值采样')
      traces.push({ site, samples })
    }
  }
  if (!traces.length) fail('文件中没有 E1 trace')
  return traces
}

export function parseE1Report(text) {
  const result = {}
  for (const key of ['top1', 'top5']) {
    const found = text.match(new RegExp(`${key} accuracy:\\s*([\\d.]+)%`, 'i'))
    if (found) {
      const value = numeric(found[1])
      if (value === null || value < 0 || value > 100) fail('分类准确率应在 0–100% 之间')
      result[key] = value
    }
  }
  if (!Object.keys(result).length) fail('分类报告中未找到 top1 accuracy: N% / top5 accuracy: N%')
  return result
}

export async function importResults(experiment, files) {
  if (!files.length) fail('请选择结果文件')
  if (files.reduce((total, file) => total + file.size, 0) > 32 * 1024 * 1024) fail('单次导入总大小不能超过 32 MB，请分批导入')
  if (experiment === 'E1') {
    const traces = [], report = {}
    for (const file of files) {
      if (/\.pkl$/i.test(file.name)) traces.push(...parseE1Records(readTracePickles(await file.arrayBuffer())))
      else Object.assign(report, parseE1Report(await file.text()))
    }
    if (!traces.length) fail('请至少选择一个 record_data.py 生成的 .pkl 文件，可同时选择分类报告 .txt')
    return { traces, ...report }
  }
  if (experiment === 'E2' || experiment === 'E3') {
    if (files.length !== 1) fail(`${experiment} 请每次选择一个结果文件`)
    const text = await files[0].text()
    return experiment === 'E2' ? { rows: parseE2Log(text) } : parseE3Result(text)
  }
  const rows = [], manifest = []
  for (const file of files) {
    if (!['manifest.tsv', 'known_cases_results.tsv'].includes(file.name)) continue
    const parsed = parseE4TSV(await file.text())
    const source = file.webkitRelativePath || file.name
    const target = parsed.kind === 'manifest' ? manifest : rows
    for (const row of parsed.rows) target.push({ ...row, source })
  }
  if (!rows.length && !manifest.length) fail('请选择 manifest.tsv / known_cases_results.tsv，或包含这些文件的结果目录')
  return { rows, manifest }
}
