import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ReferenceLine,
} from 'recharts'

const axis = { stroke: '#667085', fontSize: 11 }
const grid = '#e5e7eb'

function tip(content) {
  return {
    contentStyle: {
      background: '#ffffff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      fontSize: 12,
    },
    labelStyle: { color: '#1d2129' },
    ...content,
  }
}

export function TraceChart({ data, color = '#1677ff', name = '中断计数', xLabel = 'sample index' }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id={`g-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" />
        <XAxis dataKey="t" tick={axis} axisLine={{ stroke: grid }} tickLine={false}
          label={{ value: xLabel, position: 'insideBottom', offset: -2, fill: '#667085', fontSize: 10 }} />
        <YAxis tick={axis} axisLine={{ stroke: grid }} tickLine={false} width={40} />
        <Tooltip {...tip()} />
        <Area type="monotone" dataKey="irq" stroke={color} strokeWidth={1.6}
          fill={`url(#g-${color})`} isAnimationActive={false} name={name} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function ErrorRateChart({ rows, simple = false }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={rows} margin={{ top: 8, right: 16, left: -8, bottom: 4 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" />
        <XAxis dataKey="timeout" tick={axis} axisLine={{ stroke: grid }} tickLine={false}
          label={{ value: simple ? '实验设置' : 'umwait timeout', position: 'insideBottom', offset: -2, fill: '#667085', fontSize: 10 }} />
        <YAxis tick={axis} axisLine={{ stroke: grid }} tickLine={false} width={44}
          label={{ value: simple ? '出错比例 %' : '误码率 %', angle: -90, position: 'insideLeft', fill: '#667085', fontSize: 10 }} />
        <Tooltip {...tip()} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="before" name={simple ? '去除干扰前' : '原始 Spectral'} stroke="#e8684a" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="after" name={simple ? '去除干扰后' : 'SegScope 过滤后'} stroke="#159f83" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function OffsetBars({ data, truth, valueKey = 'cycles', unit = 'CPU cycles', xLabel = 'KASLR 候选偏移 (0–511)' }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 4 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="offset" tick={axis} axisLine={{ stroke: grid }} tickLine={false} interval={63}
          label={{ value: xLabel, position: 'insideBottom', offset: -2, fill: '#667085', fontSize: 10 }} />
        <YAxis tick={axis} axisLine={{ stroke: grid }} tickLine={false} width={44}
          label={{ value: unit, angle: -90, position: 'insideLeft', fill: '#667085', fontSize: 10 }} />
        <Tooltip {...tip()} />
        <>{truth != null && <ReferenceLine x={truth} stroke="#ff6a00" strokeDasharray="4 2"
          label={{ value: '真实偏移', fill: '#ff6a00', fontSize: 10, position: 'top' }} />}</>
        <Bar dataKey={valueKey} name={unit} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.offset} fill={truth != null && d.offset === truth ? '#ff6a00' : '#b7c9e2'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function OverheadBars({ rows, simple = false }) {
  const data = rows.map((r) => ({ name: r.name || `${r.library} ${r.algorithm}`, bloat: r.bloat, overhead: r.overhead }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(320, rows.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 20, left: 90, bottom: 4 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={axis} axisLine={{ stroke: grid }} tickLine={false}
          label={{ value: '开销 %', position: 'insideBottom', offset: -2, fill: '#667085', fontSize: 10 }} />
        <YAxis type="category" dataKey="name" tick={axis} axisLine={{ stroke: grid }} tickLine={false} width={150} />
        <Tooltip {...tip()} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="overhead" name={simple ? '耗时变化 %' : '运行开销 %'} fill="#1677ff" isAnimationActive={false} radius={[0, 4, 4, 0]} />
        <Bar dataKey="bloat" name={simple ? '文件大小变化 %' : '二进制膨胀 %'} fill="#ff6a00" isAnimationActive={false} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ConfusionMatrix({ labels, matrix }) {
  const max = Math.max(...matrix.flat())
  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 3 }}>
        <thead>
          <tr>
            <th></th>
            {labels.map((l) => (
              <th key={l} className="px-2 pb-1 text-[11px] font-normal text-muted">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="pr-2 text-right text-[11px] text-muted">{labels[i]}</td>
              {row.map((v, j) => {
                const a = v / max
                const diag = i === j
                return (
                  <td key={j}
                    className="h-11 w-11 rounded text-center align-middle text-xs tabular-nums"
                    style={{
                      background: diag
                        ? `rgba(52,211,153,${0.15 + a * 0.7})`
                        : `rgba(248,113,113,${0.08 + a * 0.5})`,
                      color: a > 0.5 ? '#0a0e17' : '#1d2129',
                    }}>
                    {v}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[11px] text-muted">行 = 真实站点，列 = 预测站点；对角线为正确分类。</div>
    </div>
  )
}
