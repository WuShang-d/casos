import { Kpi, Panel, SectionTitle } from '../components/ui.jsx'
import { meta, e1, e2, e3, e4 } from '../lib/data.js'

const cards = [
  { id: 'e1', tag: 'E1', title: '网站指纹识别', desc: '无计时器探测中断，识别用户访问的网站', stat: `top-1 ${e1.top1}%`, tone: 'accent' },
  { id: 'e2', tag: 'E2', title: '增强 Spectral 攻击', desc: '过滤被中断污染的测量，降低误码率', stat: `${e2.headline.before}% → ${e2.headline.after}%`, tone: 'good' },
  { id: 'e3', tag: 'E3', title: '破解 KASLR', desc: 'SegScope 计时器复活时序侧信道，去随机化内核地址', stat: '512 候选偏移', tone: 'accent2' },
  { id: 'e4', tag: 'E4', title: '编译器防御原语', desc: 'LLVM pass 为密钥相关分支插桩中断监控', stat: '< 9% 开销', tone: 'warn' },
]

export default function Overview({ go }) {
  return (
    <div>
      <SectionTitle eyebrow={`${meta.venue} · ${meta.author}`} title="SegScope 侧信道结果可视化平台">
        通过架构足迹（architectural footprints）无需计时器即可探测细粒度中断。本平台将 SegScope 的四个子实验产物
        —— 中断 trace 波形、分类准确率、误码率曲线、防御开销 —— 汇聚成一个可交互的结果分析面板。
        攻击 PoC 必须在授权的物理机上采集；本平台只消费离线结果文件。
      </SectionTitle>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="E1 Top-1 准确率" value={e1.top1} unit="%" sub={`±${e1.top1err}% · ${e1.traces} traces`} tone="accent" />
        <Kpi label="E2 误码率下降" value={`${e2.headline.before}→${e2.headline.after}`} unit="%" sub="过滤前 → 过滤后" tone="good" />
        <Kpi label="E3 KASLR 候选" value={512} unit="offsets" sub="top-5 命中真实偏移" tone="accent2" />
        <Kpi label="E4 最大运行开销" value={Math.max(...e4.rows.map((r) => r.overhead))} unit="%" sub={`${e4.rows.length} 个基准`} tone="warn" />
      </div>

      <h3 className="mb-3 mt-8 text-sm font-semibold text-slate-900">子实验</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cards.map((c) => (
          <button key={c.id} onClick={() => go(c.id)}
            className="card group text-left transition hover:border-accent/40 hover:bg-panel">
            <div className="flex items-center justify-between">
              <span className="chip border-accent/40 text-accent">{c.tag}</span>
              <span className="text-sm font-semibold text-slate-900">{c.stat}</span>
            </div>
            <div className="mt-2 text-base font-semibold text-slate-900 group-hover:text-accent">{c.title}</div>
            <p className="mt-1 text-sm text-muted">{c.desc}</p>
          </button>
        ))}
      </div>

      <Panel className="mt-6" title="关于数据来源" desc="诚实标注：真实 vs 示例">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li><span className="text-good">真实数据</span>：直接取自 SegScope 仓库与论文 README（E1 准确率、E2 误码率扫描行）。</li>
          <li><span className="text-warn">示例数据</span>：仓库在运行时才生成的产物（<code>result-512</code>、<code>manifest.tsv</code>、trace 数组），
            此处用形态一致的代表性数据占位，可通过真实运行结果替换。</li>
        </ul>
      </Panel>
    </div>
  )
}
