import { useState } from 'react'
import CheckIcon from '../components/CheckIcon.jsx'
import ReadinessSummary from '../components/ReadinessSummary.jsx'
import ProjectWorkspace from './ProjectWorkspace.jsx'
import { projects as checks, statusText } from '../lib/projects.js'
import ConnForm from '../components/ConnForm.jsx'
import { computeReadiness } from '../lib/score.js'

export default function Simple({ hostHistory, onRememberHost, onRemoveHost, jobs, setJobs, conn, setConn, facts, probing, err, probe, toPro, results, setResults, selectedExperiment, setSelectedExperiment }) {
  const [showProject, setShowProject] = useState(false)
  function openProject(id) { setSelectedExperiment(id); setShowProject(true); window.scrollTo({ top: 0 }) }
  const readiness = facts ? computeReadiness(facts) : null
  if (showProject) return <div className="simple-page"><ProjectWorkspace jobs={jobs} setJobs={setJobs} conn={conn} experiment={selectedExperiment} setExperiment={setSelectedExperiment} facts={facts} results={results} setResults={setResults} simple onBack={() => setShowProject(false)} /></div>
  return (
    <div className="simple-page">
      <div className="page-breadcrumb">首页 <span>/</span> 电脑信息检查</div>
      {!facts ? (
        <>
          <div className="simple-hero">
            <div className="hero-copy">
              <div className="hero-eyebrow"><span /> 了解容易被忽略的信息线索</div>
              <h1>电脑在运行时，<br />会透露哪些信息？</h1>
              <p className="hero-description">有些使用痕迹，可能被用来推测你访问的网站或处理的信息。从连接一台电脑开始，了解可以做哪些检查。</p>
              <div className="hero-note"><span className="note-icon">i</span><span>这一步先查看电脑的基本情况，帮助你选择后续检查。</span></div>
              <div className="hero-steps">
                <div><span>01</span><strong>连接电脑</strong><p>填写地址和登录信息</p></div>
                <div><span>02</span><strong>查看检查范围</strong><p>了解哪些项目可以继续</p></div>
                <div><span>03</span><strong>自动检查并分析</strong><p>自动采集，用图表查看结果</p></div>
              </div>
            </div>
            <section className="connect-panel" aria-labelledby="connect-title">
              <div className="connect-heading"><div className="connect-symbol"><CheckIcon kind="shield" /></div><div><h2 id="connect-title">连接要检查的电脑</h2><p>填写这台电脑的登录信息</p></div></div>
              <ConnForm hostHistory={hostHistory} onRememberHost={onRememberHost} onRemoveHost={onRemoveHost} conn={conn} setConn={setConn} onSubmit={probe} probing={probing} err={err} submitLabel="连接并查看可检查的项目" />
              <div className="form-bottom"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg> 登录信息仅用于本次连接</div>
            </section>
          </div>
          <section className="checks-section">
            <div className="section-heading"><div><h2>可以了解哪些信息</h2><p>连接后，会根据电脑的实际情况说明哪些项目可以继续检查。</p></div><button onClick={() => toPro('upload')} className="text-link">已有检查记录？导入查看 <span>→</span></button></div>
            <div className="checks-grid">{checks.map((check) => <article key={check.icon} className="check-card"><div className="check-icon"><CheckIcon kind={check.icon} /></div><h3>{check.title}</h3><p>{check.detail}</p><button className="text-link" onClick={() => openProject(check.id)}>了解这项检查 →</button></article>)}</div>
          </section>
        </>
      ) : (
        <section className="simple-results">
          <div className="result-summary"><div className="result-summary-icon"><CheckIcon kind="shield" /></div><div><div className="hero-eyebrow">已完成基本情况检查</div><h1>这台电脑可以继续做 <em>{readiness.supported}</em> 项检查</h1><p>电脑地址：{conn.host} · 以下说明检查条件，尚未判断是否存在信息泄露。</p></div><button className="secondary-button" disabled={probing} onClick={() => probe()}>{probing ? '正在查看…' : '重新查看'}</button></div>
          <ReadinessSummary readiness={readiness} results={results} />
          <div className="checks-grid">{checks.map((check, i) => { const status = readiness.experiments[i].status; return <article key={check.icon} className="check-card"><div className="check-icon"><CheckIcon kind={check.icon} /></div><h2>{check.title}</h2><span className={`status-tag status-${status}`}>{statusText[status]}</span><p>{check.detail}</p><button className="text-link" onClick={() => openProject(check.id)}>查看详情与分析 →</button></article> })}</div>
          <div className="next-step"><div><h2>已经有检查记录？</h2><p>导入已有记录，用图表查看结果；也可以查看这台电脑的详细说明。</p></div><button onClick={() => openProject('E1')} className="primary-button">查看详情与分析记录 <span>→</span></button></div>
        </section>
      )}
    </div>
  )
}
