// Application-defined readiness score; shared by both modes.
// 权重：x86 Intel/AMD Linux 60，裸机 20，waitpkg 15，kallsyms 可读 5。
export function computeReadiness(facts) {
  const f = facts || {}
  const linux = (f.KERNEL || '').startsWith('Linux')
  const x86 = f.ARCH === 'x86_64'
  const intelAmd = ['GenuineIntel', 'AuthenticAMD'].includes(f.VENDOR)
  const bareMetal = f.VIRT === 'none'
  const waitpkg = f.WAITPKG === 'waitpkg'
  const kallsyms = f.KALLSYMS === 'readable'
  const base = linux && x86 && intelAmd

  const factors = [
    { name: 'x86 Intel/AMD Linux', weight: 60, got: base ? 60 : (linux && x86 ? 10 : 0), status: base ? 'ok' : 'bad' },
    { name: '裸机（非虚拟化）', weight: 20, got: bareMetal ? 20 : 0, status: bareMetal ? 'ok' : 'warn', note: bareMetal ? '' : `检测到 ${f.VIRT || '未知'}` },
    { name: 'waitpkg（E2 必需）', weight: 15, got: waitpkg ? 15 : 0, status: waitpkg ? 'ok' : 'bad', note: waitpkg ? '' : '需 UMONITOR/UMWAIT' },
    { name: '内核真值可见', weight: 5, got: kallsyms ? 5 : 0, status: kallsyms ? 'ok' : 'warn' },
  ]
  let score = factors.reduce((s, x) => s + x.got, 0)
  if (!base) score = Math.min(score, 20)
  score = Math.max(0, Math.min(100, score))

  const grade = !base
    ? { label: '不适用', tone: 'bad' }
    : score >= 85 ? { label: '优秀', tone: 'good' }
      : score >= 70 ? { label: '良好', tone: 'good' }
        : score >= 50 ? { label: '一般', tone: 'warn' }
          : { label: '较低', tone: 'warn' }

  const experiments = [
    {
      id: 'E1', name: '网站指纹识别',
      status: base ? (bareMetal ? 'yes' : 'warn') : 'no',
      reason: base ? (bareMetal ? '裸机 x86 Linux 的中断足迹' : '虚拟化环境信号不可靠') : '需 x86 Intel/AMD Linux',
    },
    {
      id: 'E2', name: '增强 Spectral',
      status: base && waitpkg ? (bareMetal ? 'yes' : 'warn') : 'no',
      reason: !base ? '需 x86 Intel/AMD Linux' : !waitpkg ? '需 UMONITOR/UMWAIT (Tremont/Alder Lake)' : bareMetal ? 'CPU 支持 waitpkg' : '虚拟化环境仍需核验指令可用性',
    },
    {
      id: 'E3', name: '破解 KASLR',
      status: base ? (bareMetal ? 'yes' : 'warn') : 'no',
      reason: kallsyms ? 'SegScope 计时器 + kallsyms 可读' : 'kallsyms 受限',
    },
    {
      id: 'E4', name: '编译器防御（轻量比较）',
      status: !base ? 'no' : f.CLANG18 === 'present' && f.CMAKE === 'present' && f.LLVM_OPT === 'present' ? 'yes' : 'info',
      reason: !base ? '需 x86 Intel/AMD Linux' : f.CLANG18 === 'present' && f.CMAKE === 'present' && f.LLVM_OPT === 'present' ? '可运行无内核模块的轻量性能比较' : '轻量模式需 clang/LLVM 18 与 CMake',
    },
  ]
  const supported = experiments.filter((e) => e.status === 'yes').length

  return { score, grade, factors, experiments, supported, bareMetal, base }
}
