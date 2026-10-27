const MAX_SAMPLES = 1000

export function validateChannelResult(record) {
  if (!record || typeof record !== 'object') return { error: '记录格式无效' }
  if (record.version !== 1 || record.source !== 'thermal-channel') return { error: '不是有效的热信号收发实验记录' }
  if (typeof record.startedAt !== 'string' || Number.isNaN(Date.parse(record.startedAt))) return { error: 'startedAt 无效' }
  if (typeof record.durationSeconds !== 'number' || !Number.isFinite(record.durationSeconds) || record.durationSeconds <= 0) return { error: 'durationSeconds 必须为正有限数' }

  if (!record.signal || typeof record.signal !== 'object') return { error: 'signal 定义无效' }
  if (typeof record.signal.label !== 'string' || !record.signal.label) return { error: 'signal.label 无效' }
  if (typeof record.signal.path !== 'string' || !record.signal.path) return { error: 'signal.path 无效' }
  if (record.signal.kind !== 'temperature') return { error: 'signal.kind 必须为 temperature' }
  if (record.signal.unit !== '°C') return { error: 'signal.unit 必须为 °C' }

  if (!Number.isSafeInteger(record.senderCPU) || record.senderCPU < 0) return { error: 'senderCPU 无效' }
  if (!Number.isSafeInteger(record.receiverCPU) || record.receiverCPU < 0) return { error: 'receiverCPU 无效' }
  if (record.senderCPU === record.receiverCPU) return { error: '发送与接收 CPU 不能相同' }

  if (record.slotSeconds !== 6) return { error: 'slotSeconds 必须为 6' }
  if (record.preamble !== '0101') return { error: 'preamble 必须为 0101' }

  if (typeof record.sentBits !== 'string' || !/^[01]{1,8}$/.test(record.sentBits)) return { error: 'sentBits 必须为 1–8 位二进制串' }
  if (typeof record.receivedBits !== 'string' || !/^[01?]{1,8}$/.test(record.receivedBits)) return { error: 'receivedBits 必须为 1–8 位 0/1/? 串' }
  if (record.receivedBits.length !== record.sentBits.length) return { error: 'receivedBits 长度必须与 sentBits 一致' }

  if (!record.calibration || typeof record.calibration !== 'object') return { error: 'calibration 无效' }
  const cal = record.calibration
  for (const key of ['zeroMean', 'oneMean', 'threshold', 'separationC']) {
    const val = cal[key]
    if (val !== null && (typeof val !== 'number' || !Number.isFinite(val))) return { error: `calibration.${key} 必须为有限数字或 null` }
  }
  if (typeof cal.valid !== 'boolean') return { error: 'calibration.valid 必须为布尔值' }
  if (cal.valid) {
    if (cal.zeroMean === null || cal.oneMean === null || cal.threshold === null || cal.separationC === null) return { error: 'calibration.valid 为 true 时所有数值不能为 null' }
    if (cal.separationC < 0.5) return { error: 'calibration.separationC 必须 >= 0.5' }
    if (Math.abs(cal.oneMean - cal.zeroMean - cal.separationC) > 1e-6 || Math.abs((cal.oneMean + cal.zeroMean) / 2 - cal.threshold) > 1e-6) return { error: '校准均值、温差与阈值不一致' }
    const minMean = Math.min(cal.zeroMean, cal.oneMean)
    const maxMean = Math.max(cal.zeroMean, cal.oneMean)
    if (cal.threshold < minMean || cal.threshold > maxMean) return { error: 'calibration.threshold 必须在两个均值之间' }
  }

  if (!Array.isArray(record.slots) || record.slots.length !== 4 + record.sentBits.length) return { error: 'slots 必须为数组' }
  for (let i = 0; i < record.slots.length; i++) {
    const slot = record.slots[i]
    if (!slot || typeof slot !== 'object') return { error: `slot ${i} 格式无效` }
    if (!Number.isSafeInteger(slot.index) || slot.index < 0) return { error: `slot ${i} index 无效` }
    if (slot.index !== i || slot.phase !== (i < 4 ? 'calibration' : 'payload')) return { error: `slot ${i} phase 无效` }
    if (slot.meanC !== null && (typeof slot.meanC !== 'number' || !Number.isFinite(slot.meanC))) return { error: `slot ${i} meanC 无效` }
    if (slot.bit !== '0' && slot.bit !== '1' && slot.bit !== '?') return { error: `slot ${i} bit 无效` }
    if (i >= 4 && slot.bit !== record.receivedBits[i - 4]) return { error: '时隙判定与接收内容不一致' }
    if (slot.bit !== '?' && (slot.meanC === null || slot.samples < 8)) return { error: '位判定缺少有效采样' }
    if (!Number.isSafeInteger(slot.samples) || slot.samples < 0 || slot.samples > 1000) return { error: `slot ${i} samples 无效` }
  }

  if (!Array.isArray(record.samples)) return { error: 'samples 必须为数组' }
  if (!record.samples.length || record.samples.length > MAX_SAMPLES) return { error: `samples 超过上限 ${MAX_SAMPLES}` }
  let prevSeconds = -Infinity
  for (let i = 0; i < record.samples.length; i++) {
    const s = record.samples[i]
    if (!s || typeof s !== 'object') return { error: `sample ${i} 格式无效` }
    if (typeof s.seconds !== 'number' || !Number.isFinite(s.seconds) || s.seconds < 0) return { error: `sample ${i} seconds 无效` }
    if (s.seconds <= prevSeconds) return { error: `sample ${i} 时间必须严格递增` }
    if (s.seconds > (4 + record.sentBits.length) * 6 || s.seconds > record.durationSeconds) return { error: '采样时间超出实验范围' }
    prevSeconds = s.seconds
    if (s.temperatureC !== null && (typeof s.temperatureC !== 'number' || !Number.isFinite(s.temperatureC))) return { error: `sample ${i} temperatureC 无效` }
  }

  if (record.status !== 'decoded' && record.status !== 'inconclusive') return { error: 'status 必须为 decoded 或 inconclusive' }
  if (!cal.valid && record.receivedBits !== '?'.repeat(record.sentBits.length)) return { error: '校准失败时不能给出接收位' }
  if ((record.status === 'decoded') !== (cal.valid && !record.receivedBits.includes('?'))) return { error: '结果状态与接收位不一致' }
  if (typeof record.reason !== 'string' || !record.reason) return { error: 'reason 无效' }

  if (!record.limits || typeof record.limits !== 'object') return { error: 'limits 无效' }
  if (record.limits.maxTemperatureC !== 80) return { error: 'limits.maxTemperatureC 必须为 80' }
  if (record.limits.dutyCycle !== 0.5) return { error: 'limits.dutyCycle 必须为 0.5' }
  if (record.limits.maxPayloadBits !== 8) return { error: 'limits.maxPayloadBits 必须为 8' }

  if (record.notes !== undefined && (!Array.isArray(record.notes) || record.notes.some((n) => typeof n !== 'string'))) return { error: 'notes 必须为字符串数组' }

  return { ok: true }
}

export function channelStats(record) {
  if (!record || !record.sentBits || !record.receivedBits) return null
  const sent = record.sentBits
  const received = record.receivedBits
  const total = sent.length
  let decoded = 0, unknown = 0, correct = 0, incorrect = 0
  for (let i = 0; i < total; i++) {
    const r = received[i]
    if (r === '?') { unknown++ }
    else {
      decoded++
      if (r === sent[i]) correct++
      else incorrect++
    }
  }
  return { total, decoded, unknown, correct, incorrect, ratio: total > 0 ? (correct / total) * 100 : 0 }
}
