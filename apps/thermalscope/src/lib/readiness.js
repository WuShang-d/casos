export function computeReadiness(facts) {
  const checks = [
    { label: 'Linux 系统', ok: Boolean(facts?.KERNEL?.startsWith('Linux')) },
    { label: 'x86_64 处理器', ok: facts?.ARCH === 'x86_64' },
    { label: 'Intel 处理器', ok: facts?.VENDOR === 'GenuineIntel' },
    { label: 'Python 运行环境', ok: facts?.PYTHON3 === 'present' },
    { label: '可读取的热活动来源', ok: ['TEMPERATURE', 'TRM', 'THROTTLE'].some((key) => facts?.[key] === 'present') },
  ]
  const passed = checks.filter((c) => c.ok).length
  return { checks, score: Math.round(passed / checks.length * 100), canStart: Boolean(facts) && passed === checks.length, passed, total: checks.length }
}
