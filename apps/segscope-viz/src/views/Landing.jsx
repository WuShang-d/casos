import { useRef, useState } from 'react'
import { parseE2Log } from '../lib/parse.js'
import ProbeResult from '../components/ProbeResult.jsx'

export default function Landing({ onEnter }) {
  const [host, setHost] = useState('')
  const [user, setUser] = useState('root')
  const [port, setPort] = useState('22')
  const [auth, setAuth] = useState('password')
  const [secret, setSecret] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [err, setErr] = useState('')
  const [probing, setProbing] = useState(false)
  const [result, setResult] = useState(null)
  const [target, setTarget] = useState('')
  const fileRef = useRef(null)

  async function connect(e) {
    e.preventDefault()
    setErr('')
    setResult(null)
    if (!host.trim()) return setErr('请填写目标机 IP / 主机名')
    if (!authorized) return setErr('请先确认这是你拥有或获授权的机器')
    setProbing(true)
    setTarget(`${user.trim()}@${host.trim()}`)
    try {
      const res = await fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(), port: port.trim() || '22', user: user.trim(),
          authType: auth, password: auth === 'password' ? secret : '',
          privateKey: auth === 'key' ? secret : '',
        }),
      })
      const data = await res.json()
      if (data.error) setErr(data.error)
      else setResult(data)
    } catch (e) {
      setErr('无法连接采集后端：' + String(e))
    } finally {
      setProbing(false)
    }
  }

  function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseE2Log(String(reader.result || ''))
      if (!rows.length) { setErr('未能从该文件解析出 E2 log.csv 数据行'); return }
      onEnter({ source: 'upload', fileName: f.name, e2rows: rows })
    }
    reader.readAsText(f)
  }

  const inputCls = 'mt-1 w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm outline-none transition focus:border-accent'

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">SegScope 侧信道平台</h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted">
          探测目标机能否运行 SegScope，并可视化已采集的侧信道结果。只消费离线数据，不在页面内发起攻击。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <section className="card lg:col-span-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">⊹</span>
            <h3 className="text-sm font-semibold text-slate-900">连接物理机 · 能力探测</h3>
          </div>
          <p className="mt-1 text-xs text-muted">用 SSH 只读检测目标机能否运行 SegScope（不运行攻击、不加载内核模块）。仅限你拥有或获授权的机器。</p>
          <form onSubmit={connect} className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 block">
                <span className="text-xs text-muted">目标机 IP / 主机名</span>
                <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.12" className={inputCls} />
              </label>
              <label className="block">
                <span className="text-xs text-muted">端口</span>
                <input value={port} onChange={(e) => setPort(e.target.value)} className={inputCls} />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-muted">用户名</span>
                <input value={user} onChange={(e) => setUser(e.target.value)} className={inputCls} />
              </label>
              <label className="col-span-2 block">
                <span className="text-xs text-muted">{auth === 'password' ? '密码' : 'SSH 私钥内容（粘贴）'}</span>
                {auth === 'password' ? (
                  <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" placeholder="••••••••" className={inputCls} />
                ) : (
                  <textarea value={secret} onChange={(e) => setSecret(e.target.value)} rows={2}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className={`${inputCls} font-mono text-xs`} />
                )}
              </label>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted">
              <label className="flex items-center gap-1.5"><input type="radio" checked={auth === 'key'} onChange={() => setAuth('key')} /> SSH 密钥（推荐）</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={auth === 'password'} onChange={() => setAuth('password')} /> 密码</label>
            </div>
            <label className="flex items-start gap-2 text-xs text-muted">
              <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-0.5" />
              <span>我确认这是我拥有或获授权的实验室机器。凭据仅用于建立 SSH，不会被保存。</span>
            </label>
            {err && <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
            <button type="submit" disabled={probing}
              className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-60">
              {probing ? '正在探测…' : '连接并探测'}
            </button>
          </form>
        </section>

        <section className="card flex flex-col lg:col-span-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent2/15 text-accent2">↥</span>
            <h3 className="text-sm font-semibold text-slate-900">上传采集结果</h3>
          </div>
          <p className="mt-1 text-xs text-muted">已在授权机器上采集好的结果文件，直接可视化分析。当前支持 E2 <code>log.csv</code>（增强 Spectral 误码率扫描）。</p>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()}
            className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-edge py-8 text-sm text-muted transition hover:border-accent2 hover:bg-slate-50">
            <span className="text-2xl text-accent2">↥</span>
            选择 log.csv 文件
          </button>
        </section>
      </div>

      {result && <ProbeResult target={target} facts={result.facts} raw={result.raw} />}

      <p className="mx-auto mt-8 max-w-2xl text-center text-[11px] text-muted">
        能力探测只读、不运行攻击。完整采集（root、内核模块、异步任务）需在你独占授权的专用裸机上进行，不要用于共享服务器。
      </p>
    </div>
  )
}
