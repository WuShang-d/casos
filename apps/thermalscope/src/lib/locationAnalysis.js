const MAX_LINES = 10000

export function parseMapCountFile(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return { error: '文件为空' }
  if (lines.length > MAX_LINES) return { error: `行数超过限制 (${MAX_LINES})` }
  const values = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!/^\d+$/.test(raw)) {
      return { error: `第 ${i + 1} 行不是非负整数: "${raw}"` }
    }
    const n = Number(raw)
    if (!Number.isSafeInteger(n)) {
      return { error: `第 ${i + 1} 行数值超出安全整数范围` }
    }
    values.push(n)
  }
  return { ok: true, values }
}

export function computeDistributionStats(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const sum = sorted.reduce((a, b) => a + b, 0)
  const median = n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
  const min = sorted[0]
  const max = sorted[n - 1]
  const mean = sum / n
  return { count: n, min, max, median, mean }
}

function histogramRows(mapValues, unmapValues, bins) {
  const all = [...mapValues, ...unmapValues]
  if (!all.length) return []
  const min = Math.min(...all), max = Math.max(...all)
  const width = Math.max(1, Math.ceil((max - min + 1) / Math.max(1, Math.min(100, bins))))
  const count = Math.floor((max - min) / width) + 1
  const rows = Array.from({ length: count }, (_, i) => {
    const lo = min + i * width, hi = Math.min(max, lo + width - 1)
    return { range: lo === hi ? String(lo) : `${lo}–${hi}`, map: 0, unmap: 0 }
  })
  for (const value of mapValues) rows[Math.floor((value - min) / width)].map++
  for (const value of unmapValues) rows[Math.floor((value - min) / width)].unmap++
  return rows
}

export function buildHistogram(values, bins = 20) {
  return histogramRows(values, [], bins).map(({ range, map }) => ({ range, count: map }))
}

export function buildComparisonHistogram(mapValues, unmapValues, bins = 20) {
  return histogramRows(mapValues, unmapValues, bins)
}
