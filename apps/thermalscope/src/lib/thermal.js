const MAX_LEVENSHTEIN = 2048
const MAX_SOURCES = 64
const MAX_SAMPLES = 10000
const VALID_KINDS = new Set(['temperature', 'trm', 'throttle'])
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype'])

export function normalizeBitString(value) {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\s\n\r]+/g, '')
  if (!cleaned || !/^[01]+$/.test(cleaned)) return null
  return cleaned
}

export function levenshtein(a, b) {
  if (a.length > MAX_LEVENSHTEIN || b.length > MAX_LEVENSHTEIN) {
    throw new Error(`比特串过长（最大 ${MAX_LEVENSHTEIN}）`)
  }
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

export function computeErrorRate(sent, received) {
  const s = normalizeBitString(sent)
  const r = normalizeBitString(received)
  if (!s || !r) return { error: '发送与接收内容必须是仅含 0/1 的字符串' }
  const dist = levenshtein(s, r)
  const editRatio = (dist / s.length) * 100
  let mismatchRatio = null
  if (s.length === r.length) {
    let mismatches = 0
    for (let i = 0; i < s.length; i++) if (s[i] !== r[i]) mismatches++
    mismatchRatio = (mismatches / s.length) * 100
  }
  return {
    sentBits: s.length,
    receivedBits: r.length,
    editDistance: dist,
    editRatio,
    mismatchRatio,
    equalLength: s.length === r.length,
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0
}

function isSafeId(id) {
  return isNonEmptyString(id) && !FORBIDDEN_IDS.has(id)
}

export function validateThermalRecord(record) {
  if (!record || typeof record !== 'object') return { error: '记录格式无效' }
  if (record.version !== 1 || record.source !== 'thermal-observation') {
    return { error: '不是有效的热活动观测记录' }
  }
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    return { error: 'sources 不能为空' }
  }
  if (record.sources.length > MAX_SOURCES) {
    return { error: `sources 超过上限 ${MAX_SOURCES}` }
  }
  if (!Array.isArray(record.samples) || record.samples.length === 0) {
    return { error: '缺少 samples 数组' }
  }
  if (record.samples.length > MAX_SAMPLES) {
    return { error: `samples 超过上限 ${MAX_SAMPLES}` }
  }

  const sourceIds = Object.create(null)
  const tempSourceIds = Object.create(null)
  for (const src of record.sources) {
    if (!src || typeof src !== 'object') return { error: '来源定义无效' }
    if (!isSafeId(src.id)) return { error: '来源 id 无效或为保留字' }
    if (sourceIds[src.id]) return { error: `来源 id 重复: ${src.id}` }
    sourceIds[src.id] = true
    if (!VALID_KINDS.has(src.kind)) return { error: `未知来源类型: ${src.kind}` }
    if (src.unit !== (src.kind === 'temperature' ? '°C' : 'events/interval')) {
      return { error: `来源 ${src.id} 单位无效` }
    }
    if (!isNonEmptyString(src.label)) return { error: `来源 ${src.id} label 无效` }
    if (!isNonEmptyString(src.path)) return { error: `来源 ${src.id} path 无效` }
    if (src.kind === 'temperature') tempSourceIds[src.id] = true
  }

  if (!isNonEmptyString(record.startedAt) || Number.isNaN(Date.parse(record.startedAt))) {
    return { error: 'startedAt 无效' }
  }
  if (typeof record.durationSeconds !== 'number' || !Number.isFinite(record.durationSeconds) || record.durationSeconds <= 0) {
    return { error: 'durationSeconds 必须为正有限数' }
  }
  if (typeof record.intervalSeconds !== 'number' || !Number.isFinite(record.intervalSeconds) || record.intervalSeconds <= 0) {
    return { error: 'intervalSeconds 必须为正有限数' }
  }

  let prevSeconds = -Infinity
  for (let i = 0; i < record.samples.length; i++) {
    const sample = record.samples[i]
    if (!sample || typeof sample !== 'object') return { error: `采样 ${i} 格式无效` }
    if (typeof sample.seconds !== 'number' || !Number.isFinite(sample.seconds) || sample.seconds < 0) {
      return { error: `采样 ${i} 时间无效` }
    }
    if (sample.seconds <= prevSeconds) return { error: `采样 ${i} 时间必须严格递增` }
    prevSeconds = sample.seconds

    if (!sample.values || typeof sample.values !== 'object' || Array.isArray(sample.values)) {
      return { error: `采样 ${i} values 无效` }
    }

    const seen = Object.create(null)
    for (const key of Object.keys(sample.values)) {
      if (!sourceIds[key]) return { error: `采样 ${i} 包含未声明来源 ${key}` }
      seen[key] = true
      const val = sample.values[key]
      if (val !== null) {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          return { error: `来源 ${key} 的值必须为有限数字或 null` }
        }
        if (!tempSourceIds[key] && (!Number.isSafeInteger(val) || val < 0)) return { error: `计数来源 ${key} 必须为非负安全整数` }
      }
    }
    for (const id of Object.keys(sourceIds)) {
      if (!(id in seen)) return { error: `采样 ${i} 缺少来源 ${id}` }
    }


  }

  if (record.resets !== undefined && !Array.isArray(record.resets)) return { error: 'resets 必须为数组' }
  if (record.notes !== undefined && (!Array.isArray(record.notes) || record.notes.some((n) => typeof n !== 'string'))) return { error: 'notes 必须为文字数组' }
  if (Array.isArray(record.resets)) {
    for (const reset of record.resets) {
      if (!reset || typeof reset !== 'object') return { error: '重置记录格式无效' }
      if (!isNonEmptyString(reset.sourceId)) return { error: '重置 sourceId 无效' }
      if (!sourceIds[reset.sourceId]) return { error: `重置引用未知来源 ${reset.sourceId}` }
      if (tempSourceIds[reset.sourceId]) return { error: '重置不能引用 temperature 来源' }
      if (typeof reset.seconds !== 'number' || !Number.isFinite(reset.seconds) || reset.seconds < 0) {
        return { error: '重置时间无效' }
      }
    }
  }

  return { ok: true }
}

export function buildThermalCharts(record) {
  const tempSources = record.sources.filter((s) => s.kind === 'temperature')
  const eventSources = record.sources.filter((s) => s.kind === 'trm' || s.kind === 'throttle')
  const tempData = record.samples.map((sample) => {
    const point = { seconds: sample.seconds }
    for (const src of tempSources) point[src.id] = sample.values[src.id]
    return point
  })
  const eventData = record.samples.map((sample) => {
    const point = { seconds: sample.seconds }
    for (const src of eventSources) point[src.id] = sample.values[src.id]
    return point
  })
  return { tempSources, eventSources, tempData, eventData }
}
