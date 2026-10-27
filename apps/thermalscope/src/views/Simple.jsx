import ConnForm from '../ConnForm.jsx'
import ProjectE1 from './ProjectE1.jsx'
import ProjectE2 from './ProjectE2.jsx'
import ProjectE3 from './ProjectE3.jsx'
import { computeReadiness } from '../lib/readiness.js'

const projects = [
  { id: 'E1', title: '试试用发热传信息', desc: '连接实验电脑，应用会自动发送一组测试内容；另一个程序只看温度变化，尝试接收，完成后直接看结果。', number: '01' },
  { id: 'E2', title: '查看模型识别结果', desc: '导入已有的模型运行记录和识别结果，看认对了多少、哪些模型容易认错。', number: '02' },
  { id: 'E3', title: '比较两组测量数据', desc: '放入两份实验测量文件，看两组数值差多少、各自集中在哪个范围。', number: '03' },
]

export default function Simple({ goHome, workspaceOpen, setWorkspaceOpen, facts, conn, setConn, probing, err, probe, hostHistory, onRemoveHost, onRememberHost, jobs, setJobs, results, setResults, selectedProject, setSelectedProject, professional, health, jobSubmitting, setJobSubmitting, autoRun }) {
  const readiness = computeReadiness(facts)
  const setResult = (key) => (next) => setResults((current) => ({ ...current, [key]: typeof next === 'function' ? next(current[key]) : next }))
  function openProject(id) { setSelectedProject(id); setWorkspaceOpen(true); window.scrollTo({ top: 0 }) }
  if (!workspaceOpen) return <div className="simple-page">
    <div className="page-breadcrumb"><span className="breadcrumb-current">首页</span></div>
    <div className="simple-hero">
      <div className="hero-copy"><div className="hero-eyebrow"><span />ThermalScope · 热信号收发实验</div><h1>两个程序，<br />能靠 CPU 发热传话吗？</h1><p className="hero-description">{professional ? '输入一串 0 和 1，让发送程序交替计算和休息。接收程序只看温度变化，尝试读出同样的内容。最后逐位对照，看这次传对了多少。' : '连接实验电脑，应用会自动发送一组测试内容；另一个程序只看温度变化，尝试接收，完成后直接看结果。'}</p><div className="hero-note"><span className="note-icon">i</span><span>需要 Intel Linux 实验机。发送端制造轻微温度变化，接收端按实测信号判断；信号太弱时会显示无法接收。</span></div><div className="hero-steps"><div><span>01 / 连接</span><strong>连接专用实验机</strong><p>查看机器基本条件</p></div><div><span>02 / {professional ? '实验' : '自动收发'}</span><strong>{professional ? '开始收发实验' : '自动发送与接收'}</strong><p>{professional ? '发送位序列并接收' : '应用自动准备并执行'}</p></div><div><span>03 / 查看</span><strong>对照结果</strong><p>逐位核对并下载报告</p></div></div></div>
      <ConnForm {...{ conn, setConn, probing, err, probe, hostHistory, onRemoveHost, onRememberHost }} professional={professional} />
    </div>
    <section className="checks-section"><div className="section-heading"><div><h2>实验项目</h2><p>连接实验机尝试收发，或直接导入已有的实验文件。</p></div></div><div className="checks-grid">{projects.map((project) => <button className="check-card" key={project.id} onClick={() => openProject(project.id)}><span className="check-number">{project.number}</span><h3>{project.title}</h3><p>{project.desc}</p><span className="text-link">查看项目 →</span></button>)}</div></section>
  </div>
  return <div className="simple-page">
    <div className="page-breadcrumb"><button type="button" onClick={goHome}>首页</button><span>›</span><span className="breadcrumb-current">{projects.find((p) => p.id === selectedProject)?.title}</span></div>
    {facts ? <div className="readiness-panel"><div className="readiness-score"><div className="score-ring" style={{ '--progress': `${readiness.score}%` }}><div><strong>{readiness.score}</strong><span>分</span></div></div><div><h2>这台电脑能记录什么</h2><p className="field-hint">{conn.host} · 得分只表示现有来源是否可用，不代表安全或风险</p><span className={`status-tag ${readiness.canStart ? 'status-yes' : ''}`}>{readiness.canStart ? '可以开始记录' : '部分来源不可用'}</span></div></div><ul className="requirement-list compact">{readiness.checks.map((check) => <li key={check.label}><span className={`requirement-icon ${check.ok ? 'requirement-yes' : 'requirement-no'}`}>{check.ok ? '✓' : '—'}</span><strong>{check.label}</strong></li>)}</ul></div> : <div className="offline-note">可以先查看实验流程或导入结果。需要实际收发时，<button className="text-link" onClick={goHome}>返回首页连接电脑 →</button></div>}
    {professional && facts && <details className="card source-details"><summary>电脑与采样来源详情</summary><dl>{[['系统', facts.KERNEL], ['架构', facts.ARCH], ['处理器', facts.MODEL], ['运行环境', facts.VIRT], ['主机指纹', facts.HOSTKEY], ['温度接口', facts.TEMPERATURE], ['TRM 热中断', facts.TRM], ['节流计数', facts.THROTTLE]].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || '未提供'}</dd></div>)}</dl></details>}
    <nav className="project-nav" aria-label="分析项目">{projects.map((project) => <button key={project.id} className={selectedProject === project.id ? 'active' : ''} aria-current={selectedProject === project.id ? 'page' : undefined} onClick={() => setSelectedProject(project.id)}>{results[project.id] && <span className="project-dot" />}{project.title}</button>)}</nav>
    {selectedProject === 'E1' && <ProjectE1 key="E1" {...{ facts, jobs, setJobs, conn, professional, health, jobSubmitting, setJobSubmitting, autoRun }} result={results.E1} setResult={setResult('E1')} />}
    {selectedProject === 'E2' && <ProjectE2 key="E2" professional={professional} result={results.E2} setResult={setResult('E2')} />}
    {selectedProject === 'E3' && <ProjectE3 key="E3" professional={professional} result={results.E3} setResult={setResult('E3')} />}
  </div>
}
