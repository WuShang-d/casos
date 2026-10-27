// Synthetic fixtures for parser/statistics validation only; never shipped as demonstration results.
import assert from 'node:assert/strict'
import { validateChannelResult, channelStats } from '../src/lib/channel.js'
function fixture(receivedBits = '001?', invalidCalibration = false) {
  const sentBits = '1010'
  const allBits = '0101' + receivedBits
  return {
    version: 1, source: 'thermal-channel', startedAt: '2026-10-26T10:00:00Z', durationSeconds: 49,
    signal: { label: 'Package id 0', path: '/sys/class/hwmon/hwmon0/temp1_input', kind: 'temperature', unit: '°C' },
    senderCPU: 0, receiverCPU: 2, slotSeconds: 6, preamble: '0101', sentBits, receivedBits,
    calibration: invalidCalibration ? { zeroMean: 50, oneMean: 50, separationC: 0, threshold: null, valid: false } : { zeroMean: 50, oneMean: 52, separationC: 2, threshold: 51, valid: true },
    slots: [...allBits].map((bit, index) => ({ index, phase: index < 4 ? 'calibration' : 'payload', meanC: bit === '?' ? null : bit === '1' ? 52 : 50, bit, samples: bit === '?' ? 0 : 15 })),
    samples: [...allBits].flatMap((bit, index) => Array.from({ length: 30 }, (_, j) => ({ seconds: index * 6 + j * .2, temperatureC: bit === '?' ? null : bit === '1' ? 52 : 50 }))),
    status: receivedBits.includes('?') || invalidCalibration ? 'inconclusive' : 'decoded', reason: 'Synthetic parser test',
    limits: { maxTemperatureC: 80, dutyCycle: .5, maxPayloadBits: 8 }, notes: ['Synthetic test only'],
  }
}
assert.deepEqual(validateChannelResult(fixture()), { ok: true })
assert.deepEqual(channelStats(fixture()), { total: 4, decoded: 3, unknown: 1, correct: 2, incorrect: 1, ratio: 50 })
assert.equal(channelStats(fixture('1010')).ratio, 100)
assert.equal(channelStats(fixture('0101')).incorrect, 4)
assert.equal(channelStats(fixture('????', true)).unknown, 4)
assert.deepEqual(validateChannelResult(fixture('????', true)), { ok: true })
for (const change of [
  { version: 2 }, { source: 'thermal-observation' }, { startedAt: 'invalid' }, { durationSeconds: Infinity },
  { signal: { ...fixture().signal, unit: 'events' } }, { receiverCPU: 0 }, { slotSeconds: 5 }, { preamble: '0110' },
  { sentBits: '101010101', receivedBits: '101010101' }, { sentBits: '' }, { receivedBits: '001' },
  { calibration: { ...fixture().calibration, separationC: .3 } }, { calibration: { ...fixture().calibration, oneMean: 49 } },
  { calibration: { ...fixture().calibration, threshold: 50.2 } }, { calibration: { ...fixture().calibration, valid: false } },
  { slots: [] }, { samples: [] }, { samples: [{ seconds: NaN, temperatureC: 50 }] },
  { samples: [{ seconds: 2, temperatureC: 50 }, { seconds: 1, temperatureC: 50 }] },
  { samples: [{ seconds: 1, temperatureC: Infinity }] }, { samples: [{ seconds: 200, temperatureC: 50 }] },
  { status: 'decoded' }, { status: 'running' }, { reason: '' }, { limits: { ...fixture().limits, dutyCycle: 1 } },
  { samples: Array.from({ length: 1001 }, (_, i) => ({ seconds: i * .01, temperatureC: 50 })) },
]) assert.ok(validateChannelResult({ ...fixture(), ...change }).error, JSON.stringify(change))
const wrongSlot = fixture(); wrongSlot.slots[4].bit = '1'
assert.ok(validateChannelResult(wrongSlot).error)
assert.ok(validateChannelResult(null).error)
assert.equal(channelStats(null), null)
console.log('PASS thermal channel: correct/wrong/unknown bits retained; contradictory calibration, status, slots, samples, units and bounds refused')
