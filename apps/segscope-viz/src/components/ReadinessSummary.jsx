import { useState } from 'react'
import { readinessSummary } from '../lib/projects.js'

export default function ReadinessSummary({ readiness, results }) {
  const [showDetails, setShowDetails] = useState(false)
  const counts = readinessSummary(readiness, results)
  const labels = ['系统和处理器符合要求', '使用独立的电脑环境', '具备第二项检查的硬件能力', '可以核对系统中的真实位置']
  const score = readiness.score
  return (
    <section className="readiness-panel" aria-label="检查准备度">
      <div className="readiness-score"><div className="score-ring" style={{ '--progress': `${score}%` }}><div><strong>{score}</strong><span>/ 100</span></div></div><div><h2>检查准备度</h2><p>分数越高，已具备的基础检查条件越多。<br />这是准备情况评分，不代表电脑的安全程度。</p><button className="text-link" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails}>{showDetails ? '收起评分说明' : '查看评分怎么算'} <span>{showDetails ? '−' : '+'}</span></button></div></div>
      <div className="readiness-counts">{[[counts.yes, '可继续检查'], [counts.warn + counts.info, '还需确认或准备'], [counts.no, '暂不具备条件'], [counts.imported, '已导入检查记录']].map(([count, label]) => <div key={label}><strong>{count}<small>项</small></strong><span>{label}</span></div>)}</div>
      {showDetails && <div className="score-details"><p>与专业版使用相同的评分规则。这里只统计已读取的基础条件；每项检查所需的配套工具见详情页。</p>{readiness.factors.map((factor, i) => <div key={factor.name}><span>{labels[i]}</span><span>{factor.got} / {factor.weight} 分</span><div className="score-track"><div style={{ width: `${factor.got / factor.weight * 100}%` }} /></div></div>)}{!readiness.base && <p>当前系统或处理器不符合基本要求，总分最高计 20 分。</p>}</div>}
    </section>
  )
}
