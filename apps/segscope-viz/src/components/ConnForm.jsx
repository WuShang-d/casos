import { useRef, useState } from 'react'

const inputCls = 'form-input'

export default function ConnForm({ conn, setConn, onSubmit, probing, variant = 'simple', submitLabel = '连接并查看', err, hostHistory = [], onRememberHost, onRemoveHost }) {
  const hostEdited = useRef(false)
  const [showHistory, setShowHistory] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const set = (key) => (e) => setConn({ ...conn, [key]: e.target.value })
  const full = variant === 'full'
  return (
    <form onSubmit={onSubmit} className="connection-form">
      <div className="host-field" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setShowHistory(false) }}>
        <label className="form-label"><span>{full ? '目标机地址' : '电脑地址'}</span><input value={conn.host} onChange={(event) => { hostEdited.current = true; set('host')(event) }} onFocus={() => setShowHistory(true)} onBlur={() => { if (hostEdited.current) onRememberHost?.(conn.host); hostEdited.current = false }} onKeyDown={(event) => { if (event.key === 'Escape') setShowHistory(false) }} placeholder="例如 192.168.1.100" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputCls} aria-expanded={showHistory && hostHistory.length > 0} aria-controls="host-history" /></label>
        {showHistory && hostHistory.length > 0 && <div id="host-history" className="host-history" aria-label="电脑地址历史"><div className="host-history-heading">最近输入的地址</div><ul>{hostHistory.map((host) => <li key={host}><button type="button" className="host-history-select" onMouseDown={(event) => event.preventDefault()} onClick={() => { setConn({ ...conn, host }); setShowHistory(false) }}>{host}</button><button type="button" className="host-history-remove" aria-label={`删除地址 ${host}`} title="删除这个地址" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (host === conn.host.trim()) hostEdited.current = false; onRemoveHost?.(host) }}>×</button></li>)}</ul></div>}
        <p className="host-history-note">仅在此浏览器记住电脑地址，可随时删除。</p>
      </div>
      <div className="form-row">
        <label className="form-label"><span>登录账号</span><input value={conn.user} onChange={set('user')} placeholder="请输入账号" autoCapitalize="none" spellCheck={false} className={inputCls} /></label>
        <label className="form-label"><span>{conn.auth === 'password' ? '登录密码' : '登录密钥'}</span>{conn.auth === 'password'
          ? <input type="password" autoComplete="off" value={conn.secret} onChange={set('secret')} placeholder="请输入密码" className={inputCls} />
          : <textarea rows={3} value={conn.secret} onChange={set('secret')} placeholder="粘贴登录密钥内容" className={`${inputCls} font-mono text-xs`} />}</label>
      </div>
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={full || expanded} className="advanced-toggle">{full || expanded ? '−' : '+'} 更多连接设置</button>
      {(full || expanded) && <div className="advanced-settings"><label className="form-label"><span>连接端口</span><input value={conn.port} onChange={set('port')} inputMode="numeric" className={inputCls} /></label><fieldset><legend>登录方式</legend><label><input type="radio" checked={conn.auth === 'password'} onChange={() => setConn({ ...conn, auth: 'password', secret: '' })} /> 使用密码</label><label><input type="radio" checked={conn.auth === 'key'} onChange={() => setConn({ ...conn, auth: 'key', secret: '' })} /> 使用密钥</label></fieldset></div>}
      <label className="authorization-check"><input type="checkbox" checked={conn.authorized} onChange={(e) => setConn({ ...conn, authorized: e.target.checked })} /><span>我有权连接并检查这台电脑</span></label>
      {err && <div role="alert" className="form-error">{err}</div>}
      <button type="submit" disabled={probing} className="primary-button form-submit">{probing ? '正在连接，请稍候…' : submitLabel}{!probing && <span>→</span>}</button>
    </form>
  )
}
