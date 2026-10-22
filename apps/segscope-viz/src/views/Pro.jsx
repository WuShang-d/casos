import ConnForm from '../components/ConnForm.jsx'
import ProbeResult from '../components/ProbeResult.jsx'
import ResultsImport from './ResultsImport.jsx'
import ProjectWorkspace from './ProjectWorkspace.jsx'
import { computeReadiness } from '../lib/score.js'

const tabs = [
  { id: 'probe', label: '能力探测' },
  { id: 'projects', label: '检查项目详情' },
  { id: 'upload', label: '结果分析 · E1–E4' },
]
const statusCls = { ok: 'text-good', warn: 'text-warn', bad: 'text-bad' }

export default function Pro({ hostHistory, onRememberHost, onRemoveHost, jobs, setJobs, selectedExperiment, setSelectedExperiment, proTab: tab, setProTab: setTab, results, setResults, conn, setConn, facts, probing, err, probe }) {
  const r = facts ? computeReadiness(facts) : null

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <div className="mb-4 flex gap-1 border-b border-edge">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm transition ${tab === t.id ? 'border-b-2 border-accent text-slate-900' : 'text-muted hover:text-slate-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'probe' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="card lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-900">连接目标机</h3>
            <div className="mt-3"><ConnForm hostHistory={hostHistory} onRememberHost={onRememberHost} onRemoveHost={onRemoveHost} conn={conn} setConn={setConn} onSubmit={probe} probing={probing} err={err} variant="full" submitLabel="探测" /></div>
          </div>
          <div className="lg:col-span-3">
            {r ? (
              <>
                <div className="card mb-4">
                  <div className="text-sm font-semibold text-slate-900">就绪度评分明细 · <span className="tabular-nums text-accent">{r.score}</span> / 100 · {r.grade.label}</div>
                  <ul className="mt-2 space-y-1.5">
                    {r.factors.map((x, i) => (
                      <li key={i} className="flex items-center justify-between text-xs">
                        <span className={statusCls[x.status]}>{x.name}{x.note ? `（${x.note}）` : ''}</span>
                        <span className="tabular-nums text-muted">{x.got} / {x.weight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <ProbeResult target={`${conn.user}@${conn.host}`} facts={facts} raw={null} />
              </>
            ) : <div className="card text-sm text-muted">填写左侧连接信息并探测，这里显示机器规格、评分明细与子实验适配。</div>}
          </div>
        </div>
      )}

      {tab === 'projects' && <ProjectWorkspace jobs={jobs} setJobs={setJobs} conn={conn} experiment={selectedExperiment} setExperiment={setSelectedExperiment} facts={facts} results={results} setResults={setResults} />}
      {tab === 'upload' && <ResultsImport results={results} setResults={setResults} experiment={selectedExperiment} setExperiment={setSelectedExperiment} />}
    </div>
  )
}
