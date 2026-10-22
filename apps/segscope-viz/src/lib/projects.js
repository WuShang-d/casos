export const projects = [
  {
    id: 'E1', title: '访问的网站能否被推测', short: '网站使用痕迹', name: '网站指纹识别', icon: 'web',
    detail: '了解打开网页时留下的痕迹，是否可能透露你访问的网站。',
    explanation: '电脑打开不同的网站时，运行变化往往不一样。这项检查分析这些变化，看看是否能从中辨认出访问的网站。',
    outputs: ['不同网站的运行变化曲线', '采集记录数和网站数量', '已提供识别报告时，显示识别准确率'],
    preparation: ['在独立任务目录中准备浏览器和记录工具，保留其他程序的运行状态。', '为四个公开网站采集少量记录，自动保存每条记录的网站名称。', '自动划分训练和测试记录，生成识别报告并返回结果。'],
    files: '选择一个或多个 .pkl 记录文件；识别报告可作为 .txt 文件一起选择。',
    interpretation: '曲线反映每次访问产生的原始变化。识别准确率来自自动生成或导入的报告，不能仅根据曲线判断网站已经被识别。',
    empty: '导入网站检查记录后，这里会显示曲线、记录数量和识别报告。',
  },
  {
    id: 'E2', title: '处理的信息会不会传出去', short: '信息传递情况', name: '增强 Spectral', icon: 'transfer',
    detail: '了解电脑运行时的细微变化，是否可能被用来传递信息。',
    explanation: '这项检查研究电脑运行时的细微变化能否传递信息，并比较去除干扰前后的传递效果。导入记录后，可以看到出错比例和传递速度。',
    outputs: ['去除干扰前后的出错比例曲线', '同一设置下的改善幅度', '各组设置的传递速度与完整记录'],
    preparation: ['这项自动实验尚未接入当前版本，还需要特定硬件能力。', '本工具不会尝试修改这台电脑全部处理器的控制设置来强行运行。', '如有其他授权设备上已生成的记录，仍可在这里分析。'],
    files: '选择原工具导出的 log.csv 文件，包含每组设置及去除干扰前后的结果。',
    interpretation: '出错比例越低，表示该实验中的信息传递越稳定。曲线只能说明这次实验的结果，不能证明日常使用中已经发生信息泄露。',
    empty: '导入信息传递记录后，这里会比较去除干扰前后的出错比例。',
  },
  {
    id: 'E3', title: '系统中的重要位置能否被猜到', short: '重要位置保护', name: 'KASLR 候选偏移分析', icon: 'location',
    detail: '了解系统保护起来的位置，是否可能被外部观察推测出来。',
    explanation: '系统会隐藏一些重要内容所在的位置。这项检查比较 512 个可能位置的测量结果，找出最可能的几个位置，再与独立确认的真实位置比较。',
    outputs: ['512 个候选位置的测量图', '分数最高的五个候选位置', '提供真实位置后，显示候选是否命中'],
    preparation: ['自动编译测量工具，执行短时预取检查，保留全部512个位置的结果。', '自动取回测量记录并排序；如需核对命中，可以另行填入真实位置编号。', '实际位置可能随重启变化，请使用同一次运行环境下的记录和真值。'],
    files: '选择原始 result-512 文件。文件应包含 512 行数字，每行对应一个位置。',
    interpretation: '分数较高表示候选排名靠前，并不等于已猜对。只有提供独立核验的真实位置，才能判断是否命中。',
    empty: '导入位置检查记录后，这里会展示测量图和排名靠前的位置。',
  },
  {
    id: 'E4', title: '能否发现运行时的异常干扰', short: '异常干扰防护', name: '编译器防御开销', icon: 'shield',
    detail: '了解这台电脑是否具备进一步检查异常干扰的条件。',
    explanation: '这项检查比较加入干扰监测前后，程序速度和大小发生的变化，帮助你了解启用这项保护需要付出多少成本。',
    outputs: ['各程序的运行耗时变化', '程序文件大小变化', '成功、失败和缺失结果的明细'],
    preparation: ['检查电脑已有的构建工具，在独立目录编译原防护插件。', '在轻量程序上比较三种保护设置与未保护版本，各重复五次。', '自动取回耗时和文件大小记录，不加载系统模块或执行完整矩阵。'],
    files: '选择 manifest.tsv 和 known_cases_results.tsv，或直接选择完整结果目录。',
    interpretation: '任务清单只说明运行了哪些任务，结果表才包含耗时和大小。失败或缺失的记录不参与平均值；这些开销不能直接说明防护效果。',
    empty: '导入防护检查记录后，这里会比较程序耗时和文件大小的变化。',
  },
]

export const statusText = { yes: '可以进一步检查', warn: '部分条件待确认', no: '暂不具备条件', info: '需要进一步准备' }
export const findProject = (id) => projects.find((p) => p.id === id) || projects[0]

export function projectRequirements(id, facts) {
  const f = facts || {}
  const known = !!facts
  const base = (f.KERNEL || '').startsWith('Linux') && f.ARCH === 'x86_64' && ['GenuineIntel', 'AuthenticAMD'].includes(f.VENDOR)
  const condition = (title, value, good, missing) => ({ title, status: !known || value == null ? 'pending' : value ? 'yes' : 'no', detail: !known ? '连接电脑后确认' : value == null ? '本次未确认，请准备后再检查' : value ? good : missing })
  const platform = condition('系统与处理器', base, '系统和处理器类型符合基本要求', '当前系统或处理器类型不符合这项实验要求')
  const machine = condition('电脑运行环境', f.VIRT && f.VIRT !== 'unknown' ? f.VIRT === 'none' : null, '检测到独立的电脑运行环境', '当前为共享底层硬件的运行环境，测量结果可能受到影响')
  const tool = (title, key) => condition(title, f[key] ? f[key] !== 'missing' : null, '已找到所需工具', '还没有找到所需工具，需要提前准备')
  if (id === 'E1') return [platform, machine, tool('程序构建工具', 'COMPILER'), { title: '网页记录环境', status: 'pending', detail: '自动检查时会在独立目录准备浏览器和配套工具；首次需要下载，能否运行以实际准备结果为准' }]
  if (id === 'E2') return [platform, machine, condition('信息传递实验需要的硬件能力', f.WAITPKG ? f.WAITPKG === 'waitpkg' : null, '已具备所需硬件能力', '这台电脑缺少所需硬件能力，不能通过安装软件补齐')]
  if (id === 'E3') return [platform, machine, tool('程序构建工具', 'COMPILER'), condition('独立核对真实位置', f.KALLSYMS ? f.KALLSYMS === 'readable' : null, '当前账号可以读取真实位置用于核对', '当前账号无法读取真实位置；可分析已有记录，验证命中需另行提供真实编号')]
  return [platform, tool('保护程序构建工具', 'CLANG18'), tool('配套构建工具', 'CMAKE'), tool('保护处理工具', 'LLVM_OPT')]
}

export function readinessSummary(readiness, results = {}) {
  const counts = { yes: 0, warn: 0, no: 0, info: 0 }
  for (const item of readiness.experiments) counts[item.status]++
  return { ...counts, imported: projects.filter((p) => results[p.id]).length }
}
