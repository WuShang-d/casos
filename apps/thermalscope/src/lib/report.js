export function generateMarkdownReport(project, data) {
  const lines = [`# ThermalScope ${project} 分析报告`, '']
  lines.push(`- 生成时间: ${new Date().toISOString()}`)
  lines.push(`- 数据来源: ${data.source || '用户导入'}`)
  if (data.inputCount != null) lines.push(`- 输入量: ${data.inputCount}`)
  if (data.params) {
    lines.push('- 采集参数:')
    for (const [k, v] of Object.entries(data.params)) lines.push(`  - ${k}: ${v}`)
  }
  lines.push('')
  lines.push('## 结果')
  if (data.summary) {
    for (const line of data.summary) lines.push(`- ${line}`)
  } else {
    lines.push('- 无可用结果')
  }
  lines.push('')
  if (data.missing && data.missing.length) {
    lines.push('## 缺失项')
    for (const m of data.missing) lines.push(`- ${m}`)
    lines.push('')
  }
  lines.push('## 结论限度')
  if (data.limitations && data.limitations.length) {
    for (const l of data.limitations) lines.push(`- ${l}`)
  } else {
    lines.push('- 本报告仅反映所给数据的统计特征，不构成安全或泄露程度判定。')
  }
  lines.push('')
  return lines.join('\n')
}

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
