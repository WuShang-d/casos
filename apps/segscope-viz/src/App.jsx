import { useEffect, useRef, useState } from 'react'
import Simple from './views/Simple.jsx'
import Pro from './views/Pro.jsx'
import { HOST_HISTORY_KEY, readHosts, rememberHost } from './lib/hostHistory.js'

const initConn = { host: '', port: '22', user: '', auth: 'password', secret: '', authorized: false }

export default function App() {
  const [hostHistory, setHostHistory] = useState(() => { try { return readHosts(localStorage) } catch { return [] } })
  useEffect(() => { try { localStorage.setItem(HOST_HISTORY_KEY, JSON.stringify(hostHistory)) } catch {} }, [hostHistory])
  const onRememberHost = (host) => setHostHistory((current) => rememberHost(current, host))
  const onRemoveHost = (host) => setHostHistory((current) => current.filter((value) => value !== host))
  const activeProbe = useRef(null)
  const [homeVersion, setHomeVersion] = useState(0)
  function goHome() {
    activeProbe.current?.abort()
    activeProbe.current = null
    setProbing(false); setFacts(null); setErr(''); setMode('simple')
    setHomeVersion((version) => version + 1)
    window.scrollTo({ top: 0 })
  }
  const [mode, setMode] = useState('simple')
  const [results, setResults] = useState({})
  const [jobs, setJobs] = useState(() => { try { return JSON.parse(sessionStorage.getItem('segscope-jobs') || '{}') } catch { return {} } })
  useEffect(() => { try { sessionStorage.setItem('segscope-jobs', JSON.stringify(jobs)) } catch {} }, [jobs])
  const [proTab, setProTab] = useState('probe')
  const [selectedExperiment, setSelectedExperiment] = useState('E1')
  const [conn, setConn] = useState(initConn)
  const [facts, setFacts] = useState(null)
  const [probing, setProbing] = useState(false)
  const [err, setErr] = useState('')

  async function probe(e) {
    e?.preventDefault?.()
    setErr('')
    setFacts(null)
    if (!conn.host.trim()) return setErr('请填写电脑地址')
    if (!conn.user.trim()) return setErr('请填写登录账号')
    if (!/^\d+$/.test(conn.port.trim() || '22') || Number(conn.port || 22) < 1 || Number(conn.port || 22) > 65535) return setErr('连接端口需要是 1–65535 之间的数字，请在“更多连接设置”中修改。')
    if (!conn.secret.trim()) return setErr(conn.auth === 'password' ? '请填写登录密码' : '请填写登录密钥')
    if (!conn.authorized) return setErr('请确认你有权连接并检查这台电脑')
    onRememberHost(conn.host)
    setProbing(true)
    const controller = new AbortController()
    activeProbe.current = controller
    const timer = setTimeout(() => controller.abort(), 45000)
    try {
      const response = await fetch('/api/probe', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: conn.host.trim(), port: conn.port.trim() || '22', user: conn.user.trim(),
          authType: conn.auth, password: conn.auth === 'password' ? conn.secret : '',
          privateKey: conn.auth === 'key' ? conn.secret : '',
        }),
      })
      if (activeProbe.current !== controller) return
      if (!response.headers.get('content-type')?.includes('application/json')) {
        setErr('连接服务暂时不可用，请稍后刷新页面重试。你的电脑还没有开始检查。')
        return
      }
      const data = await response.json()
      if (activeProbe.current !== controller) return
      if (data.error) setErr(data.error)
      else if (!response.ok || !data.facts?.KERNEL || !data.facts?.ARCH) setErr('没有收到完整的检查结果，请稍后重试。')
      else setFacts(data.facts)
    } catch (e2) {
      if (activeProbe.current !== controller) return
      setErr(e2.name === 'AbortError' ? '等待连接的时间过长，请检查电脑是否在线后重试。' : '无法联系检查服务，请确认网络连接正常后重试。')
    } finally {
      clearTimeout(timer)
      if (activeProbe.current === controller) { activeProbe.current = null; setProbing(false) }
    }
  }

  const shared = { goHome, hostHistory, onRememberHost, onRemoveHost, jobs, setJobs, selectedExperiment, setSelectedExperiment, proTab, setProTab, results, setResults, conn, setConn, facts, probing, err, probe }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <button type="button" className="brand" onClick={goHome} aria-label="使用痕迹分析，返回首页"><span>使用痕迹分析</span><span className="brand-divider" /><span className="brand-product">SegScope</span></button>
          <nav className="mode-switch" aria-label="页面模式">{[['simple', '简洁版'], ['pro', '专业版']].map(([value, label]) => <button key={value} onClick={() => setMode(value)} className={mode === value ? 'active' : ''} aria-current={mode === value ? 'page' : undefined}>{label}</button>)}</nav>
          <span className="header-caption">电脑信息检查</span>
        </div>
      </header>

      <main className="flex-1">
        {mode === 'simple' ? <Simple key={homeVersion} {...shared} toPro={(tab = 'probe') => { setProTab(tab); setMode('pro') }} /> : <Pro {...shared} />}
      </main>

      <footer className="app-footer"><span>SegScope · 使用痕迹分析</span><span>仅检查你有权使用的电脑 · 登录信息不保存</span></footer>
    </div>
  )
}
