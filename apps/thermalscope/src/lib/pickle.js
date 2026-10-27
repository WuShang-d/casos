import { validateModelTraces } from './modelAnalysis.js'

const MAX_BUFFER = 32 * 1024 * 1024
const MAX_MEMO = 1000000
const MAX_STACK = 1000000
const MAX_RECORDS = 100000

export function readTracePickles(buffer) {
  return parsePickleBuffer(buffer).records
}

export function parseModelPickles(buffer) {
  try {
    const { records } = parsePickleBuffer(buffer)
    const traces = []
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]
      if (!Array.isArray(rec) || rec.length !== 2) {
        return { error: `记录 ${i} 不是 (trace, label) 二元组` }
      }
      let samples = rec[0]
      if (Array.isArray(samples) && samples.length === 1 && Array.isArray(samples[0])) {
        samples = samples[0]
      }
      if (!Array.isArray(samples)) {
        return { error: `记录 ${i} trace 不是数组` }
      }
      const nums = []
      for (let j = 0; j < samples.length; j++) {
        const v = samples[j]
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          return { error: `记录 ${i} 第 ${j} 个点不是有限数字` }
        }
        nums.push(v)
      }
      let label = rec[1]
      if (typeof label !== 'string' || label.length === 0) {
        return { error: `记录 ${i} label 无效` }
      }
      traces.push({ label, samples: nums })
    }
    return validateModelTraces(traces)
  } catch (e) {
    return { error: e.message }
  }
}

function parsePickleBuffer(buffer) {
  if (!(buffer instanceof ArrayBuffer)) throw new Error('输入必须是 ArrayBuffer')
  if (buffer.byteLength > MAX_BUFFER) throw new Error('pickle 文件超过 32 MiB')
  if (buffer.byteLength === 0) throw new Error('pickle 文件为空')
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const mark = Symbol('mark')
  const records = []
  let pos = 0
  let stack = []
  let memo = Object.create(null)
  let memoCount = 0

  const need = (n) => {
    if (n < 0 || pos + n > bytes.length) throw new Error('pickle 文件不完整')
  }

  const uint = (n) => {
    need(n)
    let value
    if (n === 1) value = bytes[pos]
    else if (n === 4) value = view.getUint32(pos, true)
    else value = Number(view.getBigUint64(pos, true))
    pos += n
    if (!Number.isSafeInteger(value)) throw new Error('pickle 数值超出范围')
    return value
  }

  const readString = (n) => {
    need(n)
    const s = decoder.decode(bytes.subarray(pos, pos + n))
    pos += n
    return s
  }

  const pop = () => {
    if (!stack.length) throw new Error('pickle 栈格式错误')
    return stack.pop()
  }

  const items = () => {
    const at = stack.lastIndexOf(mark)
    if (at < 0) throw new Error('pickle 容器格式错误')
    return stack.splice(at).slice(1)
  }

  const append = (values) => {
    const list = stack[stack.length - 1]
    if (!Array.isArray(list)) throw new Error('pickle 列表格式错误')
    for (const value of values) list.push(value)
  }

  while (pos < bytes.length) {
    const op = uint(1)
    switch (op) {
      case 0x80: {
        const protocol = uint(1)
        if (protocol < 2 || protocol > 5) throw new Error('仅支持 pickle 协议 2–5')
        break
      }
      case 0x95: {
        const length = uint(8)
        need(length)
        break
      }
      case 0x28:
        stack.push(mark)
        break
      case 0x5d:
      case 0x29:
        stack.push([])
        break
      case 0x4e:
        stack.push(null)
        break
      case 0x88:
        stack.push(true)
        break
      case 0x89:
        stack.push(false)
        break
      case 0x4b:
        stack.push(uint(1))
        break
      case 0x4d:
        need(2)
        stack.push(view.getUint16(pos, true))
        pos += 2
        break
      case 0x4a:
        need(4)
        stack.push(view.getInt32(pos, true))
        pos += 4
        break
      case 0x47:
        need(8)
        stack.push(view.getFloat64(pos))
        pos += 8
        break
      case 0x8a:
      case 0x8b: {
        const n = uint(op === 0x8a ? 1 : 4)
        need(n)
        if (n > 8) throw new Error('pickle 整数超出范围')
        let value = 0n
        for (let i = 0; i < n; i++) value |= BigInt(bytes[pos + i]) << BigInt(i * 8)
        if (n && bytes[pos + n - 1] & 128) value -= 1n << BigInt(n * 8)
        pos += n
        if (!Number.isSafeInteger(Number(value))) throw new Error('pickle 整数超出范围')
        stack.push(Number(value))
        break
      }
      case 0x58:
      case 0x8c:
      case 0x8d:
        stack.push(readString(uint(op === 0x58 ? 4 : op === 0x8c ? 1 : 8)))
        break
      case 0x61:
        append([pop()])
        break
      case 0x65:
        append(items())
        break
      case 0x6c:
      case 0x74:
        stack.push(items())
        break
      case 0x85:
        stack.push([pop()])
        break
      case 0x86: {
        const b = pop()
        const a = pop()
        stack.push([a, b])
        break
      }
      case 0x87: {
        const c = pop()
        const b = pop()
        const a = pop()
        stack.push([a, b, c])
        break
      }
      case 0x94:
        if (memoCount >= MAX_MEMO) throw new Error('pickle memo 过大')
        memo[memoCount++] = stack[stack.length - 1]
        break
      case 0x71:
      case 0x72: {
        const index = uint(op === 0x71 ? 1 : 4)
        if (index >= MAX_MEMO || !stack.length) throw new Error('pickle 引用超出范围')
        memo[index] = stack[stack.length - 1]
        break
      }
      case 0x68:
      case 0x6a: {
        const index = uint(op === 0x68 ? 1 : 4)
        if (!(index in memo)) throw new Error('pickle 引用无效')
        stack.push(memo[index])
        break
      }
      case 0x2e:
        if (stack.length !== 1) throw new Error('pickle 记录格式错误')
        if (records.length >= MAX_RECORDS) throw new Error('pickle 记录数过多')
        records.push(pop())
        memo = Object.create(null)
        memoCount = 0
        break
      default:
        throw new Error(
          `不支持的 pickle 指令 0x${op.toString(16)}；仅接受原始数值 trace，不执行 Python 对象`,
        )
    }
    if (stack.length > MAX_STACK) throw new Error('pickle 栈过大')
  }

  if (stack.length || !records.length) throw new Error('pickle 文件不完整或没有 trace')
  return { records }
}
