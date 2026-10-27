const MAX_FILE_SIZE = 32 * 1024 * 1024
const MAX_TRACES = 10000
const MAX_POINTS_PER_TRACE = 100000
const MAX_TOTAL_POINTS = 2000000
const MAX_LABEL_LEN = 200
const MAX_CLASSES = 64
const MAX_PREDICTIONS = 100000

export function validateModelTraces(traces) {
  if (!Array.isArray(traces)) return { error: 'traces 必须是数组' }
  if (traces.length === 0) return { error: 'traces 不能为空' }
  if (traces.length > MAX_TRACES) return { error: `trace 数量超过限制 (${MAX_TRACES})` }
  const normalized = []
  let totalPoints = 0
  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i]
    if (!trace || typeof trace !== 'object') return { error: `trace ${i} 格式无效` }
    if (trace.label == null || typeof trace.label !== 'string' || trace.label.trim().length === 0) {
      return { error: `trace ${i} label 不能为空` }
    }
    const label = trace.label
    if (label.length > MAX_LABEL_LEN) {
      return { error: `trace "${label}" label 超过 ${MAX_LABEL_LEN} 字符` }
    }
    let samples = trace.samples
    if (!Array.isArray(samples)) return { error: `trace "${label}" 缺少 samples 数组` }
    if (samples.length === 0) return { error: `trace "${label}" samples 不能为空` }
    if (samples.length === 1 && Array.isArray(samples[0])) {
      samples = samples[0]
    }
    if (!Array.isArray(samples)) return { error: `trace "${label}" samples 格式无效` }
    if (samples.length === 0) return { error: `trace "${label}" samples 不能为空` }
    if (samples.length > MAX_POINTS_PER_TRACE) {
      return { error: `trace "${label}" 点数超过限制 (${MAX_POINTS_PER_TRACE})` }
    }
    totalPoints += samples.length
    if (totalPoints > MAX_TOTAL_POINTS) {
      return { error: `总点数超过限制 (${MAX_TOTAL_POINTS})` }
    }
    const nums = []
    for (let j = 0; j < samples.length; j++) {
      const v = samples[j]
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { error: `trace "${label}" 第 ${j} 个点不是有限数字` }
      }
      nums.push(v)
    }
    normalized.push({ label, samples: nums })
  }
  const classCount = new Set(normalized.map((t) => t.label)).size
  if (classCount > MAX_CLASSES) {
    return { error: `类别数超过限制 (${MAX_CLASSES})` }
  }
  return { ok: true, traces: normalized }
}

export function computeConfusionMatrix(predictions) {
  if (!Array.isArray(predictions)) {
    throw new Error('预测数据必须是数组')
  }
  if (predictions.length === 0) return null
  if (predictions.length > MAX_PREDICTIONS) throw new Error('预测条数超过限制')
  const labels = Object.create(null)
  const entries = []
  for (const p of predictions) {
    if (!p || typeof p !== 'object') throw new Error('预测条目格式无效')
    if (typeof p.actual !== 'string' || p.actual.trim().length === 0) {
      throw new Error('actual 必须为非空字符串')
    }
    if (typeof p.predicted !== 'string' || p.predicted.trim().length === 0) {
      throw new Error('predicted 必须为非空字符串')
    }
    if (p.actual.length > MAX_LABEL_LEN || p.predicted.length > MAX_LABEL_LEN) {
      throw new Error(`标签长度不能超过 ${MAX_LABEL_LEN}`)
    }
    labels[p.actual] = true
    labels[p.predicted] = true
    entries.push(p)
  }
  const sorted = Object.keys(labels).sort()
  if (sorted.length > MAX_CLASSES) {
    throw new Error(`类别数超过限制 (${MAX_CLASSES})`)
  }
  const matrix = Object.create(null)
  for (const actual of sorted) {
    matrix[actual] = Object.create(null)
    for (const predicted of sorted) matrix[actual][predicted] = 0
  }
  let total = 0
  let correct = 0
  for (const p of entries) {
    matrix[p.actual][p.predicted]++
    total++
    if (p.actual === p.predicted) correct++
  }
  if (total === 0) return null
  return {
    labels: sorted,
    matrix,
    total,
    correct,
    accuracy: (correct / total) * 100,
  }
}

export function parsePredictionsJSON(text) {
  try {
    const data = JSON.parse(text)
    if (!data || !Array.isArray(data.predictions)) {
      return { error: 'predictions.json 必须包含 predictions 数组' }
    }
    const preds = data.predictions
    if (preds.length > MAX_PREDICTIONS) {
      return { error: `预测条数超过限制 (${MAX_PREDICTIONS})` }
    }
    const labelSet = Object.create(null)
    for (let i = 0; i < preds.length; i++) {
      const p = preds[i]
      if (!p || typeof p !== 'object') {
        return { error: `预测条目 ${i} 格式无效` }
      }
      if (typeof p.actual !== 'string' || p.actual.trim().length === 0 || p.actual.length > MAX_LABEL_LEN) {
        return { error: `预测条目 ${i} actual 无效` }
      }
      if (typeof p.predicted !== 'string' || p.predicted.trim().length === 0 || p.predicted.length > MAX_LABEL_LEN) {
        return { error: `预测条目 ${i} predicted 无效` }
      }
      labelSet[p.actual] = true
      labelSet[p.predicted] = true
    }
    if (Object.keys(labelSet).length > MAX_CLASSES) {
      return { error: `类别数超过限制 (${MAX_CLASSES})` }
    }
    return { ok: true, predictions: preds }
  } catch {
    return { error: 'predictions.json 解析失败' }
  }
}

export function checkFileSize(file) {
  if (file.size > MAX_FILE_SIZE) {
    return { error: `文件 "${file.name}" 超过 32 MiB 限制` }
  }
  return { ok: true }
}
