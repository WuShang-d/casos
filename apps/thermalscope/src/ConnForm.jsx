import { useRef, useState } from 'react'

export default function ConnForm({ conn, setConn, probing, err, probe, hostHistory = [], onRemoveHost, onRememberHost, professional }) {
  const [expanded, setExpanded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const hostEdited = useRef(false)
  const update = (key, value) => setConn((current) => ({ ...current, [key]: value }))
  return <section className="connect-panel">
    <div className="connect-heading"><span className="connect-symbol" aria-hidden="true">⌘</span><div><h2>连接 Linux 实验电脑</h2><p>先连接并查看基本条件，开始前再检查传感器和可用核心。</p></div></div>
    <form className="connection-form" onSubmit={probe}>
      <div className="host-field" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setShowHistory(false) }}>
        <label className="form-label"><span>电脑地址</span><input className="form-input" value={conn.host} placeholder="输入 IP 或主机名" autoComplete="off" spellCheck={false} onChange={(event) => { hostEdited.current = true; update('host', event.target.value) }} onFocus={() => setShowHistory(true)} onBlur={() => { if (hostEdited.current) onRememberHost?.(conn.host); hostEdited.current = false }} onKeyDown={(event) => { if (event.key === 'Escape') setShowHistory(false) }} aria-expanded={showHistory && hostHistory.length > 0} aria-controls="host-history" /></label>
        {showHistory && hostHistory.length > 0 && <div id="host-history" className="host-history"><div className="host-history-heading">最近输入的地址</div><ul>{hostHistory.map((host) => <li key={host}><button type="button" className="host-history-select" onMouseDown={(event) => event.preventDefault()} onClick={() => { update('host', host); hostEdited.current = false; setShowHistory(false) }}>{host}</button><button type="button" className="host-history-remove" aria-label={`删除地址 ${host}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (host === conn.host.trim()) hostEdited.current = false; onRemoveHost(host) }}>×</button></li>)}</ul></div>}
        <p className="field-hint">仅在此浏览器记住电脑地址，可随时删除。</p>
      </div>
      <div className="form-row">
        <label className="form-label"><span>登录账号</span><input className="form-input" value={conn.user} placeholder="请输入普通账号" autoCapitalize="none" onChange={(event) => update('user', event.target.value)} /></label>
        <label className="form-label"><span>{conn.auth === 'password' ? '登录密码' : '登录密钥'}</span>{conn.auth === 'password' ? <input type="password" className="form-input" value={conn.secret} autoComplete="off" placeholder="请输入密码" onChange={(event) => update('secret', event.target.value)} /> : <textarea rows={3} className="form-input" value={conn.secret} placeholder="粘贴完整密钥内容" onChange={(event) => update('secret', event.target.value)} />}</label>
      </div>
      <button type="button" className="advanced-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '−' : '+'} 更多连接设置</button>
      {expanded && <div className="advanced-settings"><label className="form-label"><span>连接端口</span><input className="form-input" value={conn.port} inputMode="numeric" onChange={(event) => update('port', event.target.value)} /></label><fieldset><legend>登录方式</legend>{[['password', '使用密码'], ['key', '使用密钥']].map(([value, label]) => <label key={value}><input type="radio" checked={conn.auth === value} onChange={() => setConn((current) => ({ ...current, auth: value, secret: '' }))} />{label}</label>)}</fieldset></div>}
      <label className="authorization-check"><input type="checkbox" checked={conn.authorized} onChange={(event) => update('authorized', event.target.checked)} /><span>{professional ? '我有权连接并检查这台电脑' : '我有权使用这台电脑，并允许连接后自动开始短时 CPU 收发实验'}</span></label>
      {err && <div role="alert" className="form-error">{err}</div>}
      <button type="submit" disabled={probing} className="primary-button form-submit">{probing ? '正在检查连接，请稍候…' : (professional ? '连接并检查 →' : '连接并开始实验 →')}</button>
      <div className="form-bottom">{professional ? '登录信息仅用于本次连接，不会保存' : '连接成功后会自动开始实验；登录信息仅用于本次连接，不会保存'}</div>
    </form>
  </section>
}
