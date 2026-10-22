import AutoRunPanel from '../components/AutoRunPanel.jsx'
import { useState } from 'react'
import CheckIcon from '../components/CheckIcon.jsx'
import ResultsImport from './ResultsImport.jsx'
import { computeReadiness } from '../lib/score.js'
import { projects, findProject, projectRequirements, statusText } from '../lib/projects.js'

export default function ProjectWorkspace({ jobs, setJobs, conn, experiment, setExperiment, facts, results, setResults, simple = false, onBack }) {
  const [tab, setTab] = useState('guide')
  const project = findProject(experiment)
  const readiness = facts ? computeReadiness(facts) : null
  const assessment = readiness?.experiments.find((e) => e.id === project.id)
  const requirements = projectRequirements(project.id, facts)
  const imported = results[project.id]
  return (
    <div className="project-workspace">
      {onBack && <button onClick={onBack} className="text-link project-back">← 返回检查总览</button>}
      <nav className="project-nav" aria-label="检查项目">{projects.map((p) => <button key={p.id} onClick={() => { setExperiment(p.id); setTab('guide') }} aria-current={experiment === p.id ? 'page' : undefined} className={experiment === p.id ? 'active' : ''}><CheckIcon kind={p.icon} /><span>{simple ? p.short : `${p.id} · ${p.name}`}</span>{results[p.id] && <span className="project-dot" aria-label="已导入记录" />}</button>)}</nav>
      <header className="project-header"><div><div className="hero-eyebrow">{simple ? '检查项目详情' : `${project.id} · SegScope`}</div><h1>{project.title}</h1><p>{project.explanation}</p></div><span className={`status-tag status-${assessment?.status || 'info'}`}>{assessment ? statusText[assessment.status] : '连接电脑后确认条件'}</span></header>
      <div className="project-tabs" role="tablist" aria-label="检查内容"><button role="tab" aria-selected={tab === 'guide'} onClick={() => setTab('guide')}>检查说明与准备</button><button role="tab" aria-selected={tab === 'results'} onClick={() => setTab('results')}>导入与分析记录{imported ? ' · 已有记录' : ''}</button></div>
      <AutoRunPanel key={experiment} experiment={experiment} conn={conn} facts={facts} jobs={jobs} setJobs={setJobs} results={results} setResults={setResults} onShowResults={() => setTab('results')} />
      {tab === 'guide' ? <div role="tabpanel" className="project-guide"><div className="project-guide-main">
        <section className="card"><h2>这项检查会展示什么</h2><ul className="project-output-list">{project.outputs.map((text) => <li key={text}><span>✓</span>{text}</li>)}</ul></section>
        <section className="card"><h2>{experiment === 'E2' ? '为什么不能自动执行' : '工具会怎样执行'}</h2><ol className="preparation-list">{project.preparation.map((text, i) => <li key={text}><span>{i + 1}</span><p>{text}</p></li>)}</ol><p className="project-footnote">点击“开始自动检查”后，工具会传送固定脚本、显示运行进度，并自动取回结果。执行范围以上方说明为准。</p></section>
        <section className="card"><h2>怎样理解结果</h2><p>{project.interpretation}</p></section>
      </div><aside className="project-guide-aside"><section className="card"><h2>这台电脑的准备情况</h2>{!facts && <p className="project-footnote">尚未连接电脑。你仍然可以直接导入已有记录进行分析。</p>}<ul className="requirement-list">{requirements.map((item) => <li key={item.title}><span className={`requirement-icon requirement-${item.status}`}>{item.status === 'yes' ? '✓' : item.status === 'no' ? '!' : '·'}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></li>)}</ul></section><section className="card import-next"><h2>{imported ? '已有检查记录' : '已有记录，直接分析'}</h2><p>{project.files}</p><button className="primary-button" onClick={() => setTab('results')}>{imported ? '查看已导入的结果' : '导入这项检查的记录'} →</button></section></aside></div> : <div role="tabpanel"><ResultsImport results={results} setResults={setResults} experiment={experiment} setExperiment={setExperiment} simple={simple} fixedProject /><p className="project-footnote">{project.interpretation}</p></div>}
    </div>
  )
}
