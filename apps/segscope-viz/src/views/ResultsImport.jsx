import { useRef, useState } from 'react'
import { findProject, projects } from '../lib/projects.js'
import { importResults } from '../lib/parse.js'
import E1 from './E1.jsx'
import E2 from './E2.jsx'
import E3 from './E3.jsx'
import E4 from './E4.jsx'

const formats = {
  E1: { name: '网站指纹', accept: '.pkl,.txt', hint: '选择 record_data.py 生成的 .pkl（可多选）；可同时选择 check_results.py 输出的分类报告 .txt。', button: '选择 trace / 分类报告' },
  E2: { name: 'Spectral 误码率', accept: '.csv,.txt', hint: '选择 test.sh 生成的六列 log.csv：timeout,原始误码率,speed,capacity,irq=N,after_filter:N。', button: '选择 log.csv' },
  E3: { name: 'KASLR 偏移', accept: '', hint: '选择原始 result-512 文件：512 行测量分数，行号对应偏移 0–511。真值可以在导入后另行填写。', button: '选择 result-512' },
  E4: { name: '编译器防御', accept: '.tsv', hint: 'manifest.tsv 只含任务索引；开销指标在 known_cases_results.tsv。可多选，也可选择完整结果目录。', button: '选择 TSV 文件' },
}

export default function ResultsImport({ results, setResults, experiment = 'E2', setExperiment, simple = false, fixedProject = false }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef(null), folder = useRef(null)
  const format = formats[experiment]
  const result = results[experiment]
  const project = findProject(experiment)

  async function onFiles(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setError(''); setBusy(true)
    try {
      const data = await importResults(experiment, files)
      setResults((current) => ({ ...current, [experiment]: { data, names: files.filter((f) => experiment !== 'E4' || ['manifest.tsv', 'known_cases_results.tsv'].includes(f.name)).map((f) => f.webkitRelativePath || f.name) } }))
    } catch (err) { setError(err.message || String(err)) }
    finally { setBusy(false) }
  }

  return (
    <div>
      <div className="card mb-5">
        <h3 className="text-sm font-semibold text-slate-900">{simple ? '已有其他记录？也可导入' : '导入已采集的实验结果'}</h3>
        <p className="mt-1 text-xs text-muted">手动选择的文件仅在浏览器内解析，不会上传到服务器。单次最多 32 MB；各实验结果在本次页面会话中保留。</p>
        {!fixedProject && <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="实验类型">
          {Object.entries(formats).map(([id, f]) => (
            <button key={id} disabled={busy} onClick={() => { setExperiment(id); setError('') }}
              aria-pressed={experiment === id} className={`chip ${experiment === id ? 'border-accent text-slate-900' : ''}`}>{simple ? projects.find((p) => p.id === id).short : `${id} · ${f.name}`}</button>
          ))}
        </div>}
        <p className="mt-3 text-xs text-muted">{simple ? project.files : format.hint}</p>
        <input ref={input} type="file" aria-label={`${experiment} 结果文件`} accept={format.accept || undefined}
          multiple={experiment === 'E1' || experiment === 'E4'} onChange={onFiles} className="hidden" />
        <input ref={folder} type="file" aria-label="E4 结果目录" webkitdirectory="" multiple onChange={onFiles} className="hidden" />
        <div className="mt-4 flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => input.current?.click()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60">
            {busy ? '正在读取…' : simple ? '选择检查记录' : format.button}
          </button>
          {experiment === 'E4' && <button disabled={busy} onClick={() => folder.current?.click()} className="rounded-lg border border-edge px-4 py-2 text-sm text-slate-900 disabled:opacity-60">选择结果目录</button>}
          {result && <button disabled={busy} onClick={() => setResults((current) => { const next = { ...current }; delete next[experiment]; return next })} className="ml-auto text-xs text-muted hover:text-slate-900">{simple ? '清除此项记录' : '清除此实验结果'}</button>}
        </div>
        {error && <div role="alert" className="mt-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{simple ? '这份记录暂时无法读取，请确认文件完整，并符合上方的文件说明。' : error}</div>}
        {result && <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">已导入 {result.names.length} 个文件{error ? '（保留上一次成功结果）' : ''}</summary><ul className="mt-1 list-inside list-disc break-all">{result.names.map((name, i) => <li key={i}>{name}</li>)}</ul></details>}
      </div>
      {!result && <div className="project-empty"><span>↥</span><h3>还没有这项检查的记录</h3><p>{project.empty}</p></div>}
      {result?.metadata?.note && <p className="run-scope-note">本次运行范围：{result.metadata.note}</p>}
      {result && experiment === 'E1' && <E1 data={result.data} simple={simple} />}
      {result && experiment === 'E2' && <E2 rows={result.data.rows} simple={simple} />}
      {result && experiment === 'E3' && <E3 data={result.data} simple={simple} />}
      {result && experiment === 'E4' && <E4 data={result.data} simple={simple} />}
    </div>
  )
}
