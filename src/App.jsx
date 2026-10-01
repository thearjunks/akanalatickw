import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, BarChart3, Bot, Bug, CheckCircle2, Clock3, Download, GitCompareArrows,
  Eye, Globe2, Languages, Link2, MousePointer2, Radio, RefreshCw, Route, Search, Siren,
  Send, Settings2, ShieldCheck, ShoppingCart, Smartphone, TrendingUp, UserMinus, Users, X, XCircle, LogOut, LockKeyhole, UserCog,
  PanelLeftClose, PanelLeftOpen, MessageCircle, Minus, Maximize2, Minimize2
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { buildComparison } from './comparison.js'
import { answerAnalyticsQuestion } from './assistant.js'
import { analyzeBouncePage } from './bounce-analysis.js'

const API = '/api'
const palette = ['#24d17e', '#6ee7b7', '#38bdf8', '#a78bfa', '#fbbf24', '#fb7185']
const dashboardPaths = {
  overview: '/', journey: '/url-journey', 'plans-items': '/plans-items', 'journey-monitoring': '/journey-monitoring',
  funnels: '/funnels', lifecycle: '/app-lifecycle', adjust: '/adjust', comparison: '/ga4-vs-adjust',
  quality: '/engagement-stability', campaigns: '/campaigns', urls: '/url-inventory', playstore: '/app-stores', assistant: '/assistant', settings: '/settings', 'access-control': '/access-control'
}
const viewFromPath = pathname => pathname.replace(/\/+$/, '') === '/playstore' ? 'playstore' : Object.entries(dashboardPaths).find(([, path]) => path === (pathname.replace(/\/+$/, '') || '/'))?.[0] || 'overview'

async function request(path, options) {
  const response = await fetch(`${API}${path}`, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Request failed.')
  return payload
}

function number(value) {
  return new Intl.NumberFormat('en', { notation: value >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 0 }).format(value || 0)
}

function varianceForUi(compared, baseline) { return baseline ? (compared - baseline) / baseline : null }

function akGreeting(displayName) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', hour12: false }).format(new Date()))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const name = String(displayName || 'there').trim().split(/\s+/)[0]
  return `${greeting}, ${name}! I’m AK, your analytics assistant. How can I help you today?`
}

function kuwaitToday() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

async function answerAkQuestion(question, context) {
  const q = question.toLowerCase()
  if (/\btoday\b/.test(q) && /adjust/.test(q) && /install|first[ -]?open|download/.test(q)) {
    const date = kuwaitToday()
    const report = await request(`/adjust-installs?startDate=${date}&endDate=${date}&scope=app`)
    const byOs = new Map()
    for (const row of report.platforms || []) {
      const os = String(row.os_name || 'Not reported').toLowerCase()
      byOs.set(os, (byOs.get(os) || 0) + Number(row.installs || 0))
    }
    const breakdown = [...byOs.entries()].filter(([,value]) => value).map(([os,value]) => `${os === 'ios' ? 'iOS' : os === 'android' ? 'Android' : os}: ${number(value)}`).join(', ')
    return `For today in Kuwait (${date}), Adjust reports ${number(report.summary?.installs)} attributed app installs${breakdown ? ` — ${breakdown}` : ''}. Today is still in progress, so this value can increase as Adjust processes additional attribution data.`
  }
  return answerAnalyticsQuestion(question, context)
}

function dateLabel(value) {
  if (!value || value.length !== 8) return value
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function dateTimeLabel(value) {
  if (!value || value.length !== 12) return 'Time not reported'
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)}`
}

function percent(value) {
  return new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(value || 0)
}

function precisePercent(value) {
  return value == null ? '—' : new Intl.NumberFormat('en', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value)
}

function parseUtmUrl(rawUrl) {
  try {
    const fullUrl = rawUrl.startsWith('http') ? rawUrl : `https://www.stc.com.kw${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`
    const url = new URL(fullUrl)
    if (![...url.searchParams.keys()].some(key => key.startsWith('utm_'))) return null
    return { fullUrl: url.toString(), path: url.pathname, source: url.searchParams.get('utm_source') || '', medium: url.searchParams.get('utm_medium') || '', campaign: url.searchParams.get('utm_campaign') || '', id: url.searchParams.get('utm_id') || '', term: url.searchParams.get('utm_term') || '', content: url.searchParams.get('utm_content') || '' }
  } catch { return null }
}

function Metric({ icon: Icon, label, value, detail, tone = 'green' }) {
  return <article className="metric-card">
    <div className={`metric-icon ${tone}`}><Icon size={19} /></div>
    <div><p>{label}</p><strong>{value == null ? '—' : typeof value === 'string' ? value : number(value)}</strong><span>{detail}</span></div>
  </article>
}

const dashboardLabels = {
  overview: 'Main overview', journey: 'URL journey analyzer', 'plans-items': 'Plans & items', 'journey-monitoring': 'Journey Monitoring',
  funnels: 'Funnels', lifecycle: 'GA4 app lifecycle', adjust: 'Adjust analytics', comparison: 'GA4 vs Adjust', quality: 'Engagement & stability',
  campaigns: 'Campaigns & UTM', urls: 'STC URL inventory', playstore: 'App Stores', assistant: 'Ask AK'
}

function LoginScreen({ onLogin }) {
  const [requesting, setRequesting] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', displayName: '', note: '' })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      if (requesting) {
        await request('/auth/access-requests', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(form) })
        setMessage('Access request sent to the Super Admin.'); setForm({ username: '', password: '', displayName: '', note: '' })
      } else onLogin(await request('/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(form) }))
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <main className="auth-page"><section className="auth-card">
    <div className="auth-brand"><div className="brand-mark"><Activity size={24}/></div><div><strong>EventScope</strong><span>Analytics intelligence</span></div></div>
    <div><p className="eyebrow">{requesting ? 'Request access' : 'Secure dashboard'}</p><h1>{requesting ? 'Ask for dashboard access' : 'Sign in'}</h1><p>{requesting ? 'The Super Admin will choose which dashboards you can view.' : 'Use your approved EventScope account.'}</p></div>
    <form onSubmit={submit} className="auth-form">
      {requesting && <label>Full name<input required value={form.displayName} onChange={e => setForm({...form, displayName:e.target.value})}/></label>}
      <label>Username<input required autoComplete="username" value={form.username} onChange={e => setForm({...form, username:e.target.value})}/></label>
      {!requesting && <label>Password<input required type="password" autoComplete="current-password" value={form.password} onChange={e => setForm({...form, password:e.target.value})}/></label>}
      {requesting && <label>Reason for access<textarea value={form.note} onChange={e => setForm({...form, note:e.target.value})} placeholder="Which reports do you need?"/></label>}
      {message && <p className="auth-message">{message}</p>}
      <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : requesting ? 'Submit access request' : 'Sign in'}</button>
    </form>
    <button className="auth-switch" onClick={() => { setRequesting(!requesting); setMessage('') }}>{requesting ? 'Back to sign in' : 'Request access'}</button>
  </section></main>
}

function AccessControlView() {
  const [data, setData] = useState(null); const [message, setMessage] = useState('')
  const load = useCallback(() => request('/admin/users').then(setData).catch(error => setMessage(error.message)), [])
  useEffect(() => { load() }, [load])
  if (!data) return <Panel title="Access control" subtitle="Loading users and requests"><EmptyPanel title="Loading access records" copy={message || 'Reading approved users and pending requests.'}/></Panel>
  const pending = data.requests.filter(item => item.status === 'pending')
  return <section className="access-grid">
    <Panel title="Pending access requests" subtitle="Approve a username, temporary password and dashboard permissions">
      {pending.length ? pending.map(item => <AccessRequestRow key={item.id} item={item} onChanged={load}/>) : <EmptyPanel title="No pending requests" copy="New access requests will appear here."/>}
    </Panel>
    <Panel title="Users" subtitle="Passwords are securely hashed and cannot be viewed; the Super Admin can reset them">
      {data.users.map(user => <UserAccessRow key={user.id} user={user} onChanged={load}/>) }
    </Panel>
  </section>
}

function DashboardChecks({ selected, onChange, disabled }) {
  return <div className="dashboard-checks">{Object.entries(dashboardLabels).map(([key,label]) => <label key={key}><input type="checkbox" checked={selected.includes(key)} disabled={disabled} onChange={() => onChange(selected.includes(key) ? selected.filter(item => item !== key) : [...selected,key])}/>{label}</label>)}</div>
}

function AccessRequestRow({ item, onChanged }) {
  const [dashboards, setDashboards] = useState([]); const [password, setPassword] = useState(''); const [message, setMessage] = useState('')
  async function decide(decision) { try { await request(`/admin/requests/${item.id}/${decision}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ dashboards, password }) }); onChanged() } catch(error) { setMessage(error.message) } }
  return <article className="access-row"><div><strong>{item.displayName}</strong><code>{item.username}</code><span>{item.note || 'No reason supplied'} · {new Date(item.createdAt).toLocaleString()}</span></div><DashboardChecks selected={dashboards} onChange={setDashboards}/><input type="password" placeholder="Temporary password" value={password} onChange={e => setPassword(e.target.value)}/>{message && <small>{message}</small>}<div className="access-actions"><button className="primary-button compact" onClick={() => decide('approve')}>Approve</button><button className="secondary-button compact" onClick={() => decide('reject')}>Reject</button></div></article>
}

function UserAccessRow({ user, onChanged }) {
  const locked = user.role === 'super_admin'; const [dashboards, setDashboards] = useState(user.dashboards); const [password, setPassword] = useState(''); const [message, setMessage] = useState('')
  async function update() { try { await request(`/admin/users/${user.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ dashboards, active:user.active }) }); setMessage('Permissions saved.'); onChanged() } catch(error) { setMessage(error.message) } }
  async function reset() { try { await request(`/admin/users/${user.id}/reset-password`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ password }) }); setPassword(''); setMessage('Password reset.'); onChanged() } catch(error) { setMessage(error.message) } }
  return <article className="access-row"><div><strong>{user.displayName}</strong><code>{user.username}</code><span>{locked ? 'Admin · Super Admin · all dashboards' : user.active ? 'Viewer · active' : 'Viewer · disabled'}</span></div><DashboardChecks selected={dashboards} onChange={setDashboards} disabled={locked}/>{!locked && <button className="secondary-button compact" onClick={update}>Save permissions</button>}<div className="reset-password"><input type="password" placeholder="New password" value={password} onChange={e => setPassword(e.target.value)}/><button className="secondary-button compact" disabled={!password} onClick={reset}>Reset password</button></div>{message && <small>{message}</small>}</article>
}

function DrillMetric({ icon: Icon, label, value, detail, tone = 'green', onClick }) {
  return <button className="metric-card metric-link" onClick={onClick}>
    <div className={`metric-icon ${tone}`}><Icon size={19} /></div>
    <div><p>{label}</p><strong>{value == null ? '—' : typeof value === 'string' ? value : number(value)}</strong><span>{detail}</span></div>
    <span className="metric-open">Open →</span>
  </button>
}

function MainOverviewView({ data, onOpen }) {
  const [salesType, setSalesType] = useState('Plans')
  const [voucherOrder, setVoucherOrder] = useState('selling')
  const [deviceOrder, setDeviceOrder] = useState('selling')
  const [activityCadence, setActivityCadence] = useState('daily')
  const [keywordCountry, setKeywordCountry] = useState('Kuwait')
  const [keywordRegion, setKeywordRegion] = useState('all')
  const activityTrend = useMemo(() => {
    const bucketDate = raw => {
      const iso = `${raw || ''}`.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
      const date = new Date(`${iso}T00:00:00Z`)
      if (Number.isNaN(date.valueOf()) || activityCadence === 'daily') return raw
      if (activityCadence === 'monthly') return `${raw.slice(0, 6)}01`
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
      return date.toISOString().slice(0, 10).replaceAll('-', '')
    }
    const grouped = new Map()
    for (const row of data?.appActivity?.trend || []) {
      const date = bucketDate(row.date)
      const item = grouped.get(date) || { date, installs: 0, uninstalls: 0, androidInstalls: 0, iosInstalls: 0 }
      const os = `${row.operatingSystem || row.platform || ''}`.toLowerCase()
      if (row.eventName === 'first_open') { item.installs += row.eventCount || 0; if (os.includes('android')) item.androidInstalls += row.eventCount || 0; if (os.includes('ios')) item.iosInstalls += row.eventCount || 0 }
      if (row.eventName === 'app_remove') item.uninstalls += row.eventCount || 0
      grouped.set(date, item)
    }
    return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [data, activityCadence])
  if (!data) return <Panel title="Main overview" subtitle="Loading connected analytics"><EmptyPanel title="Loading overview" copy="Querying sales, journeys, engagement, lifecycle and audience data." /></Panel>
  const topFailures = data.failures?.slice(0, 10) || []
  const topEngagement = data.engagement?.slice(0, 10) || []
  const orderedSales = (rows, order) => [...(rows || [])].sort((a, b) => order === 'recent' ? `${b.latestPurchaseDate || ''}`.localeCompare(`${a.latestPurchaseDate || ''}`) || (b.itemsPurchased || 0) - (a.itemsPurchased || 0) : (b.itemsPurchased || 0) - (a.itemsPurchased || 0)).slice(0, 25)
  const topDevices = orderedSales(data.devices, deviceOrder)
  const topVouchers = orderedSales(data.vouchers, voucherOrder)
  const reported = value => value && value !== '(not set)' ? value : 'Not reported'
  const planSegments = ['Prepaid', 'Postpaid', 'Youth postpaid', 'Postpaid internet', 'VIP postpaid', 'Roaming', 'Other']
  const selectedPlanSegment = salesType.startsWith('plan:') ? salesType.slice(5) : null
  const salesLabel = selectedPlanSegment ? `${selectedPlanSegment} plans` : salesType
  const selectedSales = (data.salesItems || []).filter(row => (selectedPlanSegment ? row.productType === 'Plans' && row.purchaseSegment === selectedPlanSegment : row.productType === salesType) && (row.itemsPurchased || 0) > 0)
  const selectedSalesTotal = selectedPlanSegment ? selectedSales.reduce((total, row) => total + (row.itemsPurchased || 0), 0) : data.purchases.find(row => row.productType === salesType)?.count || 0
  const highSellers = selectedSales.slice(0, 8)
  const lowSellers = [...selectedSales].sort((a, b) => (a.itemsPurchased || 0) - (b.itemsPurchased || 0)).slice(0, 8)
  const funnelForType = productType => productType === 'Vouchers' ? 'voucher' : productType === 'Recharges' ? 'recharge' : productType.startsWith('Roaming') ? 'roamingBundles' : productType === 'Qitaf' ? 'qitafJoin' : 'prepaid'
  const funnelForSegment = segment => segment === 'Youth postpaid' ? 'youthPostpaid' : segment === 'Postpaid internet' ? 'postpaidInternet' : segment === 'VIP postpaid' ? 'vipPostpaid' : segment === 'Roaming' ? 'roamingBundles' : segment === 'Postpaid' ? 'postpaid' : 'prepaid'
  const salesRows = (rows, emptyCopy) => <div className="table-wrap"><table><thead><tr><th>Item</th><th>Plan name</th><th>Offer ID</th><th>Variant</th><th>Category</th><th>Item ID</th><th>{salesType === 'Qitaf' ? 'Completed events' : 'Units sold'}</th><th>Revenue</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.itemId}-${row.itemVariant}-${index}`} className="click-row" onClick={() => onOpen(salesType === 'Devices' ? 'plans-items' : 'funnels', null, selectedPlanSegment ? funnelForSegment(selectedPlanSegment) : funnelForType(salesType))}><td><b>{reported(row.itemName)}</b><small>{reported(row.itemBrand)}</small></td><td><b>{reported(row.planName)}</b></td><td><code>{reported(row.offerId)}</code></td><td>{reported(row.itemVariant)}</td><td>{reported(row.itemCategory3 || row.itemCategory2 || row.itemCategory)}</td><td><code>{reported(row.itemId)}</code></td><td>{number(row.itemsPurchased)}</td><td>{row.itemRevenue == null ? '—' : number(row.itemRevenue)}</td></tr>)}{!rows.length && <tr><td colSpan="8" className="table-empty">{emptyCopy}</td></tr>}</tbody></table></div>
  const keywordRows = data.keywords?.siteSearch || []
  const keywordCountries = [...new Set(keywordRows.map(row => row.country).filter(value => value && !['(not set)','(other)'].includes(value)))].sort()
  const keywordRegions = [...new Set(keywordRows.filter(row => keywordCountry === 'all' || row.country === keywordCountry).map(row => row.region).filter(value => value && !['(not set)','(other)'].includes(value)))].sort()
  const keywordMap = new Map()
  for (const row of keywordRows.filter(row => (keywordCountry === 'all' || row.country === keywordCountry) && (keywordRegion === 'all' || row.region === keywordRegion))) {
    const term = row.searchTerm
    const item = keywordMap.get(term) || { term, uses: 0, users: 0, countries: new Set(), regions: new Set(), platforms: new Set() }
    item.uses += row.eventCount || 0
    item.users += row.totalUsers || 0
    if (row.country) item.countries.add(row.country)
    if (row.region) item.regions.add(row.region)
    if (row.platform) item.platforms.add(row.platform)
    keywordMap.set(term, item)
  }
  const topKeywords = [...keywordMap.values()].sort((a,b) => b.uses - a.uses).slice(0, 25)
  return <>
    <section className="overview-hero">
      <div>
        <p>Performance command centre</p>
        <h2>Sales, journeys and customers at a glance</h2>
        <span>Start with the four headline signals, then review sales, journey health and audience behaviour below.</span>
      </div>
      <div className="overview-hero-guide"><span>01</span>Snapshot <i/> <span>02</span>Sales <i/> <span>03</span>Journeys <i/> <span>04</span>Audience</div>
    </section>
    <section className="metric-grid overview-kpis">
      <DrillMetric icon={Siren} label="Journey failure events" value={data.summary.failureEvents} detail="Open failure records" tone="amber" onClick={() => onOpen('journey-monitoring')} />
      <DrillMetric icon={ShoppingCart} label="Recorded purchase events" value={data.summary.purchases} detail="Open plans and items" onClick={() => onOpen('plans-items')} />
      <DrillMetric icon={Smartphone} label="App installs" value={data.summary.installs} detail="Android and iOS first opens" tone="blue" onClick={() => onOpen('lifecycle')} />
      <DrillMetric icon={UserMinus} label="App uninstall events" value={data.summary.uninstalls} detail="Android app_remove coverage" tone="purple" onClick={() => onOpen('lifecycle')} />
    </section>
    <section className="overview-grid">
      <div className="overview-section-title"><span>01</span><div><h2>Sales and product performance</h2><p>Completed purchases, offer mix and the items driving sales.</p></div></div>
      <Panel className="overview-sales-panel" title="Purchases by offer type" subtitle="GA4 purchased-item counts where item detail is available">
        {data.purchases?.length ? <div className="overview-card-list">{data.purchases.map(row => <button key={row.productType} onClick={() => onOpen(row.productType === 'Devices' ? 'plans-items' : 'funnels', null, funnelForType(row.productType))}><span>{row.productType}</span><strong>{number(row.count)}</strong><small>Open dashboard →</small></button>)}</div> : <EmptyPanel title="No purchase breakdown" copy={data.availability.purchases || data.availability.devices || 'No purchase events were reported for this period.'} />}
        <div className="panel-note"><b>Completed plan and number purchases</b><br/>Purchased units by prepaid, postpaid and youth journey</div>
        <div className="overview-card-list">{(data.completedPlanPurchases?.segments || []).map(row => <button key={row.segment} onClick={() => onOpen('funnels', null, row.segment === 'Prepaid' ? 'prepaid' : row.segment === 'Youth postpaid' ? 'youthPostpaid' : row.segment === 'Postpaid internet' ? 'postpaidInternet' : row.segment === 'VIP postpaid' ? 'vipPostpaid' : row.segment === 'Roaming' ? 'roamingBundles' : 'postpaid')}><span>{row.segment}</span><strong>{number(row.segment === 'Prepaid' ? data.completedPlanPurchases.strictPrepaid?.completions : row.count)}</strong><small>{row.segment === 'Prepaid' ? `${number(data.completedPlanPurchases.strictPrepaid?.users)} users · purchase_prepaid →` : 'Purchased units →'}</small></button>)}</div>
        <p className="panel-note">Prepaid shows completed <code>purchase_prepaid</code> events and reported users because GA4 does not send item quantities for those App completions. Other journey cards remain GA4 <code>itemsPurchased</code> units; unclassified rows remain under Other.</p>
        <div className="panel-note"><b>Recharge purchases</b><br/>Kept separate from completed plan and number purchases</div>
        <div className="overview-card-list">{(data.rechargePurchases || []).filter(row => row.segment !== 'Other').map(row => <button key={`recharge-${row.segment}`} onClick={() => onOpen('funnels', null, row.segment === 'Postpaid' ? 'quickPay' : 'recharge')}><span>{row.segment} recharge</span><strong>{number(row.count)}</strong><small>Purchased units →</small></button>)}</div>
      </Panel>
      <Panel className="overview-app-panel" title="App activity" subtitle="GA4 first_open and app_remove by operating system">
        <div className="app-os-grid">{['android','ios'].map(os => <button key={os} onClick={() => onOpen('lifecycle')}><span>{os === 'ios' ? 'iOS' : 'Android'}</span><strong>{number(data.appActivity[os].installs)}</strong><small>installs / first opens</small><small>{number(data.appActivity[os].installUsers)} unique install users</small><div><b>{number(data.appActivity[os].uninstalls)}</b> uninstall events<small>{number(data.appActivity[os].uninstallUsers)} unique uninstall users</small></div></button>)}</div>
        <p className="panel-note">“Unique users” is an aggregated GA4 count; the Data API does not expose personal user identities. iOS uninstall counts are normally unavailable in GA4, so zero means no <code>app_remove</code> event was reported—not proof that nobody uninstalled.</p>
        <div className="app-insight-grid">
          <article><span>App installs</span><strong>{number(data.appActivity.android.installs + data.appActivity.ios.installs)}</strong><div><small>Android <b>{number(data.appActivity.android.installs)}</b></small><small>iOS <b>{number(data.appActivity.ios.installs)}</b></small></div></article>
          <article><span>App uninstalls</span><strong>{number(data.appActivity.android.uninstalls + data.appActivity.ios.uninstalls)}</strong><div><small>Android <b>{number(data.appActivity.android.uninstalls)}</b></small><small>iOS <b>{number(data.appActivity.ios.uninstalls)}</b></small></div></article>
          <article><span>Unique install users</span><strong>{number(data.appActivity.android.installUsers)} / {number(data.appActivity.ios.installUsers)}</strong><div><small>Android <b>{number(data.appActivity.android.installUsers)}</b></small><small>iOS <b>{number(data.appActivity.ios.installUsers)}</b></small></div></article>
          <article className="app-trend-card"><div className="app-trend-head"><span>Activity trend</span><select aria-label="App activity trend period" value={activityCadence} onChange={event => setActivityCadence(event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>{activityTrend.length ? <><strong className={activityTrend.length > 1 && activityTrend.at(-1).installs < activityTrend.at(-2).installs ? 'trend-down' : 'trend-up'}>{activityTrend.length > 1 ? `${activityTrend.at(-1).installs >= activityTrend.at(-2).installs ? '↑' : '↓'} ${number(Math.abs(activityTrend.at(-1).installs - activityTrend.at(-2).installs))}` : number(activityTrend[0].installs)}</strong><small>{activityTrend.length > 1 ? 'latest install change' : 'installs in selected period'}</small><div className="app-mini-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={activityTrend} margin={{top:5,right:0,left:0,bottom:0}}><CartesianGrid stroke="#e7eee9" vertical={false}/><XAxis dataKey="date" tickFormatter={dateLabel} tickLine={false} axisLine={false} interval="preserveStartEnd" fontSize={8}/><YAxis hide/><Tooltip labelFormatter={dateLabel}/><Bar dataKey="installs" name="Installs" fill="#24d17e" radius={[3,3,0,0]}/><Bar dataKey="uninstalls" name="Uninstalls" fill="#fb7185" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div></> : <small>No trend rows reported</small>}</article>
        </div>
      </Panel>
      <Panel className="overview-wide sales-intelligence" title="Completed sales quick view" subtitle="Highest- and lowest-selling reported items for every offer type" action={<label className="scope-filter">Offer type<select aria-label="Completed sales offer type" value={salesType} onChange={event => setSalesType(event.target.value)}><optgroup label="Offer types">{data.purchases.map(row => <option key={row.productType} value={row.productType}>{row.productType}</option>)}</optgroup><optgroup label="Plan journeys">{planSegments.map(segment => <option key={segment} value={`plan:${segment}`}>{segment}</option>)}</optgroup></select></label>}>
        <div className="sales-snapshot"><div><span>Selected type</span><strong>{salesLabel}</strong></div><div><span>{salesType === 'Qitaf' ? 'Completed Qitaf events' : 'Total purchased units'}</span><strong>{number(selectedSalesTotal)}</strong></div><div><span>Reported item rows</span><strong>{number(selectedSales.length)}</strong></div><div><span>Completion signal</span><strong>{salesType === 'Qitaf' ? 'joined / earned / spent' : selectedPlanSegment ? 'purchase · itemsPurchased' : data.purchaseEvents.find(row => `${row.eventName}`.toLowerCase().includes(salesType === 'Vouchers' ? 'voucher' : salesType === 'Devices' ? 'device' : salesType.startsWith('Roaming') ? 'roaming' : salesType === 'Add-ons' ? 'addon' : 'purchase'))?.eventName || 'purchase / item metric'}</strong></div></div>
        <div className="seller-grids">
          <section><h3>High-selling {salesLabel.toLowerCase()}</h3><p>Top items by purchased units</p>{salesRows(highSellers, `No item-level ${salesLabel.toLowerCase()} purchases were reported.`)}</section>
          <section><h3>Low-selling {salesLabel.toLowerCase()}</h3><p>Lowest non-zero items by purchased units</p>{salesRows(lowSellers, `No item-level ${salesLabel.toLowerCase()} purchases were reported.`)}</section>
        </div>
        <p className="panel-note">{salesType === 'Qitaf' ? 'Qitaf totals represent completed loyalty events: joined_qitaf, earned_points, and spend_points_activated. They are activities, not ecommerce sales or revenue.' : 'Low-selling lists exclude zero-unit rows. To keep the dashboard responsive, the quick view merges GA4’s 5,000 highest and 5,000 lowest purchased-item rows for the selected period. “Revenue” is shown only when GA4 received an item-level value; zero may indicate missing revenue instrumentation rather than a free item.'}</p>
      </Panel>
      <div className="overview-section-title"><span>02</span><div><h2>Journey health</h2><p>See where customers are blocked and open the detailed failure record.</p></div></div>
      <Panel className="overview-wide" title="Latest journey failures" subtitle="Date, source, app version, inferred journey, failure point and affected users" action={<button className="secondary-button compact" onClick={() => onOpen('journey-monitoring')}>View all</button>}>
        <div className="table-wrap"><table><thead><tr><th>Date and time</th><th>Source</th><th>App version</th><th>Journey</th><th>Page / screen</th><th>Failure point</th><th>Issue</th><th>Users</th><th>Events</th></tr></thead><tbody>
          {topFailures.map((row, index) => <tr key={`${row.dateHourMinute}-${row.eventName}-${index}`} className="click-row" onClick={() => onOpen('journey-monitoring')}><td className="nowrap">{dateTimeLabel(row.dateHourMinute)}</td><td><b>{row.channel || 'Not reported'}</b><small>{row.channel === 'App' ? row.platform || row.operatingSystem || 'Not reported' : 'Website'}</small></td><td>{row.channel === 'App' ? row.appVersion || 'Not reported' : 'Not applicable'}</td><td>{row.journey}</td><td>{row.pagePath || row.unifiedScreenName || 'Not reported'}</td><td><span className="issue-step">{row.step}</span></td><td>{row.issue}</td><td>{number(row.totalUsers)}</td><td>{number(row.eventCount)}</td></tr>)}
          {!topFailures.length && <tr><td colSpan="9" className="table-empty">{data.availability.failures || 'No failure events were reported for this period.'}</td></tr>}
        </tbody></table></div>
      </Panel>
      <div className="overview-section-title"><span>03</span><div><h2>Audience and discovery</h2><p>Understand the pages, searches and customer groups generating activity.</p></div></div>
      <Panel title="Most-used links and journeys" subtitle="Top pages by views and active users">
        {topEngagement.length ? <div className="compact-list overview-links">{topEngagement.map((row, index) => <button key={`${row.pagePath}-${index}`} onClick={() => onOpen('journey', row.pagePath)}><span className="rank">{String(index + 1).padStart(2, '0')}</span><span><b>{row.pageTitle || row.pagePath}</b><small>{row.journey} · {row.pagePath}</small></span><strong>{number(row.screenPageViews)}</strong></button>)}</div> : <EmptyPanel title="No engagement rows" copy={data.availability.engagement || 'No page activity was reported.'} />}
      </Panel>
      <Panel title="Customer insights" subtitle="Browsing users and ecommerce purchases where GA4 permits reporting">
        <div className="insight-columns">
          <div><h3>Country and region</h3>{data.customers.locations.slice(0, 6).map((row, index) => <button onClick={() => onOpen('quality')} key={`${row.country}-${row.region}-${index}`}><span>{row.country || '(not set)'} · {row.region || '(not set)'}</span><b>{number(row.activeUsers)} users</b><small>{number(row.ecommercePurchases)} purchases</small></button>)}</div>
          <div><h3>Age group</h3>{data.customers.ages.slice(0, 6).map((row, index) => <button onClick={() => onOpen('quality')} key={`${row.userAgeBracket}-${index}`}><span>{row.userAgeBracket || '(not set)'}</span><b>{number(row.activeUsers)} users</b><small>{number(row.ecommercePurchases)} purchases</small></button>)}</div>
        </div>
        <p className="panel-note">{data.availability.ages || data.availability.nationality}</p>
      </Panel>
      <Panel className="overview-wide" title="What users search for" subtitle="Actual searches performed on the STC website or app" action={<div className="keyword-controls"><select aria-label="Search country" value={keywordCountry} onChange={event => { setKeywordCountry(event.target.value); setKeywordRegion('all') }}><option value="all">All countries</option>{keywordCountries.map(country => <option key={country} value={country}>{country}</option>)}</select><select aria-label="Search region" value={keywordRegion} onChange={event => setKeywordRegion(event.target.value)}><option value="all">All governorates / regions</option>{keywordRegions.map(region => <option key={region} value={region}>{region}</option>)}</select></div>}>
        {topKeywords.length ? <div className="keyword-layout"><div className="bar-list keyword-bars">{topKeywords.slice(0,10).map((row,index) => <div className="bar-row" key={row.term}><div><span>{row.term}</span><strong>{number(row.uses)}</strong></div><div className="bar-track"><i style={{width:`${row.uses / Math.max(1,topKeywords[0].uses) * 100}%`,background:palette[index % palette.length]}}/></div></div>)}</div><div className="table-wrap"><table><thead><tr><th>Search word</th><th>Searches</th><th>Users</th><th>Platform</th><th>Country</th><th>Governorate / region</th></tr></thead><tbody>{topKeywords.map(row => <tr key={row.term}><td><b>{row.term}</b></td><td>{number(row.uses)}</td><td>{number(row.users)}</td><td>{[...row.platforms].join(', ') || 'Not reported'}</td><td>{[...row.countries].join(', ') || 'Not reported'}</td><td>{[...row.regions].slice(0,3).join(', ') || 'Not reported'}</td></tr>)}</tbody></table></div></div> : <EmptyPanel title="No website searches reported" copy={data.availability.siteSearch || 'GA4 returned no customer website/app search terms for this country and governorate selection.'} />}
        <div className="coverage-note keyword-coverage"><ShieldCheck size={17}/><div><strong>What is included</strong><span>This table contains only actual <code>view_search_results</code> searches with a <code>search_term</code>. UTM terms are kept in Campaigns &amp; UTM and are not presented as customer searches. {data.availability.googleOrganicSearch}</span></div></div>
      </Panel>
      <div className="overview-section-title"><span>04</span><div><h2>Product sales detail</h2><p>Compare top-selling and recently reported voucher and device purchases.</p></div></div>
      <Panel className="overview-wide" title="Purchased vouchers" subtitle="Voucher sales by brand, denomination, platform and latest reported purchase date" action={<div className="detail-panel-actions"><select aria-label="Voucher sales order" value={voucherOrder} onChange={event => setVoucherOrder(event.target.value)}><option value="selling">Best selling</option><option value="recent">Recently sold</option></select><button className="secondary-button compact" onClick={() => onOpen('funnels', null, 'voucher')}>View voucher funnel</button></div>}>
        <div className="table-wrap"><table><thead><tr><th>Latest reported</th><th>Brand</th><th>Voucher</th><th>Denomination / variant</th><th>Item ID</th><th>Platform</th><th>Purchased units</th><th>Revenue</th></tr></thead><tbody>
          {topVouchers.map((row, index) => <tr key={`${row.platform}-${row.itemId}-${row.itemVariant}-${index}`} className="click-row" onClick={() => onOpen('funnels', null, 'voucher')}><td className="nowrap">{row.latestPurchaseDate ? dateLabel(row.latestPurchaseDate) : 'Not reported'}</td><td>{reported(row.itemBrand)}</td><td>{reported(row.itemName)}</td><td>{reported(row.itemVariant || row.itemCategory3 || row.itemCategory2)}</td><td>{reported(row.itemId)}</td><td>{reported(row.platform)}</td><td>{number(row.itemsPurchased)}</td><td>{row.itemRevenue == null ? '—' : number(row.itemRevenue)}</td></tr>)}
          {!topVouchers.length && <tr><td colSpan="8" className="table-empty">{data.availability.purchases || 'No purchased-voucher rows with item detail were reported.'}</td></tr>}
        </tbody></table></div>
        <p className="panel-note">Recently sold uses the latest GA4 purchase date reported for each aggregated voucher row. GA4 Data API does not expose an individual customer’s exact purchase sequence here.</p>
      </Panel>
      <Panel className="overview-wide" title="Completed device purchases" subtitle="Purchased devices by category, model, variant, platform and latest reported purchase date" action={<div className="detail-panel-actions"><select aria-label="Device sales order" value={deviceOrder} onChange={event => setDeviceOrder(event.target.value)}><option value="selling">Best selling</option><option value="recent">Recently sold</option></select><button className="secondary-button compact" onClick={() => onOpen('plans-items')}>View products</button></div>}>
        <div className="table-wrap"><table><thead><tr><th>Latest reported</th><th>Category</th><th>Model</th><th>Variant</th><th>Item ID</th><th>Brand</th><th>Platform</th><th>Purchased units</th><th>Revenue</th></tr></thead><tbody>
          {topDevices.map((row, index) => <tr key={`${row.platform}-${row.itemId}-${row.itemVariant}-${index}`} className="click-row" onClick={() => onOpen('plans-items')}><td className="nowrap">{row.latestPurchaseDate ? dateLabel(row.latestPurchaseDate) : 'Not reported'}</td><td>{reported(row.itemCategory3 || row.itemCategory2 || row.itemCategory) === 'Not reported' ? 'Device' : reported(row.itemCategory3 || row.itemCategory2 || row.itemCategory)}</td><td>{reported(row.itemName)}</td><td>{reported(row.itemVariant)}</td><td>{reported(row.itemId)}</td><td>{reported(row.itemBrand)}</td><td>{reported(row.platform)}</td><td>{number(row.itemsPurchased)}</td><td>{row.itemRevenue == null ? '—' : number(row.itemRevenue)}</td></tr>)}
          {!topDevices.length && <tr><td colSpan="9" className="table-empty">{data.availability.devices || 'No purchased-device rows with item detail were reported.'}</td></tr>}
        </tbody></table></div>
        <p className="panel-note">Best selling ranks purchased units. Recently sold ranks the latest GA4 purchase date for each aggregated device row. All, Web and App follow the dashboard platform filter.</p>
      </Panel>
      <div className="coverage-note overview-wide"><ShieldCheck size={17}/><div><strong>Coverage</strong><span>All values use the selected date and platform filters. Journey labels are inferred from reported page paths and event names when GA4 does not attach a journey identifier. Nationality appears only if a consented registered custom dimension becomes available.</span></div></div>
    </section>
  </>
}

function CampaignsView({ data }) {
  const [trafficFilter, setTrafficFilter] = useState('all')
  const [campaignPage, setCampaignPage] = useState(0)
  const [utmPage, setUtmPage] = useState(0)
  const analyticsRows = data?.campaigns || []
  const campaignPageSize = 100
  const campaignPages = Math.max(1, Math.ceil(analyticsRows.length / campaignPageSize))
  const visibleAnalyticsRows = analyticsRows.slice(campaignPage * campaignPageSize, (campaignPage + 1) * campaignPageSize)
  const registry = useMemo(() => (data?.registry || []).map(item => {
    const matches = analyticsRows.filter(row =>
      (!item.campaignId || row.sessionCampaignId === item.campaignId) &&
      (!item.campaignName || row.sessionCampaignName === item.campaignName) &&
      row.sessionSource === item.campaignSource && row.sessionMedium === item.campaignMedium)
    return { ...item, sessions: matches.reduce((sum, row) => sum + (row.sessions || 0), 0), users: matches.reduce((sum, row) => sum + (row.activeUsers || 0), 0), purchases: matches.reduce((sum, row) => sum + (row.ecommercePurchases || 0), 0), revenue: matches.reduce((sum, row) => sum + (row.totalRevenue || 0), 0) }
  }), [data, analyticsRows])
  const filteredRegistry = registry.filter(row => trafficFilter === 'all' || (trafficFilter === 'active' ? row.sessions > 0 : row.sessions === 0))
  const utmUrls = useMemo(() => {
    const byUrl = new Map()
    const add = (rawUrl, metrics = {}, origin = 'Exact registered URL') => {
      const parsed = parseUtmUrl(rawUrl); if (!parsed) return
      const item = byUrl.get(parsed.fullUrl) || { ...parsed, origin, sessions: 0, users: 0, purchases: 0, revenue: 0 }
      item.sessions += metrics.sessions || 0; item.users += metrics.users || 0; item.purchases += metrics.purchases || 0; item.revenue += metrics.revenue || 0
      byUrl.set(item.fullUrl, item)
    }
    ;(data?.registry || []).forEach(row => add(row.campaignUrl))
    analyticsRows.forEach(row => {
      const valid = value => value && !['(not set)','(other)','(direct)','(not provided)'].includes(String(value).toLowerCase())
      let reportedUrl = row.landingPagePlusQueryString || ''
      const usableLandingPage = reportedUrl.startsWith('/') && !reportedUrl.startsWith('/(not')
      const paidCampaign = valid(row.sessionCampaignName) && !['(organic)','organic'].includes(String(row.sessionCampaignName).toLowerCase()) && String(row.sessionMedium).toLowerCase() !== 'organic'
      if (!reportedUrl.includes('utm_') && usableLandingPage && paidCampaign && valid(row.sessionSource) && valid(row.sessionMedium)) {
        try {
          const url = new URL(reportedUrl.startsWith('http') ? reportedUrl : `https://www.stc.com.kw${reportedUrl.startsWith('/') ? '' : '/'}${reportedUrl}`)
          url.searchParams.set('utm_source', row.sessionSource); url.searchParams.set('utm_medium', row.sessionMedium); url.searchParams.set('utm_campaign', row.sessionCampaignName)
          if (valid(row.sessionCampaignId)) url.searchParams.set('utm_id', row.sessionCampaignId)
          if (valid(row.sessionManualTerm)) url.searchParams.set('utm_term', row.sessionManualTerm)
          if (valid(row.sessionManualAdContent)) url.searchParams.set('utm_content', row.sessionManualAdContent)
          reportedUrl = url.toString()
        } catch {}
      }
      if (reportedUrl.includes('utm_')) add(reportedUrl, { sessions: row.sessions, users: row.activeUsers, purchases: row.ecommercePurchases, revenue: row.totalRevenue }, reportedUrl === row.landingPagePlusQueryString ? 'GA4 reported URL' : 'Reconstructed from GA4 dimensions')
    })
    return [...byUrl.values()].sort((a,b) => b.sessions - a.sessions || a.fullUrl.localeCompare(b.fullUrl))
  }, [data, analyticsRows])
  const utmPageSize = 100
  const utmPages = Math.max(1, Math.ceil(utmUrls.length / utmPageSize))
  const visibleUtmUrls = utmUrls.slice(utmPage * utmPageSize, (utmPage + 1) * utmPageSize)
  if (!data) return <Panel title="Campaign & UTM monitoring" subtitle="Loading campaign analytics"><EmptyPanel title="Loading campaigns" copy="Querying GA4 campaign attribution and the production link registry." /></Panel>
  const topCampaigns = analyticsRows.slice(0, 10)
  return <>
    <section className="metric-grid">
      <Metric icon={Link2} label="Production links" value={registry.length} detail={`${registry.filter(row => row.sessions > 0).length} receiving tracked traffic`} />
      <Metric icon={MousePointer2} label="Campaign sessions" value={data.summary.sessions} detail={`${number(data.summary.users)} summed row-level users`} tone="blue" />
      <Metric icon={ShoppingCart} label="Campaign purchases" value={data.summary.purchases} detail="GA4 ecommerce purchases" tone="purple" />
      <Metric icon={TrendingUp} label="Campaign revenue" value={data.summary.revenue} detail="GA4 reported total revenue" tone="amber" />
    </section>
    <section className="campaign-layout">
      <Panel title="Top campaign activity" subtitle="Highest-session GA4 campaign rows">
        {topCampaigns.length ? <div className="bar-list campaign-bars">{topCampaigns.map((row,index) => <div className="bar-row" key={`${row.sessionCampaignName}-${row.sessionSource}-${index}`}><div><span>{row.sessionCampaignName || '(not set)'}<small>{row.sessionSource} / {row.sessionMedium}</small></span><strong>{number(row.sessions)}</strong></div><div className="bar-track"><i style={{width:`${row.sessions / Math.max(1,topCampaigns[0].sessions) * 100}%`,background:palette[index % palette.length]}}/></div></div>)}</div> : <EmptyPanel title="No campaign traffic" copy="GA4 has not reported campaign-attributed sessions for this period." />}
      </Panel>
      <Panel className="table-panel" title="Production campaign registry" subtitle="Saved tagged links remain visible before and after traffic arrives" action={<select aria-label="Campaign traffic status" value={trafficFilter} onChange={e => setTrafficFilter(e.target.value)}><option value="all">All links</option><option value="active">Receiving traffic</option><option value="inactive">No traffic yet</option></select>}>
        <div className="table-wrap"><table><thead><tr><th>Created</th><th>Campaign</th><th>Source / medium</th><th>ID</th><th>Term / content</th><th>Sessions</th><th>Users</th><th>Purchases</th><th>Revenue</th><th>Production link</th></tr></thead><tbody>{filteredRegistry.map(row => <tr key={row.id}><td className="nowrap">{new Date(row.createdAt).toLocaleDateString()}</td><td>{row.campaignName || 'Name not supplied'}</td><td>{row.campaignSource} / {row.campaignMedium}</td><td>{row.campaignId || '—'}</td><td>{row.campaignTerm || '—'} / {row.campaignContent || '—'}</td><td>{number(row.sessions)}</td><td>{number(row.users)}</td><td>{number(row.purchases)}</td><td>{number(row.revenue)}</td><td><a href={row.campaignUrl} target="_blank" rel="noreferrer">Open link</a><small>{row.campaignUrl}</small></td></tr>)}{!filteredRegistry.length && <tr><td colSpan="10" className="table-empty">No registered production links match this filter.</td></tr>}</tbody></table></div>
      </Panel>
      <Panel className="table-panel" title="All UTM URLs" subtitle="Complete tagged URLs from the production registry and GA4 landing pages">
        <div className="table-wrap"><table><thead><tr><th>Full URL</th><th>URL evidence</th><th>Source</th><th>Medium</th><th>Campaign</th><th>Campaign ID</th><th>Term</th><th>Content</th><th>Sessions</th><th>Users</th><th>Purchases</th><th>Revenue</th></tr></thead><tbody>{visibleUtmUrls.map(row => <tr key={row.fullUrl}><td className="utm-full-url"><a href={row.fullUrl} target="_blank" rel="noreferrer">{row.fullUrl}</a></td><td>{row.origin}</td><td>{row.source || '—'}</td><td>{row.medium || '—'}</td><td>{row.campaign || '—'}</td><td>{row.id || '—'}</td><td>{row.term || '—'}</td><td>{row.content || '—'}</td><td>{number(row.sessions)}</td><td>{number(row.users)}</td><td>{number(row.purchases)}</td><td>{number(row.revenue)}</td></tr>)}{!visibleUtmUrls.length && <tr><td colSpan="12" className="table-empty">No registered or GA4-attributed campaign URLs were found for this period.</td></tr>}</tbody></table></div>
        <div className="pagination"><span>{number(utmUrls.length)} unique UTM URLs · page {utmPage + 1} of {utmPages}</span><button className="secondary-button compact" disabled={!utmPage} onClick={() => setUtmPage(page => Math.max(0,page - 1))}>Previous</button><button className="secondary-button compact" disabled={utmPage >= utmPages - 1} onClick={() => setUtmPage(page => Math.min(utmPages - 1,page + 1))}>Next</button></div>
      </Panel>
      <Panel className="table-panel" title="GA4 campaign attribution" subtitle="All campaign rows reported during the selected period">
        <div className="table-wrap"><table><thead><tr><th>Campaign</th><th>ID</th><th>Source</th><th>Medium</th><th>Term</th><th>Content</th><th>Landing page</th><th>Sessions</th><th>Users</th><th>Engaged sessions</th><th>Key events</th><th>Purchases</th><th>Revenue</th></tr></thead><tbody>{visibleAnalyticsRows.map((row,index) => <tr key={`${row.sessionCampaignName}-${row.sessionSource}-${row.landingPagePlusQueryString}-${index}`}><td>{row.sessionCampaignName}</td><td>{row.sessionCampaignId}</td><td>{row.sessionSource}</td><td>{row.sessionMedium}</td><td>{row.sessionManualTerm}</td><td>{row.sessionManualAdContent}</td><td>{row.landingPagePlusQueryString}</td><td>{number(row.sessions)}</td><td>{number(row.activeUsers)}</td><td>{number(row.engagedSessions)}</td><td>{number(row.keyEvents)}</td><td>{number(row.ecommercePurchases)}</td><td>{number(row.totalRevenue)}</td></tr>)}</tbody></table></div>
        <div className="pagination"><span>{number(analyticsRows.length)} rows · page {campaignPage + 1} of {campaignPages}</span><button className="secondary-button compact" disabled={!campaignPage} onClick={() => setCampaignPage(page => Math.max(0, page - 1))}>Previous</button><button className="secondary-button compact" disabled={campaignPage >= campaignPages - 1} onClick={() => setCampaignPage(page => Math.min(campaignPages - 1, page + 1))}>Next</button></div>
      </Panel>
      <div className="coverage-note table-panel"><ShieldCheck size={17}/><div><strong>Tracking coverage</strong><span>Saved production links are exact. When GA4 retains campaign dimensions but not the original query string, the table reconstructs a reviewable URL and labels it “Reconstructed from GA4 dimensions.” Matching uses campaign ID/name plus source and medium; privacy, consent, redirects, and attribution rules can reduce reporting. User counts can overlap across rows.</span></div></div>
    </section>
  </>
}

function LifecycleBreakdown({ rows, groupField }) {
  const grouped = useMemo(() => {
    const result = new Map()
    for (const row of rows || []) {
      const key = row[groupField] || '(not set)'
      const item = result.get(key) || { name: key, installs: 0, uninstalls: 0 }
      if (row.eventName === 'first_open') item.installs += row.eventCount || 0
      if (row.eventName === 'app_remove') item.uninstalls += row.eventCount || 0
      result.set(key, item)
    }
    return [...result.values()].sort((a, b) => (b.installs + b.uninstalls) - (a.installs + a.uninstalls))
  }, [rows, groupField])
  return <div className="table-wrap"><table><thead><tr><th>{groupField === 'appVersion' ? 'App version' : 'Platform'}</th><th>Installs</th><th>Uninstalls</th><th>Net events</th></tr></thead><tbody>
    {grouped.map(row => <tr key={row.name}><td>{row.name}</td><td>{number(row.installs)}</td><td>{number(row.uninstalls)}</td><td>{number(row.installs - row.uninstalls)}</td></tr>)}
    {!grouped.length && <tr><td colSpan="4" className="table-empty">No lifecycle rows were reported for this period.</td></tr>}
  </tbody></table></div>
}

function AppLifecycleView({ data }) {
  if (!data) return <Panel title="GA4 app lifecycle" subtitle="Loading lifecycle events"><EmptyPanel title="Loading app activity" copy="Querying install and uninstall signals from GA4." /></Panel>
  return <>
    <section className="lifecycle-hero">
      <div><p className="eyebrow">GA4 mobile app analytics</p><h2>GA4 app lifecycle</h2><p>Installation activity uses <code>first_open</code>. Uninstall activity uses Android <code>app_remove</code>. Store downloads require App Store Connect or Google Play Console data.</p></div>
      <Smartphone size={42}/>
    </section>
    <section className="metric-grid">
      <Metric icon={Download} label="Store downloads" value={data.summary.downloads} detail="Unavailable in GA4" tone="blue" />
      <Metric icon={Smartphone} label="Installs / first opens" value={data.summary.installs} detail={`${number(data.summary.installUsers)} users`} />
      <Metric icon={UserMinus} label="Android uninstalls" value={data.summary.uninstalls} detail={`${number(data.summary.uninstallUsers)} users`} tone="amber" />
      <Metric icon={Activity} label="Net lifecycle events" value={data.summary.netInstalls} detail="First opens minus app removals" tone="purple" />
    </section>
    <section className="lifecycle-grid">
      <Panel className="lifecycle-trend" title="Installs and uninstalls over time" subtitle={`Selected reporting period · ${data.property.timeZone || 'GA4 timezone'}`}>
        {data.trend.length ? <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend} margin={{top:12,right:16,left:-12,bottom:0}}><CartesianGrid stroke="#e7eee9" vertical={false}/><XAxis dataKey="date" tickFormatter={dateLabel} tickLine={false} axisLine={false} minTickGap={28}/><YAxis tickLine={false} axisLine={false}/><Tooltip labelFormatter={dateLabel}/><Area type="monotone" dataKey="installs" name="Installs / first opens" stroke="#10b768" fill="#24d17e33" strokeWidth={2.5}/><Area type="monotone" dataKey="uninstalls" name="Android uninstalls" stroke="#e05f52" fill="#e05f5220" strokeWidth={2.2}/></AreaChart></ResponsiveContainer></div> : <EmptyPanel title="No app lifecycle data" copy="No first_open or app_remove events were returned for this period." />}
      </Panel>
      <Panel title="By platform" subtitle="Lifecycle event counts by reported platform"><LifecycleBreakdown rows={data.platforms} groupField="platform" /></Panel>
      <Panel className="version-panel" title="By app version" subtitle="Top versions reporting lifecycle activity"><LifecycleBreakdown rows={data.versions} groupField="appVersion" /></Panel>
      <div className="coverage-note"><ShieldCheck size={17}/><div><strong>Coverage and definitions</strong><span><b>Downloads:</b> {data.availability.downloads.reason} <b>Installs:</b> {data.availability.installs.definition} <b>Uninstalls:</b> {data.availability.uninstalls.definition}</span></div></div>
    </section>
  </>
}

function QualityTable({ rows, dimension, label, onExplain }) {
  const columns = onExplain ? 6 : 5
  return <div className="table-wrap"><table><thead><tr><th>{label}</th><th>Sessions</th><th>Bounce rate</th><th>Engagement rate</th><th>Users</th>{onExplain && <th>Analysis</th>}</tr></thead><tbody>
    {(rows || []).map((row, index) => <tr key={`${row[dimension]}-${index}`}><td>{row[dimension] || '(not set)'}</td><td>{number(row.sessions)}</td><td>{percent(row.bounceRate)}</td><td>{percent(row.engagementRate)}</td><td>{number(row.activeUsers)}</td>{onExplain && <td><button className="secondary-button compact" onClick={() => onExplain(row)}>View reason</button></td>}</tr>)}
    {!rows?.length && <tr><td colSpan={columns} className="table-empty">No web engagement rows were reported.</td></tr>}
  </tbody></table></div>
}

function BounceReasonModal({ row, comparisonPeriod, onClose }) {
  const analysis = analyzeBouncePage(row)
  const sessionsChange = row.previous?.sessions ? (row.sessions - row.previous.sessions) / row.previous.sessions : null
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="modal bounce-reason-modal" role="dialog" aria-modal="true" aria-labelledby="bounce-reason-title">
      <button className="icon-button modal-close" onClick={onClose} aria-label="Close bounce analysis"><X size={19}/></button>
      <div className="modal-badge"><TrendingUp size={20}/></div>
      <h2 id="bounce-reason-title">Bounce analysis</h2>
      <p className="modal-intro"><strong>{row.pagePath || '(not set)'}</strong><br/>{analysis.status} compared with {comparisonPeriod ? `${comparisonPeriod.startDate} to ${comparisonPeriod.endDate}` : 'the preceding period'}.</p>
      <div className="reason-metrics">
        <div><span>Current bounce</span><strong>{percent(row.bounceRate)}</strong></div>
        <div><span>Previous bounce</span><strong>{row.previous ? percent(row.previous.bounceRate) : '—'}</strong></div>
        <div><span>Change</span><strong>{analysis.change == null ? '—' : `${analysis.change >= 0 ? '+' : ''}${(analysis.change * 100).toFixed(1)} pp`}</strong></div>
        <div><span>Sessions change</span><strong>{sessionsChange == null ? '—' : `${sessionsChange >= 0 ? '+' : ''}${percent(sessionsChange)}`}</strong></div>
        <div><span>Avg. session</span><strong>{Math.round(row.averageSessionDuration || 0)} sec</strong></div>
        <div><span>Views / session</span><strong>{Number(row.screenPageViewsPerSession || 0).toFixed(2)}</strong></div>
      </div>
      <div className="reason-section"><h3>Likely contributors</h3><ul>{analysis.contributors.map(item => <li key={item}>{item}</li>)}</ul></div>
      <div className="reason-section"><h3>Recommended actions</h3><ol>{analysis.actions.map(item => <li key={item}>{item}</li>)}</ol></div>
      <div className="coverage-note"><ShieldCheck size={17}/><div><strong>Diagnostic, not visitor intent</strong><span>GA4 does not record a visitor's personal reason for leaving. These explanations are evidence-based diagnostics from period change, traffic volume, session duration and views per session.</span></div></div>
    </div>
  </div>
}

function CrashTable({ rows, dimension, label }) {
  return <div className="table-wrap"><table><thead><tr><th>{label}</th><th>Crashes</th><th>Affected users</th></tr></thead><tbody>
    {(rows || []).map((row, index) => <tr key={`${row[dimension]}-${index}`}><td>{row[dimension] || '(not set)'}</td><td>{number(row.eventCount)}</td><td>{number(row.totalUsers)}</td></tr>)}
    {!rows?.length && <tr><td colSpan="3" className="table-empty">No app_exception events were reported.</td></tr>}
  </tbody></table></div>
}

function QualityView({ data }) {
  const [selectedPage, setSelectedPage] = useState(null)
  if (!data) return <Panel title="Engagement & app stability" subtitle="Loading GA4 quality metrics"><EmptyPanel title="Loading quality data" copy="Querying website engagement and app crash signals from GA4." /></Panel>
  return <>
    <section className="metric-grid">
      <Metric icon={Activity} label="Engagement rate" value={percent(data.web.summary.engagementRate)} detail={`${number(data.web.summary.engagedSessions)} engaged sessions`} />
      <Metric icon={TrendingUp} label="Bounce rate" value={percent(data.web.summary.bounceRate)} detail={`${number(data.web.summary.sessions)} web sessions`} tone="amber" />
      <Metric icon={Bug} label="Crash events" value={data.crashes.summary.crashCount} detail="GA4 app_exception events" tone="purple" />
      <Metric icon={ShieldCheck} label="Crash-free users" value={percent(data.crashes.summary.crashFreeUsersRate)} detail={`${number(data.crashes.summary.crashAffectedUsers)} crash-affected users`} tone="blue" />
    </section>
    <section className="lifecycle-grid">
      <Panel className="lifecycle-trend" title="Crash trend" subtitle="Crash events, affected users and crash-free user rate over time">
        {data.crashes.trend.length ? <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.crashes.trend} margin={{top:12,right:16,left:-12,bottom:0}}><CartesianGrid stroke="#e7eee9" vertical={false}/><XAxis dataKey="date" tickFormatter={dateLabel} tickLine={false} axisLine={false}/><YAxis tickLine={false} axisLine={false}/><Tooltip labelFormatter={dateLabel}/><Area type="monotone" dataKey="crashCount" name="Crash events" stroke="#fb7185" fill="#fb718522" strokeWidth={2.5}/><Area type="monotone" dataKey="crashAffectedUsers" name="Affected users" stroke="#a78bfa" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer></div> : <EmptyPanel title="No crashes reported" copy="GA4 returned no app_exception activity for this period." />}
      </Panel>
      <Panel className="version-panel" title="Bounce rate by page" subtitle="Website sessions, bounce and engagement compared with the preceding period"><QualityTable rows={data.web.pages} dimension="pagePath" label="Page" onExplain={setSelectedPage} /></Panel>
      <Panel title="By device"><QualityTable rows={data.web.devices} dimension="deviceCategory" label="Device" /></Panel>
      <Panel title="By country"><QualityTable rows={data.web.countries} dimension="country" label="Country" /></Panel>
      <Panel className="version-panel" title="By source / medium"><QualityTable rows={data.web.sources} dimension="sessionSourceMedium" label="Source / medium" /></Panel>
      <Panel title="Crashes by app version"><CrashTable rows={data.crashes.versions} dimension="appVersion" label="App version" /></Panel>
      <Panel title="Crashes by operating system"><CrashTable rows={data.crashes.operatingSystems} dimension="operatingSystem" label="OS" /></Panel>
      <Panel className="version-panel" title="Crashes by device model"><CrashTable rows={data.crashes.deviceModels} dimension="deviceModel" label="Device model" /></Panel>
      <div className="coverage-note"><ShieldCheck size={17}/><div><strong>Live API coverage</strong><span>Engagement and crash aggregates come directly from the connected GA4 Data API. {data.crashes.issueCoverage} No report upload is used. Adjust remains the attribution source and does not provide crash diagnostics.</span></div></div>
    </section>
    {selectedPage && <BounceReasonModal row={selectedPage} comparisonPeriod={data.comparisonPeriod} onClose={() => setSelectedPage(null)}/>}
  </>
}

function UrlInventoryView({ data }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const filtered = useMemo(() => (data?.urls || []).filter(item => (filter !== 'new' || item.isNew) && `${item.url} ${item.pageTitle || ''}`.toLowerCase().includes(search.toLowerCase())), [data, search, filter])
  const pageSize = 100
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  useEffect(() => setPage(0), [search, filter])
  if (!data) return <Panel title="STC URL inventory" subtitle="Loading sitemap and GA4 pages"><EmptyPanel title="Loading URLs" copy="Reading the public STC sitemap and GA4 page activity." /></Panel>
  return <>
    <section className="metric-grid">
      <Metric icon={Link2} label="Known URLs" value={data.summary.total} detail="Sitemap plus GA4 paths" />
      <Metric icon={Globe2} label="Sitemap URLs" value={data.summary.sitemap} detail="Published by stc.com.kw" tone="blue" />
      <Metric icon={Activity} label="GA4-active URLs" value={data.summary.ga4Active} detail="Views in selected period" tone="purple" />
      <Metric icon={Languages} label="New URLs" value={data.summary.new} detail="First detected in the last 7 days" tone="amber" />
    </section>
    <section className="dashboard-grid">
      <Panel className="table-panel" title="All known stc.com.kw URLs" subtitle={`${number(filtered.length)} matching URLs · page ${page + 1} of ${pages}`} action={<div className="inventory-actions"><select aria-label="Filter URL status" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All URLs</option><option value="new">New URLs</option></select><div className="search-box"><Search size={16}/><input aria-label="Search URL inventory" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search URL or page title"/></div></div>}>
        <div className="table-wrap"><table><thead><tr><th>URL</th><th>Status</th><th>Language</th><th>Sitemap</th><th>First detected</th><th>Sitemap modified</th><th>Google first seen</th><th>Page views</th><th>Users</th><th>Sessions</th></tr></thead><tbody>
          {filtered.slice(page * pageSize, (page + 1) * pageSize).map(item => <tr key={item.url}><td><a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>{item.pageTitle && <small>{item.pageTitle}</small>}</td><td>{item.isNew ? <span className="new-tag">New</span> : 'Existing'}</td><td>{item.language.toUpperCase()}</td><td>{item.inSitemap ? 'Listed' : 'GA4 only'}</td><td>{new Date(item.firstSeen).toLocaleDateString()}</td><td>{item.lastModified ? new Date(item.lastModified).toLocaleDateString() : '—'}</td><td>{item.googleFirstSeen ? new Date(item.googleFirstSeen).toLocaleDateString() : 'Search Console required'}</td><td>{number(item.screenPageViews)}</td><td>{number(item.activeUsers)}</td><td>{number(item.sessions)}</td></tr>)}
        </tbody></table></div>
        <div className="pagination"><button className="secondary-button compact" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page + 1} / {pages}</span><button className="secondary-button compact" disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div>
      </Panel>
      <div className="coverage-note"><ShieldCheck size={17}/><div><strong>Date definitions</strong><span><b>First detected</b> is when this dashboard first recorded the URL; today’s inventory is the baseline and is not marked New. Future discoveries remain New for 7 days. <b>Sitemap modified</b> comes from the publisher. Google first-seen requires Search Console access and means first recorded search impression—not the exact indexing date.</span></div></div>
    </section>
  </>
}

function AdjustEventCoverage({ comparison, title = 'Adjust app and web event coverage' }) {
  const scopeNote = comparison.eventCoverageAvailable ? comparison.webCoverageStatus : `Event coverage unavailable${comparison.eventCoverageError ? `: ${comparison.eventCoverageError}` : '.'}`
  return <Panel className="version-panel" title={title} subtitle="Available Adjust commerce and customer events, split between mobile app and web">
    <div className="metric-grid embedded-metrics">
      <Metric icon={Smartphone} label="App custom events" value={comparison.eventTotals.app} detail={`${number(comparison.activityByGroup.app.sessions)} app sessions`} />
      <Metric icon={Globe2} label="Web custom events" value={comparison.eventTotals.web} detail={`${number(comparison.activityByGroup.web.sessions)} web sessions`} tone="blue" />
      <Metric icon={TrendingUp} label="App attributed installs" value={comparison.activityByGroup.app.installs} detail="Android and iOS" tone="purple" />
      <Metric icon={Activity} label="Web attributed conversions" value={comparison.activityByGroup.web.installs} detail="Adjust web install metric" tone="amber" />
    </div>
    {comparison.eventCoverageAvailable && comparison.eventCoverage.length ? <div className="table-wrap"><table><thead><tr><th>Adjust event</th><th>App events</th><th>Web events</th><th>Web status</th></tr></thead><tbody>{comparison.eventCoverage.map(row => <tr key={row.metric}><td><strong>{row.label}</strong><small>{row.metric}</small></td><td>{number(row.app)}</td><td>{number(row.web)}</td><td>{row.web > 0 ? 'Reported' : 'No events returned'}</td></tr>)}</tbody></table></div> : <EmptyPanel title="Custom event coverage unavailable" copy="Adjust did not return the custom-event report. Installs, sessions and attribution remain available." />}
    <div className="coverage-note"><ShieldCheck size={17}/><div><strong>Web tracking check</strong><span>{scopeNote} Adjust's web “install” value is a web attribution/conversion metric; it is not a mobile app installation.</span></div></div>
  </Panel>
}

function AdjustAnalyticsView({ data, connected }) {
  if (!connected) return <Panel title="Adjust analytics" subtitle="Adjust connection required"><EmptyPanel title="Adjust is not connected" copy="Connect an Adjust API token to load attribution, activity and event reporting." /></Panel>
  if (!data) return <Panel title="Adjust analytics" subtitle="Loading Adjust reporting"><EmptyPanel title="Loading Adjust data" copy="Querying Adjust Report Service for the selected date range." /></Panel>
  const comparison = buildComparison({}, data)
  const networks = [...data.acquisition.reduce((map, row) => {
    const name = row.network || 'Not reported'
    const current = map.get(name) || { network: name, installs: 0, sessions: 0, clicks: 0, impressions: 0, uninstalls: 0 }
    for (const metric of ['installs', 'sessions', 'clicks', 'impressions', 'uninstalls']) current[metric] += Number(row[metric] || 0)
    map.set(name, current)
    return map
  }, new Map()).values()].sort((a, b) => b.installs - a.installs).slice(0, 10)
  return <>
    <section className="lifecycle-hero"><div><p className="eyebrow">Adjust Datascape</p><h2>Adjust analytics</h2><p>One organized view of attribution, installs, usage, active users, uninstalls, acquisition and configured custom events for app and web.</p></div><TrendingUp size={42}/></section>
    <nav className="adjust-section-nav" aria-label="Adjust dashboard sections"><a href="#adjust-overview">Overview</a><a href="#adjust-trends">Trends</a><a href="#adjust-platforms">Platforms</a><a href="#adjust-events">Events</a><a href="#adjust-acquisition">Acquisition</a><a href="#adjust-apps">Apps &amp; versions</a></nav>
    <section id="adjust-overview" className="metric-grid scroll-target">
      <Metric icon={Smartphone} label="Installs" value={data.summary.installs} detail="Attributed installs" />
      <Metric icon={UserMinus} label="Uninstalls" value={data.summary.uninstalls} detail="Adjust reported uninstalls" tone="amber" />
      <Metric icon={Route} label="Sessions" value={data.summary.sessions} detail="App and web sessions" tone="purple" />
      <Metric icon={Users} label="Daily active users" value={data.summary.daus} detail="Adjust DAU metric" tone="blue" />
      <Metric icon={Users} label="Monthly active users" value={data.summary.maus} detail="Adjust MAU metric" />
      <Metric icon={Activity} label="Clicks" value={data.summary.clicks} detail="Attribution clicks" tone="blue" />
      <Metric icon={Globe2} label="Impressions" value={data.summary.impressions} detail="Attribution impressions" tone="purple" />
      <Metric icon={Route} label="Reattributions" value={data.summary.reattributions} detail="Returning attributed users" tone="amber" />
    </section>
    <section className="lifecycle-grid">
      <div id="adjust-trends" className="adjust-chart-grid scroll-target">
        <Panel title="Attribution trend" subtitle="Daily installs, uninstalls and reattributions">
          {data.trend.length ? <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend} margin={{top:12,right:16,left:-12,bottom:0}}><CartesianGrid stroke="#e7eee9" vertical={false}/><XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={28}/><YAxis tickLine={false} axisLine={false}/><Tooltip/><Area type="monotone" dataKey="installs" name="Installs" stroke="#10b768" fill="#24d17e2b" strokeWidth={2.5}/><Area type="monotone" dataKey="uninstalls" name="Uninstalls" stroke="#f59e0b" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="reattributions" name="Reattributions" stroke="#8b5cf6" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer></div> : <EmptyPanel title="No attribution activity" copy="Adjust returned no daily attribution rows for this range." />}
        </Panel>
        <Panel title="Usage trend" subtitle="Daily sessions, DAU and MAU reported by Adjust">
          {data.trend.length ? <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend} margin={{top:12,right:16,left:-12,bottom:0}}><CartesianGrid stroke="#e7eee9" vertical={false}/><XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={28}/><YAxis tickLine={false} axisLine={false}/><Tooltip/><Area type="monotone" dataKey="sessions" name="Sessions" stroke="#0284c7" fill="#38bdf826" strokeWidth={2.5}/><Area type="monotone" dataKey="daus" name="DAU" stroke="#10b768" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="maus" name="MAU" stroke="#8b5cf6" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer></div> : <EmptyPanel title="No usage activity" copy="Adjust returned no daily usage rows for this range." />}
        </Panel>
      </div>
      <div id="adjust-platforms" className="scroll-target version-panel"><Panel title="Platform overview" subtitle="Adjust activity grouped by Android, iOS and web"><div className="table-wrap"><table><thead><tr><th>Platform</th><th>Installs / conversions</th><th>Uninstalls</th><th>Sessions</th><th>DAU</th><th>MAU</th></tr></thead><tbody>{comparison.platforms.map(r => <tr key={r.platform}><td><strong>{r.platform}</strong></td><td>{number(r.adjustInstalls)}</td><td>{number(r.adjustUninstalls)}</td><td>{number(r.sessions)}</td><td>{number(r.daus)}</td><td>{number(r.maus)}</td></tr>)}</tbody></table></div></Panel></div>
      <div id="adjust-events" className="scroll-target version-panel"><AdjustEventCoverage comparison={comparison} title="Custom events by platform" /></div>
      <div id="adjust-acquisition" className="scroll-target version-panel adjust-acquisition-grid">
        <Panel title="Top acquisition networks" subtitle="Networks ranked by attributed installs"><div className="chart-area compact-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={networks} layout="vertical" margin={{top:8,right:20,left:8,bottom:0}}><CartesianGrid stroke="#e7eee9" horizontal={false}/><XAxis type="number" tickLine={false} axisLine={false}/><YAxis type="category" dataKey="network" width={120} tickLine={false} axisLine={false}/><Tooltip/><Bar dataKey="installs" name="Installs" fill="#10b768" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer></div></Panel>
        <Panel title="Network performance" subtitle="Top network totals for attribution and usage"><div className="table-wrap"><table><thead><tr><th>Network</th><th>Installs</th><th>Sessions</th><th>Clicks</th><th>Impressions</th><th>Uninstalls</th></tr></thead><tbody>{networks.map(r => <tr key={r.network}><td><strong>{r.network}</strong></td><td>{number(r.installs)}</td><td>{number(r.sessions)}</td><td>{number(r.clicks)}</td><td>{number(r.impressions)}</td><td>{number(r.uninstalls)}</td></tr>)}</tbody></table></div></Panel>
      </div>
      <Panel className="version-panel" title="Campaign, ad group and creative detail" subtitle="Full Adjust acquisition hierarchy by app and platform"><div className="table-wrap acquisition-table"><table><thead><tr><th>App</th><th>OS</th><th>Platform</th><th>Network</th><th>Campaign</th><th>Ad group</th><th>Creative</th><th>Installs</th><th>Uninstalls</th><th>Sessions</th><th>Clicks</th><th>Impressions</th></tr></thead><tbody>{data.acquisition.map((r,i)=><tr key={`${r.network}-${r.campaign}-${r.adgroup}-${r.creative}-${i}`}><td>{r.app}</td><td>{r.os_name}</td><td>{r.platform}</td><td>{r.network || 'Not reported'}</td><td>{r.campaign || 'Not reported'}</td><td>{r.adgroup || 'Not reported'}</td><td>{r.creative || 'Not reported'}</td><td>{number(r.installs)}</td><td>{number(r.uninstalls)}</td><td>{number(r.sessions)}</td><td>{number(r.clicks)}</td><td>{number(r.impressions)}</td></tr>)}</tbody></table></div></Panel>
      <div id="adjust-apps" className="scroll-target version-panel"><Panel title="Apps, versions and operating systems" subtitle="Daily Adjust activity with app token, version, OS and platform"><div className="table-wrap acquisition-table"><table><thead><tr><th>Date</th><th>App</th><th>App token</th><th>Version</th><th>OS</th><th>Platform</th><th>Installs</th><th>Uninstalls</th><th>Sessions</th><th>DAU</th><th>MAU</th></tr></thead><tbody>{data.apps.map((r,i)=><tr key={`${r.day}-${r.app_token}-${r.app_version}-${r.os_name}-${r.platform}-${i}`}><td>{r.day}</td><td>{r.app}</td><td><code>{r.app_token}</code></td><td>{r.app_version && r.app_version !== 'unknown' ? r.app_version : 'Not reported'}</td><td>{r.os_name}</td><td>{r.platform}</td><td>{number(r.installs)}</td><td>{number(r.uninstalls)}</td><td>{number(r.sessions)}</td><td>{number(r.daus)}</td><td>{number(r.maus)}</td></tr>)}</tbody></table></div></Panel></div>
      {!!data.warnings.length && <div className="coverage-note"><AlertTriangle size={17}/><div><strong>Adjust warnings</strong><span>{data.warnings.join(' ')}</span></div></div>}
    </section>
  </>
}

function ComparisonView({ lifecycle, adjust, ga4, connected }) {
  if (!connected) return <Panel title="GA4 vs Adjust" subtitle="Adjust connection required"><EmptyPanel title="Adjust is not connected" copy="Connect Adjust in Analytics settings to compare attributed installs with GA4 first opens." /></Panel>
  if (!lifecycle || !adjust) return <Panel title="GA4 vs Adjust" subtitle="Loading both analytics sources"><EmptyPanel title="Loading comparison" copy="Querying GA4 and Adjust for the selected date range." /></Panel>
  const comparison = buildComparison(lifecycle, adjust)
  const signedPercent = value => value == null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
  const ga4EventMap = new Map((ga4?.events || []).map(row => [row.eventName, row]))
  const eventMappings = [
    ['Prepaid purchases', ['purchase_prepaid', 'purchase_prepaid_Plan', 'purchase_prepaid_bundle'], 'purchase_prepaid_events'],
    ['Postpaid purchases', ['purchase_postpaid'], 'purchase_postpaid_events'],
    ['Voucher purchases', ['purchased_voucher'], 'purchase_evoucher_events'],
    ['Add-on purchases', ['purchase_addon'], 'purchase_addon_events'],
    ['Device purchases', ['purchased_device'], 'purchase_device_events'],
    ['Roaming purchases', ['purchase_roaming'], 'purchase_roaming_events'],
    ['VAS purchases', ['purchase_vas'], 'purchase_vas_events'],
    ['Recharge purchases', ['purchase_recharge'], 'purchase_recharge_events'],
    ['Bill payments', ['purchase_billpayment'], 'purchase_billpayment_events'],
    ['Qitaf joins', ['joined_qitaf'], 'joined_qitaf_events']
  ].map(([label, ga4Names, adjustMetric]) => {
    const ga4Events = ga4Names.reduce((sum, name) => sum + Number(ga4EventMap.get(name)?.eventCount || 0), 0)
    const ga4Users = ga4Names.reduce((sum, name) => sum + Number(ga4EventMap.get(name)?.totalUsers || 0), 0)
    const adjustEvents = comparison.eventCoverage.find(row => row.metric === adjustMetric)
    const adjustTotal = Number(adjustEvents?.app || 0) + Number(adjustEvents?.web || 0)
    return { label, ga4Names: ga4Names.join(', '), adjustMetric, ga4Events, ga4Users, adjustTotal, difference: adjustTotal - ga4Events, variancePct: ga4Events ? (adjustTotal - ga4Events) / ga4Events : null }
  })
  const versions = new Map()
  for (const row of lifecycle.versions || []) {
    const key = row.appVersion || 'Not reported'; const item = versions.get(key) || { version: key, ga4Installs: 0, ga4Uninstalls: 0, adjustInstalls: 0, adjustUninstalls: 0, adjustSessions: 0 }
    item[row.eventName === 'app_remove' ? 'ga4Uninstalls' : 'ga4Installs'] += Number(row.eventCount || 0); versions.set(key, item)
  }
  for (const row of adjust.apps || []) {
    const key = row.app_version && row.app_version !== 'unknown' ? row.app_version : 'Not reported'; const item = versions.get(key) || { version: key, ga4Installs: 0, ga4Uninstalls: 0, adjustInstalls: 0, adjustUninstalls: 0, adjustSessions: 0 }
    item.adjustInstalls += Number(row.installs || 0); item.adjustUninstalls += Number(row.uninstalls || 0); item.adjustSessions += Number(row.sessions || 0); versions.set(key, item)
  }
  const versionRows = [...versions.values()].map(row => ({ ...row, difference: row.adjustInstalls - row.ga4Installs, variancePct: varianceForUi(row.adjustInstalls, row.ga4Installs) })).sort((a,b) => Math.max(b.ga4Installs,b.adjustInstalls) - Math.max(a.ga4Installs,a.adjustInstalls)).slice(0,100)
  const adjustNetworks = [...adjust.acquisition.reduce((map, row) => { const key = row.network || 'Not reported'; const item = map.get(key) || { name:key, installs:0, sessions:0, clicks:0, impressions:0 }; for (const metric of ['installs','sessions','clicks','impressions']) item[metric] += Number(row[metric] || 0); map.set(key,item); return map }, new Map()).values()].sort((a,b)=>b.sessions-a.sessions).slice(0,15)
  return <>
    <section className="lifecycle-hero"><div><p className="eyebrow">Cross-platform reconciliation</p><h2>GA4 vs Adjust complete analysis</h2><p>Reconcile lifecycle, platforms, versions, mapped commerce events, usage and acquisition detail for the same selected period.</p></div><GitCompareArrows size={42}/></section>
    <nav className="adjust-section-nav" aria-label="GA4 versus Adjust sections"><a href="#compare-summary">Summary</a><a href="#compare-daily">Daily</a><a href="#compare-platforms">Platforms</a><a href="#compare-versions">Versions</a><a href="#compare-events">Events</a><a href="#compare-acquisition">Acquisition</a><a href="#compare-definitions">Definitions</a></nav>
    <section id="compare-summary" className="metric-grid scroll-target">
      <Metric icon={Activity} label="GA4 first opens" value={comparison.ga4Installs} detail="GA4 first_open events" />
      <Metric icon={TrendingUp} label="Adjust installs" value={comparison.adjustInstalls} detail="Attributed installs" tone="blue" />
      <Metric icon={GitCompareArrows} label="Install difference" value={comparison.difference} detail={`${signedPercent(comparison.variancePct)} Adjust vs GA4`} tone="purple" />
      <Metric icon={UserMinus} label="GA4 uninstalls" value={comparison.ga4Uninstalls} detail="Android app_remove only" tone="amber" />
      <Metric icon={UserMinus} label="Adjust uninstalls" value={comparison.adjustUninstalls} detail="Adjust reported uninstalls" tone="purple" />
      <Metric icon={Users} label="GA4 active users" value={ga4?.summary?.activeUsers || 0} detail="Selected GA4 scope" />
      <Metric icon={Route} label="GA4 sessions" value={ga4?.summary?.sessions || 0} detail="GA4 session definition" tone="amber" />
      <Metric icon={Route} label="Adjust sessions" value={comparison.sessions} detail="All reported platforms" tone="blue" />
      <Metric icon={Users} label="Adjust DAU" value={comparison.daus} detail="Daily active users" />
      <Metric icon={Users} label="Adjust MAU" value={comparison.maus} detail="Monthly active users" tone="purple" />
      <Metric icon={Globe2} label="Web installs" value={comparison.webInstalls} detail="Adjust platform = web" tone="amber" />
      <Metric icon={Activity} label="GA4 total events" value={ga4?.summary?.eventCount || 0} detail="All events in selected scope" tone="blue" />
    </section>
    <section className="lifecycle-grid">
      <Panel id="compare-daily" className="lifecycle-trend scroll-target" title="Daily install comparison" subtitle="GA4 first opens, Adjust attributed installs and the daily difference">
        {comparison.daily.length ? <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={comparison.daily} margin={{top:12,right:16,left:-12,bottom:0}}><CartesianGrid stroke="#e7eee9" vertical={false}/><XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={28}/><YAxis tickLine={false} axisLine={false}/><Tooltip/><Area type="monotone" dataKey="ga4Installs" name="GA4 first opens" stroke="#10b768" fill="#24d17e24" strokeWidth={2.5}/><Area type="monotone" dataKey="adjustInstalls" name="Adjust installs" stroke="#38bdf8" fill="#38bdf81a" strokeWidth={2.5}/></AreaChart></ResponsiveContainer></div> : <EmptyPanel title="No comparison data" copy="Neither source returned install activity for this period." />}
      </Panel>
      <Panel className="version-panel" title="Daily reconciliation detail" subtitle="Exact daily values, difference and variance"><div className="table-wrap acquisition-table"><table><thead><tr><th>Date</th><th>GA4 first opens</th><th>Adjust installs</th><th>Difference</th><th>Variance</th></tr></thead><tbody>{comparison.daily.map(row => <tr key={row.date}><td>{row.date}</td><td>{number(row.ga4Installs)}</td><td>{number(row.adjustInstalls)}</td><td>{number(row.difference)}</td><td>{signedPercent(row.variancePct)}</td></tr>)}</tbody></table></div></Panel>
      <div id="compare-platforms" className="scroll-target version-panel"><Panel title="Android, iOS and web reconciliation" subtitle="Lifecycle and usage by operating system/platform"><div className="table-wrap"><table><thead><tr><th>Platform</th><th>GA4 installs</th><th>GA4 uninstalls</th><th>Adjust installs</th><th>Adjust uninstalls</th><th>Adjust sessions</th><th>DAU</th><th>MAU</th><th>Install difference</th><th>Variance</th></tr></thead><tbody>{comparison.platforms.map(row => <tr key={row.platform}><td><strong>{row.platform}</strong></td><td>{number(row.ga4Installs)}</td><td>{number(row.ga4Uninstalls)}</td><td>{number(row.adjustInstalls)}</td><td>{number(row.adjustUninstalls)}</td><td>{number(row.sessions)}</td><td>{number(row.daus)}</td><td>{number(row.maus)}</td><td>{number(row.difference)}</td><td>{signedPercent(row.variancePct)}</td></tr>)}{!comparison.platforms.length && <tr><td colSpan="10" className="table-empty">No platform rows were returned.</td></tr>}</tbody></table></div></Panel></div>
      <div id="compare-versions" className="scroll-target version-panel"><Panel title="App-version reconciliation" subtitle="GA4 lifecycle events compared with Adjust installs, uninstalls and sessions"><div className="table-wrap acquisition-table"><table><thead><tr><th>App version</th><th>GA4 installs</th><th>GA4 uninstalls</th><th>Adjust installs</th><th>Adjust uninstalls</th><th>Adjust sessions</th><th>Install difference</th><th>Variance</th></tr></thead><tbody>{versionRows.map(row => <tr key={row.version}><td><strong>{row.version}</strong></td><td>{number(row.ga4Installs)}</td><td>{number(row.ga4Uninstalls)}</td><td>{number(row.adjustInstalls)}</td><td>{number(row.adjustUninstalls)}</td><td>{number(row.adjustSessions)}</td><td>{number(row.difference)}</td><td>{signedPercent(row.variancePct)}</td></tr>)}</tbody></table></div></Panel></div>
      <div id="compare-events" className="scroll-target version-panel"><Panel title="Mapped commerce-event reconciliation" subtitle="GA4 event counts versus the closest configured Adjust event metrics"><div className="table-wrap"><table><thead><tr><th>Business event</th><th>GA4 event names</th><th>GA4 events</th><th>GA4 users</th><th>Adjust metric</th><th>Adjust events</th><th>Difference</th><th>Variance</th></tr></thead><tbody>{eventMappings.map(row => <tr key={row.label}><td><strong>{row.label}</strong></td><td><code>{row.ga4Names}</code></td><td>{number(row.ga4Events)}</td><td>{number(row.ga4Users)}</td><td><code>{row.adjustMetric}</code></td><td>{number(row.adjustTotal)}</td><td>{number(row.difference)}</td><td>{signedPercent(row.variancePct)}</td></tr>)}</tbody></table></div><div className="coverage-note"><AlertTriangle size={17}/><div><strong>Event mapping limitation</strong><span>These rows compare similarly named business signals, not identical attribution pipelines. Differences can result from SDK delivery, consent, deduplication, event naming, platform filters and Adjust attribution rules.</span></div></div></Panel></div>
      <AdjustEventCoverage comparison={comparison} title="Adjust event coverage behind the comparison" />
      <div id="compare-acquisition" className="scroll-target version-panel adjust-acquisition-grid"><Panel title="GA4 traffic sources" subtitle="GA4 sessions and active users by source / medium"><div className="table-wrap acquisition-table"><table><thead><tr><th>Source / medium</th><th>Sessions</th><th>Active users</th></tr></thead><tbody>{(ga4?.sources || []).map(row => <tr key={row.sessionSourceMedium}><td><strong>{row.sessionSourceMedium}</strong></td><td>{number(row.sessions)}</td><td>{number(row.activeUsers)}</td></tr>)}</tbody></table></div></Panel><Panel title="Adjust attribution networks" subtitle="Adjust installs, sessions, clicks and impressions by network"><div className="table-wrap acquisition-table"><table><thead><tr><th>Network</th><th>Installs</th><th>Sessions</th><th>Clicks</th><th>Impressions</th></tr></thead><tbody>{adjustNetworks.map(row => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{number(row.installs)}</td><td>{number(row.sessions)}</td><td>{number(row.clicks)}</td><td>{number(row.impressions)}</td></tr>)}</tbody></table></div></Panel></div>
      <Panel className="version-panel" title="Adjust campaign detail" subtitle="Campaign, ad group and creative records supporting the attribution comparison"><div className="table-wrap acquisition-table"><table><thead><tr><th>Platform</th><th>Network</th><th>Campaign</th><th>Ad group</th><th>Creative</th><th>Installs</th><th>Sessions</th><th>Clicks</th><th>Impressions</th></tr></thead><tbody>{adjust.acquisition.map((row,index) => <tr key={`${row.network}-${row.campaign}-${row.adgroup}-${row.creative}-${index}`}><td>{row.platform}</td><td>{row.network || 'Not reported'}</td><td>{row.campaign || 'Not reported'}</td><td>{row.adgroup || 'Not reported'}</td><td>{row.creative || 'Not reported'}</td><td>{number(row.installs)}</td><td>{number(row.sessions)}</td><td>{number(row.clicks)}</td><td>{number(row.impressions)}</td></tr>)}</tbody></table></div></Panel>
      <div id="compare-definitions" className="coverage-note scroll-target"><ShieldCheck size={17}/><div><strong>How to interpret this comparison</strong><span>GA4 <code>first_open</code> is the first app launch after install or reinstall. Adjust installs follow Adjust attribution rules. GA4 <code>app_remove</code> primarily covers Android; zero iOS removals does not prove no uninstall occurred. GA4 and Adjust sessions, users and commerce events can use different identity, attribution, deduplication and reporting rules, so variance is a reconciliation signal rather than automatic proof of a tracking defect.</span></div></div>
    </section>
  </>
}

function AnalyticsAssistant({ context, messages, setMessages }) {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const ask = async prompt => {
    const text = (prompt ?? question).trim()
    if (!text || busy) return
    setMessages(items => [...items, { role: 'user', text }]); setBusy(true)
    try { const answer = await answerAkQuestion(text, context); setMessages(items => [...items, { role: 'assistant', text: answer }]) }
    catch (error) { setMessages(items => [...items, { role: 'assistant', text: `I couldn’t load that filtered report: ${error.message}` }]) }
    finally { setBusy(false) }
    setQuestion('')
  }
  const suggestions = ['Compare GA4 and Adjust installs', 'Show the GA4 summary', 'What are the top traffic sources?', 'How many failed purchase journeys?', 'Show app uninstalls']
  return <section className="assistant-layout">
    <div className="assistant-intro"><div className="assistant-orb"><Bot size={30}/></div><div><p className="eyebrow">AK analytics assistant</p><h2>Ask AK</h2><p>Ask about any information loaded across GA4, Adjust, journeys, sales, products, campaigns, app activity, engagement and URLs.</p></div></div>
    <div className="suggestion-row">{suggestions.map(item => <button key={item} onClick={() => ask(item)}>{item}</button>)}</div>
    <div className="chat-panel" aria-live="polite">{messages.map((message, index) => <div key={index} className={`chat-message ${message.role}`}><span>{message.role === 'assistant' ? 'AK' : 'You'}</span><p>{message.text}</p></div>)}</div>
    <div className="chat-input"><input aria-label="Ask AK" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') ask() }} placeholder="Ask AK about any dashboard information…"/><button className="primary-button" onClick={() => ask()} disabled={!question.trim() || busy}>{busy ? <RefreshCw size={17} className="spin"/> : <Send size={17}/>}Ask AK</button></div>
    <div className="coverage-note"><ShieldCheck size={17}/><div><strong>Private, grounded answers</strong><span>This assistant reads only the reports already loaded in this dashboard. It does not send analytics data to an external AI provider and will state when a requested metric is unavailable.</span></div></div>
  </section>
}

function AkFloatingAssistant({ context, messages, setMessages }) {
  const [open, setOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const ask = async () => {
    const text = question.trim()
    if (!text || busy) return
    setMessages(items => [...items, { role: 'user', text }]); setBusy(true)
    try { const answer = await answerAkQuestion(text, context); setMessages(items => [...items, { role: 'assistant', text: answer }]) }
    catch (error) { setMessages(items => [...items, { role: 'assistant', text: `I couldn’t load that filtered report: ${error.message}` }]) }
    finally { setBusy(false) }
    setQuestion('')
  }
  if (!open) return <button className="ak-launcher" onClick={() => setOpen(true)} aria-label="Ask AK" title="Ask AK"><MessageCircle size={25}/><span>AK</span></button>
  return <aside className={`ak-widget ${maximized ? 'maximized' : ''}`} aria-label="Ask AK analytics assistant">
    <header><div className="ak-avatar"><Bot size={20}/></div><div><strong>Ask AK</strong><span>Analytics assistant</span></div><button onClick={() => setMaximized(value => !value)} aria-label={maximized ? 'Restore AK chat' : 'Maximize AK chat'} title={maximized ? 'Restore' : 'Maximize'}>{maximized ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button><button onClick={() => setOpen(false)} aria-label="Minimize AK chat" title="Minimize"><Minus size={18}/></button></header>
    <div className="ak-messages" aria-live="polite">{messages.map((message,index) => <div key={index} className={`chat-message ${message.role}`}><span>{message.role === 'assistant' ? 'AK' : 'You'}</span><p>{message.text}</p></div>)}</div>
    <div className="ak-input"><input aria-label="Ask AK a question" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') ask() }} placeholder="Ask about this dashboard…"/><button onClick={ask} disabled={!question.trim() || busy} aria-label="Send question to AK">{busy ? <RefreshCw size={17} className="spin"/> : <Send size={17}/>}</button></div>
  </aside>
}

function EmptyPanel({ title, copy }) {
  return <div className="empty-panel">
    <div className="empty-icon"><BarChart3 size={28} /></div>
    <h3>{title}</h3><p>{copy}</p>
  </div>
}

function Panel({ title, subtitle, action, children, className = '', id }) {
  return <section id={id} className={`panel ${className}`}>
    <header className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>
    {children}
  </section>
}

function PlaystoreView({ data, appStoreData, connected, appStoreConnected }) {
  const [storeTab, setStoreTab] = useState('overview')
  const mystcApple = appStoreData?.apps?.find(app => app.id === '511293831')
  const snapshot = {
    app: 'mystc KW', packageName: 'com.pixilapps.selfcare', status: 'Production', installedAudience: 398000,
    latestRelease: 'Sep 8, 2026', lastUpdated: 'Sep 29, 2026', installs: 233000, installBase: '62.5%',
    crashRate: '0.13%', anrRate: '0.10%', rating: '4.17', acquisitions: 49300, firstOpeners: 29100, monthlyActiveDevices: 299000
  }
  const crash = data?.crashTrend?.at(-1)
  const anr = data?.anrTrend?.at(-1)
  const vitalTrend = (data?.crashTrend || []).map(row => ({ ...row, crashPct: row.crashRate * 100, anrPct: (data?.anrTrend || []).find(item => item.date === row.date)?.anrRate * 100 }))
  const appleVersions = [...(appStoreData?.versions || [])].sort((a,b) => String(b.createdDate).localeCompare(String(a.createdDate)))
  const stateCounts = appleVersions.reduce((map,row) => { map[row.state || 'UNKNOWN'] = (map[row.state || 'UNKNOWN'] || 0) + 1; return map }, {})
  const stateLabel = value => String(value || 'Not reported').toLowerCase().replaceAll('_',' ').replace(/\b\w/g, c => c.toUpperCase())
  return <>
    <section className="stores-hero">
      <div><span className="eyebrow">Unified mobile distribution</span><h2>mystc KW store performance</h2><p>One operational view for Android quality, Apple releases, acquisition snapshots and API coverage.</p></div>
      <div className="store-status-pair"><span className={connected ? 'ok' : ''}><Smartphone size={16}/>Google Play {connected ? 'connected' : 'offline'}</span><span className={appStoreConnected ? 'ok' : ''}><CheckCircle2 size={16}/>App Store {appStoreConnected ? 'connected' : 'offline'}</span></div>
    </section>
    <nav className="store-tabs" aria-label="App store dashboard sections">{[['overview','Overview'],['activity','Store installs & uninstalls'],['google','Google Play'],['apple','Apple App Store'],['coverage','Data coverage']].map(([id,label]) => <button key={id} className={storeTab === id ? 'active' : ''} onClick={() => setStoreTab(id)}>{label}</button>)}</nav>
    <section className="metric-grid store-kpis">
      <Metric icon={Download} label="Google Play installs" value={snapshot.installs} detail="Play Console snapshot · last 28 days" />
      <Metric icon={UserMinus} label="Google Play uninstalls" value="Unavailable" detail="Not exposed by connected API" tone="amber" />
      <Metric icon={Download} label="App Store downloads" value="Not connected" detail="Analytics Reports ingestion required" tone="blue" />
      <Metric icon={UserMinus} label="App Store deletions" value="Not connected" detail="Installations & Deletions report required" tone="purple" />
    </section>
    <section className="metric-grid store-quality-kpis">
      <Metric icon={Bug} label="Android crash rate" value={crash ? precisePercent(crash.crashRate) : null} detail={crash ? `${crash.date} · ${number(crash.distinctUsers)} measured users` : 'Live API loading'} tone="purple" />
      <Metric icon={AlertTriangle} label="Android ANR rate" value={anr ? precisePercent(anr.anrRate) : null} detail={anr ? `${anr.date} · ${number(anr.distinctUsers)} measured users` : 'Live API loading'} tone="amber" />
      <Metric icon={Smartphone} label="Current iOS release" value="6.2.0" detail="Ready for Distribution" tone="blue" />
      <Metric icon={Download} label="Android installed audience" value={snapshot.installedAudience} detail="Play Console snapshot · Oct 1" />
    </section>

    {storeTab === 'overview' && <section className="store-overview">
      <div className="store-overview-strip"><div><span>Store operations</span><strong>2 connected storefronts</strong><small>Google Play quality and Apple release metadata</small></div><div><span>Android audience</span><strong>{number(snapshot.installedAudience)}</strong><small>Play Console snapshot · Oct 1, 2026</small></div><div><span>Current iOS release</span><strong>6.2.0</strong><small>Ready for Distribution</small></div><div><span>Latest Android quality date</span><strong>{crash?.date || 'Loading'}</strong><small>Developer Reporting API</small></div></div>

      <div className="store-platform-grid">
        <article className="store-platform-card google"><header><div className="store-platform-icon"><Smartphone size={23}/></div><div><span>Google Play</span><h3>mystc KW for Android</h3></div><i>Connected</i></header><div className="store-platform-main"><div><span>Installs</span><strong>{number(snapshot.installs)}</strong><small>Last 28-day Console snapshot</small></div><div><span>Installed audience</span><strong>{number(snapshot.installedAudience)}</strong><small>{snapshot.installBase} install base</small></div></div><footer><span><b>{snapshot.rating}</b> average rating</span><span><b>{snapshot.latestRelease}</b> latest release</span><span><b>{data?.packageName || snapshot.packageName}</b> package</span></footer></article>
        <article className="store-platform-card apple"><header><div className="store-platform-icon"><Download size={23}/></div><div><span>Apple App Store</span><h3>mystc KW for iOS</h3></div><i>Connected</i></header><div className="store-platform-main"><div><span>Production version</span><strong>6.2.0</strong><small>Ready for Distribution</small></div><div><span>Next version</span><strong>6.3.0</strong><small>Prepare for Submission</small></div></div><footer><span><b>511293831</b> Apple ID</span><span><b>{mystcApple?.bundleId || 'Loading'}</b> bundle ID</span><span><b>{number(appleVersions.length)}</b> version records</span></footer></article>
      </div>

      <section className="dashboard-grid playstore-grid store-overview-main">
        <Panel className="store-vitals-panel" title="Android stability trend" subtitle={data?.period ? `${data.period.startDate} to ${data.period.endDate} · live Google Play Developer Reporting API` : 'Loading live Google Play vitals'}>
          {vitalTrend.length ? <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={vitalTrend} margin={{top:12,right:18,left:0,bottom:0}}><CartesianGrid stroke="#e7eee9" vertical={false}/><XAxis dataKey="date" tickFormatter={dateLabel} tickLine={false} axisLine={false} minTickGap={24}/><YAxis tickFormatter={v=>`${v.toFixed(2)}%`} tickLine={false} axisLine={false}/><Tooltip formatter={(value,name)=>[`${Number(value).toFixed(3)}%`,name]}/><Area type="monotone" dataKey="crashPct" name="Crash rate" stroke="#8b5cf6" fill="#8b5cf620" strokeWidth={2.5}/><Area type="monotone" dataKey="anrPct" name="ANR rate" stroke="#f59e0b" fill="#f59e0b18" strokeWidth={2.5}/></AreaChart></ResponsiveContainer></div> : <EmptyPanel title="Vitals are loading" copy="Google Play crash and ANR history will appear here."/>}
        </Panel>
        <Panel title="Latest Android quality" subtitle="Current user-normalized Play vitals"><div className="store-health-list"><div><span>Crash rate</span><strong>{crash ? precisePercent(crash.crashRate) : 'Loading'}</strong><small>{number(crash?.distinctUsers)} measured users</small></div><div><span>User-perceived crash</span><strong>{crash ? precisePercent(crash.userPerceivedCrashRate) : 'Loading'}</strong></div><div><span>ANR rate</span><strong>{anr ? precisePercent(anr.anrRate) : 'Loading'}</strong><small>{number(anr?.distinctUsers)} measured users</small></div><div><span>User-perceived ANR</span><strong>{anr ? precisePercent(anr.userPerceivedAnrRate) : 'Loading'}</strong></div></div></Panel>
        <Panel title="Google Play acquisition snapshot" subtitle="Last 28 days · observed Oct 1, 2026"><div className="detail-grid"><div><span>Device acquisitions</span><strong>{number(snapshot.acquisitions)}</strong><small>down 18%</small></div><div><span>First openers</span><strong>{number(snapshot.firstOpeners)}</strong><small>down 25%</small></div><div><span>Monthly active devices</span><strong>{number(snapshot.monthlyActiveDevices)}</strong></div><div><span>Installs</span><strong>{number(snapshot.installs)}</strong></div><div><span>Install base</span><strong>{snapshot.installBase}</strong></div><div><span>Average rating</span><strong>{snapshot.rating}</strong><small>up 0.11</small></div></div></Panel>
        <Panel title="Release and data readiness" subtitle="Current operational status across both stores"><div className="attention-list"><div className="attention green"><CheckCircle2 size={18}/><span><strong>Google Play reporting connected</strong><small>Live Android crash and ANR metrics are available.</small></span></div><div className="attention green"><CheckCircle2 size={18}/><span><strong>App Store Connect authenticated</strong><small>App identity, version history and release states are available.</small></span></div><div className="attention neutral"><Radio size={18}/><span><strong>Apple Analytics Reports not ingested</strong><small>Downloads, installations and deletions require an Analytics Report Request and scheduled ingestion.</small></span></div><div className="attention neutral"><UserMinus size={18}/><span><strong>Apple deletion data is available after connection</strong><small>Coverage includes opted-in users and Apple privacy thresholds.</small></span></div></div></Panel>
      </section>
    </section>}

    {storeTab === 'activity' && <section className="dashboard-grid playstore-grid">
      <Panel title="Store-only acquisition coverage" subtitle="Only Google Play Console and Apple App Store Connect sources are used"><div className="table-wrap"><table><thead><tr><th>Store</th><th>Installs / downloads</th><th>Uninstalls / deletions</th><th>Date breakdown</th><th>Version breakdown</th></tr></thead><tbody><tr><td><strong>Google Play</strong></td><td>{number(snapshot.installs)} <small>snapshot</small></td><td>Not connected</td><td>Not exposed by connected Reporting API</td><td>Not exposed by connected Reporting API</td></tr><tr><td><strong>Apple App Store</strong></td><td>Not connected</td><td>Not connected</td><td>Requires Analytics Reports ingestion</td><td>Requires Analytics Reports ingestion</td></tr></tbody></table></div></Panel>
      <Panel title="Google Play snapshot" subtitle="Last 28 days · observed Oct 1, 2026"><div className="detail-grid"><div><span>Installs</span><strong>{number(snapshot.installs)}</strong></div><div><span>Installed audience</span><strong>{number(snapshot.installedAudience)}</strong></div><div><span>Device acquisitions</span><strong>{number(snapshot.acquisitions)}</strong></div><div><span>First openers</span><strong>{number(snapshot.firstOpeners)}</strong></div><div><span>Monthly active devices</span><strong>{number(snapshot.monthlyActiveDevices)}</strong></div><div><span>Install base</span><strong>{snapshot.installBase}</strong></div></div></Panel>
      <div className="coverage-note"><ShieldCheck size={17}/><div><strong>No GA4 or Adjust data is used here</strong><span>The connected Google Play Developer Reporting API supplies quality metrics, not acquisition or uninstall reports. The displayed Play install value is a dated Console snapshot. Apple App Store Connect currently supplies app and release metadata. Apple Analytics Reports can provide downloads plus privacy-limited installations and deletions after an Admin creates the initial report request and the dashboard ingests its generated files.</span></div></div>
    </section>}

    {storeTab === 'google' && <section className="dashboard-grid playstore-grid">
      <Panel title="Google Play app identity" subtitle="Live authorization plus production snapshot"><div className="detail-grid"><div><span>App</span><strong>{snapshot.app}</strong></div><div><span>Package</span><strong>{data?.packageName || snapshot.packageName}</strong></div><div><span>Status</span><strong>{snapshot.status}</strong></div><div><span>Latest release</span><strong>{snapshot.latestRelease}</strong></div><div><span>Last updated</span><strong>{snapshot.lastUpdated}</strong></div><div><span>API apps visible</span><strong>{number(data?.apps?.length)}</strong></div></div></Panel>
      <Panel title="Latest Android vitals" subtitle="Daily user-normalized quality measures"><div className="detail-grid"><div><span>Crash rate</span><strong>{crash ? precisePercent(crash.crashRate) : 'Unavailable'}</strong><small>28-day weighted: {precisePercent(crash?.crashRate28dUserWeighted)}</small></div><div><span>User-perceived crash</span><strong>{crash ? precisePercent(crash.userPerceivedCrashRate) : 'Unavailable'}</strong></div><div><span>Crash denominator</span><strong>{number(crash?.distinctUsers)}</strong><small>distinct measured users</small></div><div><span>ANR rate</span><strong>{anr ? precisePercent(anr.anrRate) : 'Unavailable'}</strong><small>28-day weighted: {precisePercent(anr?.anrRate28dUserWeighted)}</small></div><div><span>User-perceived ANR</span><strong>{anr ? precisePercent(anr.userPerceivedAnrRate) : 'Unavailable'}</strong></div><div><span>ANR denominator</span><strong>{number(anr?.distinctUsers)}</strong><small>distinct measured users</small></div></div></Panel>
      <Panel className="table-panel" title="Daily Android quality detail" subtitle="Exact rates and measured-user population from Google Play"><div className="table-wrap"><table><thead><tr><th>Date</th><th>Crash rate</th><th>28d crash</th><th>ANR rate</th><th>28d ANR</th><th>Measured users</th></tr></thead><tbody>{vitalTrend.slice().reverse().map(row=><tr key={row.date}><td>{row.date}</td><td>{precisePercent(row.crashRate)}</td><td>{precisePercent(row.crashRate28dUserWeighted)}</td><td>{precisePercent((data.anrTrend.find(x=>x.date===row.date)||{}).anrRate)}</td><td>{precisePercent((data.anrTrend.find(x=>x.date===row.date)||{}).anrRate28dUserWeighted)}</td><td>{number(row.distinctUsers)}</td></tr>)}</tbody></table></div></Panel>
    </section>}

    {storeTab === 'apple' && <section className="dashboard-grid playstore-grid">
      <Panel title="mystc KW App Store identity" subtitle="Live App Store Connect API"><div className="detail-grid"><div><span>Apple ID</span><strong>511293831</strong></div><div><span>Bundle ID</span><strong>{mystcApple?.bundleId || 'Loading'}</strong></div><div><span>SKU</span><strong>{mystcApple?.sku || 'Loading'}</strong></div><div><span>Primary locale</span><strong>{mystcApple?.primaryLocale || 'Loading'}</strong></div><div><span>API apps visible</span><strong>{number(appStoreData?.apps?.length)}</strong></div><div><span>Version records</span><strong>{number(appleVersions.length)}</strong></div></div></Panel>
      <Panel title="Version-state distribution" subtitle="All mystc KW version records returned by Apple"><div className="state-chips">{Object.entries(stateCounts).sort((a,b)=>b[1]-a[1]).map(([state,count])=><div key={state}><strong>{number(count)}</strong><span>{stateLabel(state)}</span></div>)}</div></Panel>
      <Panel className="table-panel" title="Apple release history" subtitle="Newest version records first"><div className="table-wrap"><table><thead><tr><th>Version</th><th>Platform</th><th>State</th><th>Release type</th><th>Created</th></tr></thead><tbody>{appleVersions.slice(0,30).map(row=><tr key={row.id}><td><strong>{row.version}</strong></td><td>{stateLabel(row.platform)}</td><td><span className="store-state">{stateLabel(row.state)}</span></td><td>{stateLabel(row.releaseType)}</td><td>{row.createdDate ? new Date(row.createdDate).toLocaleString() : 'Not reported'}</td></tr>)}</tbody></table></div></Panel>
      <Panel title="Build access" subtitle="App Store Connect permission coverage">{appStoreData?.coverage?.builds ? <div className="compact-list">{appStoreData.builds.slice(0,10).map(row=><div key={row.id}><span>{row.version}</span><strong>{stateLabel(row.processingState)}</strong></div>)}</div> : <EmptyPanel title="Build records unavailable" copy="The current Sales and Reports key does not permit the Builds endpoint. Version and app metadata remain connected."/>}</Panel>
    </section>}

    {storeTab === 'coverage' && <Panel title="Sources, freshness and limitations" subtitle="Exactly what each connection currently contributes"><div className="table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>Available now</th><th>Freshness / limitation</th></tr></thead><tbody><tr><td><strong>Google Play Developer Reporting API</strong></td><td><span className="source-live">Live</span></td><td>Crash rate, ANR rate, user-perceived rates, measured-user denominators, 28-day history</td><td>Latest API date {data?.period?.endDate || 'loading'}</td></tr><tr><td><strong>Google Play Console snapshot</strong></td><td><span className="source-snapshot">Snapshot</span></td><td>Installed audience, installs, install base, acquisitions, first openers, MAU, rating</td><td>Observed Oct 1, 2026; not automatically refreshed</td></tr><tr><td><strong>App Store Connect API</strong></td><td><span className="source-live">Live</span></td><td>App identity, bundle ID, SKU, locale, version history and release states</td><td>{appStoreData?.generatedAt ? `Refreshed ${new Date(appStoreData.generatedAt).toLocaleString()}` : 'Loading'}</td></tr><tr><td><strong>Apple Sales &amp; Trends reports</strong></td><td><span className="source-limited">Not ingested</span></td><td>Downloads, redownloads, updates, proceeds and territory reports</td><td>Requires vendor-number report ingestion; missing values are not shown as zero</td></tr><tr><td><strong>Apple builds</strong></td><td><span className={appStoreData?.coverage?.builds ? 'source-live' : 'source-limited'}>{appStoreData?.coverage?.builds ? 'Live' : 'Restricted'}</span></td><td>{appStoreData?.coverage?.builds ? 'Recent build processing records' : 'No build records returned'}</td><td>{appStoreData?.coverage?.builds ? 'Current API response' : 'Sales and Reports key does not permit this endpoint'}</td></tr></tbody></table></div></Panel>}
  </>
}

function SettingsDashboard({ status, onConfigure }) {
  const connections = [
    { name:'Google Analytics 4', connected:status.connected, detail:status.connected ? `Property ${status.propertyId} · ${status.serviceAccountEmail}` : 'Property ID and service account required', icon:BarChart3 },
    { name:'Firebase / Crashlytics', connected:status.firebaseConnected, detail:status.firebaseConnected ? 'Firebase project connection is active' : 'Detailed Crashlytics connection has not been configured', icon:Bug },
    { name:'Adjust', connected:status.adjustConnected, detail:status.adjustConnected ? 'Adjust Report Service authorization is active' : 'Adjust API token required', icon:TrendingUp },
    { name:'Google Play', connected:status.playstoreConnected, detail:status.playstoreConnected ? `${status.playPackageName} · ${status.playServiceAccountEmail}` : 'Play Developer Reporting service account required', icon:Smartphone },
    { name:'Apple App Store', connected:status.appstoreConnected, detail:status.appstoreConnected ? `App Store Connect API key ${status.appstoreKeyId}` : 'Issuer ID, Key ID and private .p8 key required', icon:Download }
  ]
  const online = connections.filter(item => item.connected).length
  return <>
    <section className="settings-summary"><div><span className="eyebrow">Connection center</span><h2>Analytics and store integrations</h2><p>Review every source connection and open secure configuration from one place.</p></div><div className="settings-score"><strong>{online}/{connections.length}</strong><span>sources connected</span></div></section>
    <section className="settings-connections">{connections.map(({name,connected,detail,icon:Icon}) => <article key={name} className={connected ? 'connected' : 'offline'}><div className="settings-connection-icon"><Icon size={21}/></div><div><span className="connection-state"><i/>{connected ? 'Connected' : 'Not connected'}</span><h3>{name}</h3><p>{detail}</p></div></article>)}</section>
    <Panel title="Secure connection management" subtitle="Credentials are encrypted on this server and are never returned to the browser" action={<button className="primary-button" onClick={onConfigure}><Settings2 size={17}/>Open Analytics settings</button>}><div className="settings-guidance"><ShieldCheck size={24}/><div><strong>Super Admin only</strong><p>Use Analytics settings to test or update GA4, Adjust, Google Play and Apple App Store credentials. Existing secrets remain hidden. Firebase is shown separately because its detailed Crashlytics API connection is not configured yet.</p></div></div></Panel>
  </>
}

function SettingsModal({ status, onClose, onSaved }) {
  const [propertyId, setPropertyId] = useState(status.propertyId || '')
  const [json, setJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [adjustToken, setAdjustToken] = useState('')
  const [playPackageName, setPlayPackageName] = useState(status.playPackageName || 'com.pixilapps.selfcare')
  const [playJson, setPlayJson] = useState('')
  const [appStoreIssuerId, setAppStoreIssuerId] = useState('')
  const [appStoreKeyId, setAppStoreKeyId] = useState('')
  const [appStorePrivateKey, setAppStorePrivateKey] = useState('')

  async function submit(mode) {
    setBusy(true); setMessage(null)
    try {
      const result = await request(mode === 'test' ? '/settings/test' : '/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, serviceAccountJson: json })
      })
      setMessage({ type: 'success', text: mode === 'test' ? `Connection successful for property ${result.propertyId}.` : 'Connection saved securely.' })
      if (mode === 'save') await onSaved()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally { setBusy(false) }
  }

  async function saveAdjust() {
    setBusy(true); setMessage(null)
    try {
      const result = await request('/adjust-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: adjustToken })
      })
      setMessage({ type: 'success', text: `Adjust connected. ${result.appCount} app row(s) were visible in the connection test.` })
      setAdjustToken('')
      await onSaved()
    } catch (error) { setMessage({ type: 'error', text: error.message }) }
    finally { setBusy(false) }
  }

  async function savePlaystore() {
    setBusy(true); setMessage(null)
    try {
      const result = await request('/playstore-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageName: playPackageName, serviceAccountJson: playJson }) })
      setMessage({ type: 'success', text: `Playstore connected for ${result.packageName}.` }); setPlayJson(''); await onSaved()
    } catch (error) { setMessage({ type: 'error', text: error.message }) }
    finally { setBusy(false) }
  }

  async function saveAppStore() {
    setBusy(true); setMessage(null)
    try {
      const result = await request('/appstore-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issuerId: appStoreIssuerId, keyId: appStoreKeyId, privateKey: appStorePrivateKey }) })
      setMessage({ type: 'success', text: `App Store Connect API connected. ${result.appCount} app record(s) are accessible.` }); setAppStorePrivateKey(''); await onSaved()
    } catch (error) { setMessage({ type: 'error', text: error.message }) }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <button className="icon-button modal-close" onClick={onClose} aria-label="Close settings"><X size={19} /></button>
      <div className="modal-badge"><ShieldCheck size={20} /></div>
      <h2 id="settings-title">Google Analytics connection</h2>
      <p className="modal-intro">Credentials are encrypted on the server and are never returned to the browser.</p>
      {status.connected && <div className="current-connection"><CheckCircle2 size={17} /><span>Connected as <strong>{status.serviceAccountEmail}</strong></span></div>}
      <label>Numeric GA4 Property ID<input value={propertyId} onChange={event => setPropertyId(event.target.value)} placeholder="123456789" inputMode="numeric" /></label>
      <label>Service Account JSON<textarea value={json} onChange={event => setJson(event.target.value)} placeholder="Paste the complete service account JSON here" rows="10" spellCheck="false" /></label>
      <p className="security-note">Add the service account email to the GA4 property with Viewer access. Do not use a Measurement ID beginning with G-.</p>
      <hr className="settings-divider"/>
      <h3>Adjust Report Service</h3>
      {status.adjustConnected && <div className="current-connection"><CheckCircle2 size={17}/><span>Adjust API connected</span></div>}
      <label>Adjust API token<input type="password" aria-label="Adjust API token" value={adjustToken} onChange={event => setAdjustToken(event.target.value)} placeholder="Paste the API token from Adjust account settings" autoComplete="off"/></label>
      <button className="secondary-button" disabled={busy || !adjustToken} onClick={saveAdjust}>Save Adjust connection</button>
      <hr className="settings-divider"/>
      <h3>Google Play Developer Reporting</h3>
      {status.playstoreConnected && <div className="current-connection"><CheckCircle2 size={17}/><span>Playstore API connected as <strong>{status.playServiceAccountEmail}</strong></span></div>}
      <label>Android package name<input value={playPackageName} onChange={event => setPlayPackageName(event.target.value)} placeholder="com.example.app" /></label>
      <label>Play service account JSON<textarea value={playJson} onChange={event => setPlayJson(event.target.value)} placeholder="Paste a service account authorized in Play Console" rows="7" spellCheck="false" /></label>
      <p className="security-note">The service account must first be added by a Play Console owner under Users and permissions. Credentials are encrypted and never returned to the browser.</p>
      <button className="secondary-button" disabled={busy || !playPackageName || !playJson} onClick={savePlaystore}>Save Playstore connection</button>
      <hr className="settings-divider"/>
      <h3>Apple App Store Connect</h3>
      {status.appstoreConnected && <div className="current-connection"><CheckCircle2 size={17}/><span>App Store Connect API connected with key <strong>{status.appstoreKeyId}</strong></span></div>}
      <label>Issuer ID<input value={appStoreIssuerId} onChange={event => setAppStoreIssuerId(event.target.value)} placeholder="App Store Connect Issuer ID" /></label>
      <label>Key ID<input value={appStoreKeyId} onChange={event => setAppStoreKeyId(event.target.value)} placeholder="API Key ID" /></label>
      <label>Private API key (.p8 contents)<textarea value={appStorePrivateKey} onChange={event => setAppStorePrivateKey(event.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" rows="7" spellCheck="false" /></label>
      <p className="security-note">Use an App Store Connect API key with read access to mystc KW (Apple ID 511293831). Apple private keys can only be downloaded once; this value is encrypted on the dashboard server.</p>
      <button className="secondary-button" disabled={busy || !appStoreIssuerId || !appStoreKeyId || !appStorePrivateKey} onClick={saveAppStore}>Save App Store connection</button>
      {message && <div className={`form-message ${message.type}`}><AlertTriangle size={16} />{message.text}</div>}
      <div className="modal-actions">
        <button className="secondary-button" disabled={busy || !propertyId || !json} onClick={() => submit('test')}>Test connection</button>
        <button className="primary-button" disabled={busy || !propertyId || !json} onClick={() => submit('save')}>{busy ? 'Connecting…' : 'Save & connect'}</button>
      </div>
    </div>
  </div>
}

function EventsTable({ rows }) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => rows.filter(row => row.eventName?.toLowerCase().includes(search.toLowerCase())), [rows, search])
  return <>
    <div className="table-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search events" placeholder="Search event names" value={search} onChange={event => setSearch(event.target.value)} /></div><span>{filtered.length} events</span></div>
    <div className="table-wrap"><table><thead><tr><th>Event</th><th>Events</th><th>Users</th><th>Key events</th></tr></thead><tbody>
      {filtered.map(row => <tr key={row.eventName}><td><span className="event-dot" />{row.eventName}</td><td>{number(row.eventCount)}</td><td>{number(row.totalUsers)}</td><td>{number(row.keyEvents)}</td></tr>)}
      {!filtered.length && <tr><td colSpan="4" className="table-empty">No matching events.</td></tr>}
    </tbody></table></div>
  </>
}

function JourneyFunnel({ rows, tone = 'green' }) {
  const max = Math.max(1, ...(rows || []).map(row => row.activeUsers || 0))
  return <div className={`journey-funnel ${tone}`}>
    {(rows || []).map((row, index) => <div className="journey-step" key={row.step}>
      <div className="step-index">{index + 1}</div>
      <div className="step-body">
        <div className="step-label"><span>{row.step}</span><strong>{number(row.activeUsers)} users</strong></div>
        <div className="step-track"><i style={{ width: `${Math.max(row.activeUsers ? 4 : 0, row.activeUsers / max * 100)}%` }} /></div>
        {index < rows.length - 1 && <div className="step-meta"><span>{number(row.abandonments)} dropped</span><span>{percent(row.completionRate)} continued</span></div>}
      </div>
    </div>)}
  </div>
}

function AcquisitionTable({ rows }) {
  return <div className="table-wrap acquisition-table"><table><thead><tr><th>Source / medium</th><th>Campaign</th><th>Sessions</th><th>Users</th><th>Key events</th></tr></thead><tbody>
    {rows.map((row, index) => <tr key={`${row.sessionSourceMedium}-${row.sessionCampaignName}-${index}`}><td>{row.sessionSourceMedium}</td><td>{row.sessionCampaignName}</td><td>{number(row.sessions)}</td><td>{number(row.activeUsers)}</td><td>{number(row.keyEvents)}</td></tr>)}
    {!rows.length && <tr><td colSpan="5" className="table-empty">No acquisition rows were reported for this page.</td></tr>}
  </tbody></table></div>
}

function JourneyView({ data, requestedUrl, onAnalyze, loading }) {
  const [draft, setDraft] = useState(requestedUrl)
  useEffect(() => { setDraft(requestedUrl) }, [requestedUrl])
  if (!data) return <Panel title="URL journey analyzer" subtitle="Loading page-specific GA4 data"><EmptyPanel title="Loading journey" copy="Querying page, campaign and funnel evidence." /></Panel>
  const selectedLanguage = data.language
  const failedEvent = data.events.find(row => ['purchase_failed', 'failed_purchase', 'cancelled_purchase'].includes(row.eventName))
  const sampled = data.funnelSampling?.success
  const sampleRate = sampled ? Number(sampled.samplesReadCount) / Number(sampled.samplingSpaceSize) : null
  const switchLanguage = next => onAnalyze(data.page.url.replace(/\/(en|ar)(?=\/|$)/i, `/${next}`))
  const analyze = () => { if (draft.trim()) onAnalyze(draft.trim()) }
  return <>
    <section className="url-analyzer">
      <label htmlFor="journey-url">Page URL</label>
      <div><Globe2 size={18}/><input id="journey-url" type="url" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') analyze() }} placeholder="https://www.stc.com.kw/en/your-page"/><button className="primary-button" type="button" onClick={analyze} disabled={loading}>{loading ? 'Analyzing…' : 'Analyze URL'}</button></div>
      <p>Paste any HTTPS page on stc.com.kw. Reports use its exact URL path and the selected reporting period.</p>
    </section>
    <section className="journey-hero">
      <div><p className="eyebrow">URL journey analysis</p><h2>{data.page.titles[0]?.pageTitle || data.page.path}</h2><a href={data.page.url} target="_blank" rel="noreferrer">{data.page.url}</a><p>Closed user funnels begin with a page view on this exact route. Later steps must follow within 30 minutes.</p></div>
      {['en', 'ar'].includes(selectedLanguage) && <div className="language-toggle" role="group" aria-label="Page language"><button type="button" className={selectedLanguage === 'en' ? 'active' : ''} onClick={() => switchLanguage('en')}>English</button><button type="button" className={selectedLanguage === 'ar' ? 'active' : ''} onClick={() => switchLanguage('ar')}>العربية</button></div>}
    </section>
    <section className="metric-grid journey-metrics">
      <Metric icon={Eye} label="Page views" value={data.summary.screenPageViews} detail={`Exact route · ${selectedLanguage.toUpperCase()}`} />
      <Metric icon={Users} label="Page users" value={data.summary.activeUsers} detail="Active users in selected period" tone="blue" />
      <Metric icon={Route} label="Sessions" value={data.summary.sessions} detail="Sessions associated with this page" tone="purple" />
      <Metric icon={Radio} label="Live users now" value={data.realtime.activeUsers} detail={data.realtime.available ? `Matched: ${data.realtime.matchedTitle}` : 'Realtime title unavailable'} tone="amber" />
    </section>
    <section className="journey-grid">
      <Panel className="success-funnel" title="Purchase completion journey" subtitle="Users completing each ordered step">
        <JourneyFunnel rows={data.successFunnel} />
      </Panel>
      <Panel className="failure-funnel" title="Failed or cancelled journey" subtitle="Same entry and checkout sequence, ending in a failure event">
        <JourneyFunnel rows={data.failureFunnel} tone="red" />
      </Panel>
      <Panel className="journey-events" title="Events recorded on this page" subtitle="Diagnostic counts; these are not necessarily ordered funnel completions">
        <div className="journey-event-list">{data.events.map(row => <div key={row.eventName}><span>{row.eventName}</span><strong>{number(row.eventCount)}</strong><small>{number(row.totalUsers)} users</small></div>)}</div>
      </Panel>
      <Panel className="language-panel" title="Audience browser language" subtitle={`Visitors to the ${selectedLanguage.toUpperCase()} page route`}>
        <div className="compact-list">{data.browserLanguages.slice(0, 10).map((row, index) => <div key={row.language}><span className="rank">{String(index + 1).padStart(2, '0')}</span><span>{row.language}</span><strong>{number(row.activeUsers)}</strong></div>)}</div>
      </Panel>
      <Panel className="campaign-panel" title="Traffic sources and campaigns" subtitle="Sessions associated with this page, by session source / medium and campaign">
        <AcquisitionTable rows={data.acquisition} />
      </Panel>
      <div className="coverage-note"><ShieldCheck size={17}/><div><strong>Measurement notes</strong><span>Route language is based on <code>{data.page.path}</code>; browser language is reported separately. The closed funnel counts ordered users, while the page-event list counts all matching events on the page. {failedEvent ? `${number(failedEvent.eventCount)} failure event(s) were recorded directly on this page.` : 'No failure event was recorded directly on this page.'}{sampleRate ? ` Funnel results are sampled at ${percent(sampleRate)} of the available event space.` : ''}</span></div></div>
    </section>
  </>
}

function ProductItemsTable({ rows, empty }) {
  const [page, setPage] = useState(0)
  const pageSize = 100
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => setPage(0), [rows.length])
  return <>
    <div className="table-wrap"><table><thead><tr><th>Product</th><th>Platform</th><th>Type</th><th>Language</th><th>Source page / item list</th><th>Item ID</th><th>Categories</th><th>Duration</th><th>Journey</th><th>SIM type</th><th>Number type</th><th>Plan ID</th><th>Purchase option</th><th>Items viewed</th></tr></thead><tbody>
      {rows.slice(page * pageSize, (page + 1) * pageSize).map((row, index) => <tr key={`${row.platform}-${row.pagePath || row.sourceName}-${row.itemName}-${row.itemId}-${index}`}><td><strong>{row.itemName || 'Not reported'}</strong>{row.itemBrand && <small>{row.itemBrand}</small>}</td><td>{row.platform === 'app' ? 'App' : 'Web'}</td><td><span className="product-type">{row.productType}</span></td><td>{row.language === 'app' ? '—' : row.language?.toUpperCase() || 'OTHER'}</td><td>{row.pageUrl ? <a href={row.pageUrl} target="_blank" rel="noreferrer">{row.pagePath}</a> : row.sourceName || 'Not reported'}</td><td><code>{row.itemId || 'Not reported'}</code></td><td>{[row.itemCategory, row.itemCategory2, row.itemCategory3].filter(Boolean).join(' / ') || 'Not reported'}</td><td>{row.itemCategory5 || 'Not reported'}</td><td>{row.journey || 'Not reported'}</td><td>{row.simType || 'Not reported'}</td><td>{row.numberType || 'Not reported'}</td><td><code>{row.planId || 'Not reported'}</code></td><td>{row.purchaseOption || 'Not reported'}</td><td>{number(row.itemsViewed)}</td></tr>)}
      {!rows.length && <tr><td colSpan="14" className="table-empty">{empty}</td></tr>}
    </tbody></table></div>
    {rows.length > pageSize && <div className="pagination"><button className="secondary-button compact" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page + 1} / {pages}</span><button className="secondary-button compact" disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div>}
  </>
}

function PlansItemsView({ data }) {
  const [language, setLanguage] = useState('all')
  const [type, setType] = useState('all')
  const [search, setSearch] = useState('')
  if (!data) return <Panel title="Plans & items" subtitle="Loading English and Arabic ecommerce products"><EmptyPanel title="Loading product catalogue" copy="Querying all view_item ecommerce details from GA4." /></Panel>
  const matches = row => (language === 'all' || row.language === language) && (type === 'all' || row.productType === type) && `${row.itemName || ''} ${row.itemId || ''} ${row.itemBrand || ''} ${row.pagePath || ''} ${row.sourceName || ''} ${row.itemCategory || ''} ${row.itemCategory2 || ''} ${row.itemCategory3 || ''}`.toLowerCase().includes(search.toLowerCase())
  const filtered = (data.items || []).filter(matches)
  const vouchers = (data.vouchers || []).filter(row => (language === 'all' || row.language === language) && `${row.itemName || ''} ${row.itemId || ''} ${row.itemBrand || ''} ${row.pagePath || ''}`.toLowerCase().includes(search.toLowerCase()))
  return <>
    <section className="journey-hero">
      <div><p className="eyebrow">GA4 ecommerce catalogue</p><h2>All plans, items and offers</h2><p>Products reported from STC Web pages and App item lists, including plans, bundles, boosters, roaming offers and vouchers.</p></div>
      <ShoppingCart size={42}/>
    </section>
    <section className="metric-grid">
      <Metric icon={ShoppingCart} label="Product combinations" value={data.summary.products} detail="Across the selected platform" />
      <Metric icon={Eye} label="Items viewed" value={data.summary.itemViews} detail="GA4 itemsViewed total" tone="blue" />
      <Metric icon={Languages} label="English / Arabic / App" value={`${number(data.summary.english)} / ${number(data.summary.arabic)} / ${number(data.summary.app)}`} detail="Reported product rows" tone="purple" />
      <Metric icon={Download} label="Vouchers" value={data.summary.vouchers} detail="eVouchers and gift cards" tone="amber" />
    </section>
    <section className="dashboard-grid">
      <Panel className="table-panel" title="Complete product catalogue" subtitle={`${number(filtered.length)} matching English and Arabic product rows`} action={<div className="inventory-actions"><select aria-label="Product language" value={language} onChange={event => setLanguage(event.target.value)}><option value="all">All languages</option><option value="en">English</option><option value="ar">Arabic</option></select><select aria-label="Product type" value={type} onChange={event => setType(event.target.value)}><option value="all">All product types</option>{['Plans','Bundles','Boosters','Roaming plans','Vouchers','Other offers'].map(value => <option value={value} key={value}>{value}</option>)}</select><div className="search-box"><Search size={16}/><input aria-label="Search products" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search product, ID or page"/></div></div>}>
        <ProductItemsTable rows={filtered} empty="No products match these filters."/>
      </Panel>
      <Panel className="table-panel voucher-panel" title="Vouchers" subtitle={`${number(vouchers.length)} eVoucher and gift-card rows · reference route /en/voucher`}>
        <ProductItemsTable rows={vouchers} empty="No voucher item details were reported for the selected dates and language."/>
      </Panel>
      <div className="coverage-note"><ShieldCheck size={17}/><div><strong>Catalogue coverage</strong><span>{data.coverage.source || data.coverage.app} A viewed item is not automatically a completed selection or purchase. Product type is classified from the reported page, name and category fields. {data.coverage.dataLossFromOtherRow ? 'GA4 grouped some high-cardinality combinations into its “other” row, so the catalogue may not be exhaustive.' : ''}{data.coverage.rowLimitReached ? ' The GA4 100,000-row response limit was reached.' : ''}</span></div></div>
    </section>
  </>
}

function JourneyMonitoringView({ data }) {
  const [step, setStep] = useState('all')
  const [search, setSearch] = useState('')
  const steps = useMemo(() => [...new Set((data?.issues || []).map(row => row.step))].sort(), [data])
  const issues = useMemo(() => (data?.issues || []).filter(row => (step === 'all' || row.step === step) && `${row.pagePath || ''} ${row.pageTitle || ''} ${row.eventName} ${row.issue} ${row.channel || ''} ${row.platform || ''} ${row.operatingSystem || ''} ${row.appVersion || ''}`.toLowerCase().includes(search.toLowerCase())), [data, step, search])
  if (!data) return <Panel title="Journey Monitoring" subtitle="Loading failure signals"><EmptyPanel title="Loading blocked journeys" copy="Querying failed, cancelled and payment events from GA4." /></Panel>
  return <>
    <section className="metric-grid">
      <Metric icon={Siren} label="Failure events" value={data.summary.failureEvents} detail="Failed or cancelled activity" tone="amber"/>
      <Metric icon={Users} label="Affected user reports" value={data.summary.affectedUserReports} detail="Users may appear in more than one issue" tone="blue"/>
      <Metric icon={ShoppingCart} label="Failed payments" value={data.summary.failedPayments} detail="Payment and payment-method events" tone="purple"/>
      <Metric icon={Route} label="Issue locations" value={data.summary.issueRows} detail="Page and failure-event combinations"/>
    </section>
    <section className="dashboard-grid">
      <Panel className="table-panel" title="Blocked journey details" subtitle={`${number(issues.length)} matching issue rows · ${data.period.startDate} to ${data.period.endDate}`} action={<div className="inventory-actions"><select aria-label="Filter journey step" value={step} onChange={event => setStep(event.target.value)}><option value="all">All journey steps</option>{steps.map(item => <option value={item} key={item}>{item}</option>)}</select><div className="search-box"><Search size={16}/><input aria-label="Search journey issues" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search page or issue"/></div></div>}>
        <div className="table-wrap"><table><thead><tr><th>Date & time</th><th>Source</th><th>App version</th><th>Affected page / screen</th><th>Journey step</th><th>Issue</th><th>Plan / product</th><th>Reference</th><th>User details</th><th>Users affected</th><th>Events</th></tr></thead><tbody>
          {issues.map((row, index) => <tr key={`${row.dateHourMinute}-${row.platform}-${row.appVersion}-${row.eventName}-${row.pagePath}-${index}`}><td className="nowrap">{dateTimeLabel(row.dateHourMinute)}</td><td><b>{row.channel || 'Not reported'}</b><small>{row.platform || row.operatingSystem || 'Not reported'}</small></td><td>{row.channel === 'App' ? row.appVersion || 'Not reported' : 'Not applicable'}</td><td>{row.pagePath ? <><strong>{row.pagePath}</strong>{row.pageTitle && <small>{row.pageTitle}</small>}</> : 'Page not reported'}</td><td><span className="issue-step">{row.step}</span></td><td>{row.issue}<small><code>{row.eventName}</code></small></td><td>{row.itemName || row.itemId || 'Not reported'}{row.itemName && row.itemId && <small>ID: {row.itemId}</small>}</td><td>{row.transactionId || 'Not reported'}</td><td>Not available in GA4</td><td>{number(row.totalUsers)}</td><td>{number(row.eventCount)}</td></tr>)}
          {!issues.length && <tr><td colSpan="11" className="table-empty">No failed or cancelled journey events match these filters.</td></tr>}
        </tbody></table></div>
      </Panel>
      <div className="coverage-note"><ShieldCheck size={17}/><div><strong>Data coverage and privacy</strong><span>{data.coverage.timestamp} {data.coverage.platform} {data.coverage.commerce} {data.coverage.userDetails} Affected users are aggregated per row and can overlap. “Page not reported” means the event arrived without page or screen context.</span></div></div>
    </section>
  </>
}

function FunnelsView({ data, journey, onJourneyChange }) {
  if (!data) return <Panel title="Funnels" subtitle="Loading ordered GA4 funnel data"><EmptyPanel title="Loading journey funnel" copy="Querying the web and app success paths and failure events." /></Panel>
  const sampled = data.reports.find(report => report.sampling)
  return <>
    <section className="lifecycle-hero">
      <div><p className="eyebrow">{data.eyebrow}</p><h2>{data.name} funnel</h2><p>{data.description} A user must enter through the configured journey context and complete each step within 30 minutes of the prior step.</p></div>
      <div className="heading-actions"><label className="scope-filter">Journey<select aria-label="Funnel journey" value={journey} onChange={event => onJourneyChange(event.target.value)}>{data.availableJourneys.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><Route size={42}/></div>
    </section>
    <section className="gnl-platforms">
      {data.reports.map(report => <article className="gnl-report" key={report.platform}>
        <div className="gnl-report-head"><div><span>{report.platform === 'web' ? <Globe2 size={18}/> : <Smartphone size={18}/>}</span><div><p>{report.platform}</p><h2>{report.platform === 'web' ? 'Website funnel' : 'App funnel'}</h2></div></div><strong>{percent(report.summary.completionRate)}</strong></div>
        <div className="gnl-summary"><div><span>Entered funnel</span><strong>{number(report.summary.entrants)}</strong></div><div><span>{data.outcomeLabel}</span><strong>{number(report.summary.recordedPurchaseEvents)}</strong><small>{number(report.summary.recordedPurchaseUsers)} users · <code>{report.summary.recordedPurchaseEvent}</code></small></div><div><span>Strict completions</span><strong>{number(report.summary.completions)}</strong></div><div><span>Failure events</span><strong>{number(report.summary.failureEvents)}</strong></div></div>
        <div className="journey-funnel">{report.steps.map((step, index) => <div className="journey-step" key={step.step}><span className="step-index">{index + 1}</span><div><div className="step-label"><span>{step.step}</span><strong>{number(step.activeUsers)} users</strong></div><div className="step-track"><i style={{width: `${report.summary.entrants ? Math.max(2, step.activeUsers / report.summary.entrants * 100) : 0}%`}}/></div><div className="step-meta"><span>{percent(step.completionRate)} advanced</span><span>{number(step.abandonments)} abandoned</span></div></div></div>)}</div>
        <div className="gnl-failures"><h3>Failure and cancellation signals</h3>{report.failures.map(row => <div key={row.eventName}><code>{row.eventName}</code><span>{number(row.totalUsers)} users</span><strong>{number(row.eventCount)} events</strong></div>)}</div>
        {data.esimRelevant && <div className="gnl-failures"><h3>eSIM QR and activation · platform-wide signals</h3><div><span>eSIM activated</span><span>{number(report.esim.activated.totalUsers)} users</span><strong>{number(report.esim.activated.eventCount)} events</strong></div><div><span>eSIM activation failed</span><span>{number(report.esim.activationFailed.totalUsers)} users</span><strong>{number(report.esim.activationFailed.eventCount)} events</strong></div><div><span>QR generated / displayed</span><span>{report.esim.qrDeliveryInstrumented ? `${number(report.esim.qrGenerated.totalUsers)} users` : 'Not instrumented'}</span><strong>{report.esim.qrDeliveryInstrumented ? `${number(report.esim.qrGenerated.eventCount)} events` : '—'}</strong></div><div><span>QR not received / failed</span><span>{report.esim.qrDeliveryInstrumented ? `${number(report.esim.qrFailed.totalUsers)} users` : 'Not available'}</span><strong>{report.esim.qrDeliveryInstrumented ? `${number(report.esim.qrFailed.eventCount)} events` : 'Needs QR event'}</strong></div><p className="panel-note">Generic eSIM events do not carry a journey ID in the current GA4 response, so these are selected-platform totals and cannot yet be assigned exclusively to this journey.</p></div>}
      </article>)}
    </section>
    <section className="dashboard-grid"><Panel className="table-panel" title="Complete event tracking checklist" subtitle={`${data.period.startDate} to ${data.period.endDate} · ${data.name} Web and App event names`}><div className="table-wrap"><table><thead><tr><th>Platform</th><th>Event</th><th>Users</th><th>Events</th><th>Interpretation</th></tr></thead><tbody>{data.reports.flatMap(report => report.events.map(row => <tr key={`${report.platform}-${row.eventName}`}><td>{report.platform}</td><td><code>{row.eventName}</code></td><td>{number(row.totalUsers)}</td><td>{number(row.eventCount)}</td><td>{report.failures.some(failure => failure.eventName === row.eventName) ? <span className="issue-step">Failure</span> : row.eventCount ? 'Tracked' : 'Not received'}</td></tr>))}</tbody></table></div></Panel><div className="coverage-note"><ShieldCheck size={17}/><div><strong>Coverage and interpretation</strong><span>{data.coverage.web} {data.coverage.app} {data.coverage.failures} Both <code>id_verify_startred</code> (the supplied spelling) and <code>id_verify_started</code> are monitored where applicable. eSIM activation events do not prove whether a QR code was delivered. “QR not received” is shown only when a dedicated <code>esim_qr_failed</code> or <code>qr_code_failed</code> event is collected; otherwise it remains unavailable. “Completed purchase” means the ordered funnel reached a configured purchase event; GA4 cannot prove the user experienced no recoverable error earlier unless a journey ID is collected and joined in BigQuery. {sampled && `GA4 sampled this funnel (${number(Number(sampled.sampling.samplesReadCount))} of ${number(Number(sampled.sampling.samplingSpaceSize))} eligible events), so funnel counts are estimates.`}</span></div></div></section>
  </>
}

function App() {
  const [auth, setAuth] = useState(null)
  const [status, setStatus] = useState({ connected: false })
  const [data, setData] = useState(null)
  const [overview, setOverview] = useState(null)
  const [campaigns, setCampaigns] = useState(null)
  const [realtime, setRealtime] = useState(null)
  const [journey, setJourney] = useState(null)
  const [products, setProducts] = useState(null)
  const [journeyMonitoring, setJourneyMonitoring] = useState(null)
  const [funnel, setFunnel] = useState(null)
  const [funnelJourney, setFunnelJourney] = useState('prepaid')
  const [lifecycle, setLifecycle] = useState(null)
  const [quality, setQuality] = useState(null)
  const [inventory, setInventory] = useState(null)
  const [adjust, setAdjust] = useState(null)
  const [playstore, setPlaystore] = useState(null)
  const [appStore, setAppStore] = useState(null)
  const [assistantMessages, setAssistantMessages] = useState([])
  const today = new Date().toISOString().slice(0, 10)
  const defaultFrom = new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10)
  const [customFrom, setCustomFrom] = useState(defaultFrom)
  const [customTo, setCustomTo] = useState(today)
  const [scope, setScope] = useState('all')
  const [appliedFilters, setAppliedFilters] = useState({ from: defaultFrom, to: today, scope: 'all' })
  const [refreshKey, setRefreshKey] = useState(0)
  const { from: appliedFrom, to: appliedTo, scope: appliedScope } = appliedFilters
  const [pageUrl, setPageUrl] = useState('https://www.stc.com.kw/en/prepaid-plans')
  const [view, setView] = useState(() => viewFromPath(window.location.pathname))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('eventscope-sidebar-collapsed') === 'true')

  useEffect(() => {
    if (auth?.authenticated && assistantMessages.length === 0) setAssistantMessages([{ role: 'assistant', text: akGreeting(auth.user?.displayName || auth.user?.username) }])
  }, [auth, assistantMessages.length])

  const allowed = auth?.user?.dashboards || []
  const isSuperAdmin = auth?.user?.role === 'super_admin'

  const navigate = useCallback(nextView => {
    const path = dashboardPaths[nextView] || '/'
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setView(nextView)
  }, [])

  const navigateFromSidebar = useCallback(nextView => {
    navigate(nextView)
    if (sidebarCollapsed) {
      setSidebarCollapsed(false)
      window.localStorage.setItem('eventscope-sidebar-collapsed', 'false')
    }
  }, [navigate, sidebarCollapsed])

  function toggleSidebar() {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    window.localStorage.setItem('eventscope-sidebar-collapsed', String(next))
  }

  useEffect(() => {
    const syncView = () => setView(viewFromPath(window.location.pathname))
    window.addEventListener('popstate', syncView)
    return () => window.removeEventListener('popstate', syncView)
  }, [])

  const loadStatus = useCallback(async () => {
    const next = await request('/status')
    setStatus(next)
    return next
  }, [])

  const loadData = useCallback(async (connected = status.connected) => {
    if (!connected) { setLoading(false); return }
    setLoading(true); setError('')
    const startDate = appliedFrom
    const endDate = appliedTo
    const results = await Promise.allSettled([
      request(`/dashboard?startDate=${startDate}&endDate=${endDate}&scope=${appliedScope}`).then(setData),
      request(`/realtime?scope=${appliedScope}`).then(setRealtime),
      request(`/page-journey?startDate=${startDate}&endDate=${endDate}&scope=${appliedScope}&url=${encodeURIComponent(pageUrl)}`).then(setJourney),
      request(`/app-lifecycle?startDate=${startDate}&endDate=${endDate}&scope=${appliedScope}`).then(setLifecycle)
    ])
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length === results.length) throw failures[0].reason
    if (failures.length) setError(`${failures.length} analytics report(s) could not be refreshed; available reports are shown.`)
    setLoading(false)
  }, [appliedFrom, appliedTo, pageUrl, appliedScope, status.connected])

  useEffect(() => { request('/auth/session').then(setAuth).catch(() => setAuth({ authenticated: false })) }, [])

  useEffect(() => {
    if (!auth?.authenticated) return
    const permitted = isSuperAdmin || view === 'access-control' ? isSuperAdmin : allowed.includes(view)
    if (!permitted) navigate(allowed[0] || 'overview')
    loadStatus().then(next => { if (!next.connected) setLoading(false) }).catch(error => { setError(error.message); setLoading(false) })
  }, [auth?.authenticated])

  useEffect(() => {
    if (!status.connected || !['legacy-overview', 'assistant'].includes(view)) return
    loadData(true).catch(error => { setError(error.message); setLoading(false) })
  }, [view, appliedFrom, appliedTo, pageUrl, appliedScope, refreshKey, auth?.authenticated, status.connected])

  useEffect(() => {
    if (view !== 'journey' || !status.connected) return
    setLoading(true); setError('')
    request(`/page-journey?startDate=${appliedFrom}&endDate=${appliedTo}&scope=${appliedScope}&url=${encodeURIComponent(pageUrl)}`)
      .then(setJourney).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, appliedFrom, appliedTo, pageUrl, appliedScope, refreshKey, status.connected])

  useEffect(() => {
    if (!['lifecycle', 'comparison'].includes(view) || !status.connected) return
    setLoading(true); setError('')
    request(`/app-lifecycle?startDate=${appliedFrom}&endDate=${appliedTo}&scope=${appliedScope}`)
      .then(setLifecycle).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, appliedFrom, appliedTo, appliedScope, refreshKey, status.connected])

  useEffect(() => {
    if (view !== 'plans-items' || !status.connected) return
    setLoading(true); setError('')
    request(`/products-items?startDate=${appliedFrom}&endDate=${appliedTo}&scope=${appliedScope}`)
      .then(setProducts).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, appliedFrom, appliedTo, appliedScope, refreshKey, status.connected])

  useEffect(() => {
    if (view !== 'overview' || !status.connected) return
    setLoading(true); setError('')
    request(`/main-overview?startDate=${appliedFrom}&endDate=${appliedTo}&scope=${appliedScope}`)
      .then(setOverview).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, appliedFrom, appliedTo, appliedScope, refreshKey, status.connected])

  const loadCampaigns = useCallback(async () => {
    const next = await request(`/campaigns?startDate=${appliedFrom}&endDate=${appliedTo}&scope=${appliedScope}`)
    setCampaigns(next)
  }, [appliedFrom, appliedTo, appliedScope])

  useEffect(() => {
    if (view !== 'campaigns' || !status.connected) return
    setLoading(true); setError('')
    loadCampaigns().catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, loadCampaigns, refreshKey, status.connected])

  useEffect(() => {
    if (!['adjust', 'comparison', 'assistant'].includes(view) || !status.adjustConnected) return
    setLoading(true); setError('')
    request(`/adjust-installs?startDate=${appliedFrom}&endDate=${appliedTo}&scope=${appliedScope}`)
      .then(setAdjust).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, appliedFrom, appliedTo, appliedScope, refreshKey, status.adjustConnected])

  useEffect(() => {
    if (view !== 'playstore' || !status.playstoreConnected) return
    setLoading(true); setError('')
    request('/playstore').then(setPlaystore).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, refreshKey, status.playstoreConnected])

  useEffect(() => {
    if (view !== 'playstore' || !status.appstoreConnected) return
    request('/appstore').then(setAppStore).catch(error => setError(error.message))
  }, [view, refreshKey, status.appstoreConnected])

  useEffect(() => {
    if (view !== 'quality' || !status.connected) return
    setLoading(true); setError('')
    request(`/quality?startDate=${appliedFrom}&endDate=${appliedTo}&scope=${appliedScope}`)
      .then(setQuality).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, appliedFrom, appliedTo, appliedScope, refreshKey, status.connected])

  useEffect(() => {
    if (view !== 'journey-monitoring' || !status.connected) return
    setLoading(true); setError('')
    request(`/journey-monitoring?startDate=${appliedFrom}&endDate=${appliedTo}&scope=${appliedScope}`)
      .then(setJourneyMonitoring).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, appliedFrom, appliedTo, appliedScope, refreshKey, status.connected])

  useEffect(() => {
    if (view !== 'funnels' || !status.connected) return
    setLoading(true); setError('')
    request(`/funnels?startDate=${appliedFrom}&endDate=${appliedTo}&scope=${appliedScope}&journey=${funnelJourney}`)
      .then(setFunnel).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, appliedFrom, appliedTo, appliedScope, refreshKey, funnelJourney, status.connected])

  useEffect(() => {
    if (view !== 'urls' || !status.connected) return
    setLoading(true); setError('')
    request(`/url-inventory?startDate=${appliedFrom}&endDate=${appliedTo}&scope=${appliedScope}`)
      .then(setInventory).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [view, appliedFrom, appliedTo, appliedScope, refreshKey, status.connected])

  async function saved() {
    const next = await loadStatus()
    await loadData(next.connected)
    setSettingsOpen(false)
  }

  function analyzeUrl(url, target = 'journey') {
    navigate(target)
    setPageUrl(url)
  }

  function openOverviewDetail(target, pagePath, journeyKey) {
    if (pagePath) setPageUrl(`https://www.stc.com.kw${pagePath.startsWith('/') ? pagePath : `/${pagePath}`}`)
    if (journeyKey) setFunnelJourney(journeyKey)
    navigate(target)
  }

  function exportEvents() {
    if (!data?.events?.length) return
    const header = ['Event name', 'Event count', 'Total users', 'Key events']
    const values = data.events.map(row => [row.eventName, row.eventCount, row.totalUsers, row.keyEvents])
    const csv = [header, ...values].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.download = `ga4-events-${new Date().toISOString().slice(0, 10)}.csv`
    link.click(); URL.revokeObjectURL(link.href)
  }

  function downloadCsv(filename, sections) {
    const csv = sections.flatMap(section => [
      [section.title],
      section.headers,
      ...section.rows,
      []
    ]).map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click(); URL.revokeObjectURL(link.href)
  }

  function exportCurrentDashboard() {
    if (view === 'overview' && overview) downloadCsv('main-overview', [
      { title: 'Journey failures', headers: ['Date and time','Source','Platform','Operating system','App version','Journey','Page or screen','Failure point','Issue','Event','Users','Events'], rows: overview.failures.map(r => [dateTimeLabel(r.dateHourMinute),r.channel,r.platform || '',r.operatingSystem || '',r.channel === 'App' ? r.appVersion || 'Not reported' : 'Not applicable',r.journey,r.pagePath || r.unifiedScreenName || '',r.step,r.issue,r.eventName,r.totalUsers,r.eventCount]) },
      { title: 'Purchases by offer type', headers: ['Offer type','Purchased units or events'], rows: overview.purchases.map(r => [r.productType,r.count]) },
      { title: 'High and low completed sales item rows', headers: ['Offer type','Journey','Platform','Latest reported purchase date','Item','Plan name','Offer ID','Variant','Item ID','Brand','Category','Category 2','Category 3','Purchased units','Revenue'], rows: overview.salesItems.map(r => [r.productType,r.journey,r.platform,r.latestPurchaseDate,r.itemName,r.planName,r.offerId,r.itemVariant,r.itemId,r.itemBrand,r.itemCategory,r.itemCategory2,r.itemCategory3,r.itemsPurchased,r.itemRevenue]) },
      { title: 'Completed prepaid, postpaid and youth products', headers: ['Journey','Item','Plan name','Offer ID','Variant','Item ID','Offer type','Purchased units','Revenue'], rows: (overview.completedPlanPurchases?.products || []).map(r => [r.purchaseSegment,r.itemName,r.planName,r.offerId,r.itemVariant,r.itemId,r.productType,r.itemsPurchased,r.itemRevenue]) },
      { title: 'Strict prepaid plan completions', headers: ['GA4 event','Completed events','Reported users'], rows: [[overview.completedPlanPurchases?.strictPrepaid?.eventName,overview.completedPlanPurchases?.strictPrepaid?.completions,overview.completedPlanPurchases?.strictPrepaid?.users]] },
      { title: 'App activity', headers: ['Operating system','Installs / first opens','Unique install users','Uninstall events','Unique uninstall users'], rows: [['Android',overview.appActivity.android.installs,overview.appActivity.android.installUsers,overview.appActivity.android.uninstalls,overview.appActivity.android.uninstallUsers],['iOS',overview.appActivity.ios.installs,overview.appActivity.ios.installUsers,overview.appActivity.ios.uninstalls,overview.appActivity.ios.uninstallUsers]] },
      { title: 'Engagement', headers: ['Journey','Page','Title','Views','Users'], rows: overview.engagement.map(r => [r.journey,r.pagePath,r.pageTitle,r.screenPageViews,r.activeUsers]) },
      { title: 'Customer locations', headers: ['Country','Region','Users','Purchases'], rows: overview.customers.locations.map(r => [r.country,r.region,r.activeUsers,r.ecommercePurchases]) },
      { title: 'Customer age groups', headers: ['Age group','Users','Purchases'], rows: overview.customers.ages.map(r => [r.userAgeBracket,r.activeUsers,r.ecommercePurchases]) },
      { title: 'On-site search terms by location', headers: ['Search term','Country','Region / governorate','Platform','Search events','Users'], rows: overview.keywords.siteSearch.map(r => [r.searchTerm,r.country,r.region,r.platform,r.eventCount,r.totalUsers]) },
      { title: 'Paid campaign terms by location', headers: ['Campaign term','Source','Medium','Country','Region / governorate','Sessions','Users','Purchases'], rows: overview.keywords.paidSearch.map(r => [r.sessionManualTerm,r.sessionSource,r.sessionMedium,r.country,r.region,r.sessions,r.activeUsers,r.ecommercePurchases]) },
      { title: 'Voucher purchases', headers: ['Latest reported purchase date','Brand','Voucher','Denomination or variant','Item ID','Platform','Purchased units','Revenue'], rows: (overview.vouchers || []).map(r => [r.latestPurchaseDate,r.itemBrand,r.itemName,r.itemVariant || r.itemCategory3 || r.itemCategory2,r.itemId,r.platform,r.itemsPurchased,r.itemRevenue]) },
      { title: 'Device purchases', headers: ['Latest reported purchase date','Category','Model','Variant','Item ID','Brand','Platform','Purchased units','Revenue'], rows: overview.devices.map(r => [r.latestPurchaseDate,r.itemCategory3 || r.itemCategory2 || r.itemCategory,r.itemName,r.itemVariant,r.itemId,r.itemBrand,r.platform,r.itemsPurchased,r.itemRevenue]) }
    ])
    if (view === 'journey' && journey) downloadCsv('ga4-url-journey', [
      { title: `Page summary: ${journey.page.url}`, headers: ['Page views','Users','Sessions','Events','Key events'], rows: [[journey.summary.screenPageViews,journey.summary.activeUsers,journey.summary.sessions,journey.summary.eventCount,journey.summary.keyEvents]] },
      { title: 'Page events', headers: ['Event','Events','Users','Key events'], rows: journey.events.map(r => [r.eventName,r.eventCount,r.totalUsers,r.keyEvents]) },
      { title: 'Traffic sources and campaigns', headers: ['Source / medium','Campaign','Sessions','Users','Key events'], rows: journey.acquisition.map(r => [r.sessionSourceMedium,r.sessionCampaignName,r.sessions,r.activeUsers,r.keyEvents]) },
      { title: 'Browser languages', headers: ['Language','Users','Sessions'], rows: journey.browserLanguages.map(r => [r.language,r.activeUsers,r.sessions]) }
    ])
    if (view === 'campaigns' && campaigns) downloadCsv('campaign-and-utm-monitoring', [
      { title: 'Production campaign registry', headers: ['Created','Website URL','Campaign URL','Campaign ID','Source','Medium','Name','Term','Content'], rows: campaigns.registry.map(r => [r.createdAt,r.websiteUrl,r.campaignUrl,r.campaignId,r.campaignSource,r.campaignMedium,r.campaignName,r.campaignTerm,r.campaignContent]) },
      { title: 'Full UTM URLs', headers: ['Full URL','Source','Medium','Campaign','Campaign ID','Term','Content'], rows: [...new Map([...campaigns.registry.map(r => r.campaignUrl), ...campaigns.campaigns.map(r => r.landingPagePlusQueryString)].map(parseUtmUrl).filter(Boolean).map(r => [r.fullUrl,r])).values()].map(r => [r.fullUrl,r.source,r.medium,r.campaign,r.id,r.term,r.content]) },
      { title: 'GA4 campaign attribution', headers: ['Campaign','Campaign ID','Source','Medium','Term','Content','Landing page','Sessions','Users','Engaged sessions','Key events','Purchases','Revenue'], rows: campaigns.campaigns.map(r => [r.sessionCampaignName,r.sessionCampaignId,r.sessionSource,r.sessionMedium,r.sessionManualTerm,r.sessionManualAdContent,r.landingPagePlusQueryString,r.sessions,r.activeUsers,r.engagedSessions,r.keyEvents,r.ecommercePurchases,r.totalRevenue]) },
      { title: 'Daily campaign trend', headers: ['Date','Campaign','Sessions','Users','Purchases'], rows: campaigns.trend.map(r => [r.date,r.sessionCampaignName,r.sessions,r.activeUsers,r.ecommercePurchases]) }
    ])
    if (view === 'plans-items' && products) downloadCsv('ga4-all-products-and-vouchers', [
      { title: 'All Web and App products', headers: ['Platform','Product type','Language','Source page or item list','Item name','Item ID','Brand','Category','Category 2','Category 3','Duration','Journey','SIM type','Number type','Plan ID','Purchase option','Items viewed'], rows: (products.items || []).map(r => [r.platform,r.productType,r.language === 'app' ? '' : r.language,r.pageUrl || r.sourceName,r.itemName,r.itemId,r.itemBrand,r.itemCategory,r.itemCategory2,r.itemCategory3,r.itemCategory5,r.journey,r.simType,r.numberType,r.planId,r.purchaseOption,r.itemsViewed]) },
      { title: 'Vouchers', headers: ['Platform','Language','Source page or item list','Item name','Item ID','Brand','Category','Category 2','Category 3','Items viewed'], rows: (products.vouchers || []).map(r => [r.platform,r.language === 'app' ? '' : r.language,r.pageUrl || r.sourceName,r.itemName,r.itemId,r.itemBrand,r.itemCategory,r.itemCategory2,r.itemCategory3,r.itemsViewed]) }
    ])
    if (view === 'journey-monitoring' && journeyMonitoring) downloadCsv('ga4-journey-monitoring', [
      { title: `Journey monitoring · ${journeyMonitoring.period.startDate} to ${journeyMonitoring.period.endDate}`, headers: ['Date and time','Channel','Platform','Operating system','App version','Affected page or screen','Page or screen title','Journey step','Issue','GA4 event','Plan or product','Item ID','Transaction reference','User details','Users affected','Events'], rows: journeyMonitoring.issues.map(r => [dateTimeLabel(r.dateHourMinute),r.channel,r.platform || '',r.operatingSystem || '',r.channel === 'App' ? r.appVersion || 'Not reported' : 'Not applicable',r.pagePath || 'Page not reported',r.pageTitle || '',r.step,r.issue,r.eventName,r.itemName || '',r.itemId || '',r.transactionId || '','Not available in GA4',r.totalUsers,r.eventCount]) }
    ])
    if (view === 'funnels' && funnel) downloadCsv(`ga4-${funnelJourney}-funnel`, funnel.reports.flatMap(report => [
      { title: `${report.platform} funnel summary`, headers: ['Entered users','Strict completed users','Recorded purchase event','Recorded purchase events','Recorded purchase users','Did not complete','Strict completion rate','Failure events'], rows: [[report.summary.entrants,report.summary.completions,report.summary.recordedPurchaseEvent,report.summary.recordedPurchaseEvents,report.summary.recordedPurchaseUsers,report.summary.abandonedUsers,report.summary.completionRate,report.summary.failureEvents]] },
      { title: `${report.platform} ordered funnel`, headers: ['Step','Active users','Step completion rate','Abandonments','Abandonment rate'], rows: report.steps.map(row => [row.step,row.activeUsers,row.completionRate,row.abandonments,row.abandonmentRate]) },
      { title: `${report.platform} complete event checklist`, headers: ['Event','Users','Events','Status'], rows: report.events.map(row => [row.eventName,row.totalUsers,row.eventCount,report.failures.some(failure => failure.eventName === row.eventName) ? 'Failure' : row.eventCount ? 'Tracked' : 'Not received']) },
      { title: `${report.platform} eSIM QR and activation`, headers: ['Signal','Users','Events','Availability'], rows: [['eSIM activated',report.esim.activated.totalUsers,report.esim.activated.eventCount,'Tracked'],['eSIM activation failed',report.esim.activationFailed.totalUsers,report.esim.activationFailed.eventCount,'Tracked'],['QR generated or displayed',report.esim.qrGenerated.totalUsers,report.esim.qrGenerated.eventCount,report.esim.qrDeliveryInstrumented ? 'Tracked' : 'Not instrumented'],['QR not received or failed',report.esim.qrFailed.totalUsers,report.esim.qrFailed.eventCount,report.esim.qrDeliveryInstrumented ? 'Tracked' : 'Not available']] }
    ]))
    if (view === 'lifecycle' && lifecycle) downloadCsv('ga4-app-lifecycle', [
      { title: 'Summary', headers: ['Installs / first opens','Install users','Android uninstalls','Uninstall users','Net lifecycle events'], rows: [[lifecycle.summary.installs,lifecycle.summary.installUsers,lifecycle.summary.uninstalls,lifecycle.summary.uninstallUsers,lifecycle.summary.netInstalls]] },
      { title: 'Daily lifecycle activity', headers: ['Date','Installs','Install users','Uninstalls','Uninstall users'], rows: lifecycle.trend.map(r => [r.date,r.installs,r.installUsers,r.uninstalls,r.uninstallUsers]) },
      { title: 'Platform detail', headers: ['Platform','Event','Events','Users'], rows: lifecycle.platforms.map(r => [r.platform,r.eventName,r.eventCount,r.totalUsers]) },
      { title: 'App version detail', headers: ['App version','Event','Events','Users'], rows: lifecycle.versions.map(r => [r.appVersion,r.eventName,r.eventCount,r.totalUsers]) }
    ])
    if (view === 'adjust' && adjust) downloadCsv('adjust-performance-and-events', [
      { title: 'Daily installs and usage', headers: ['Date','Installs','Uninstalls','Sessions','DAU','MAU','Reattributions','Clicks','Impressions'], rows: adjust.trend.map(r => [r.day,r.installs,r.uninstalls,r.sessions,r.daus,r.maus,r.reattributions,r.clicks,r.impressions]) },
      { title: 'Apps and platforms by date and version', headers: ['Date','App','App token','App version','OS','Platform','Installs','Uninstalls','Sessions','DAU','MAU'], rows: adjust.apps.map(r => [r.day,r.app,r.app_token,r.app_version && r.app_version !== 'unknown' ? r.app_version : 'Not reported',r.os_name,r.platform,r.installs,r.uninstalls,r.sessions,r.daus,r.maus]) },
      { title: 'Attributed acquisition detail', headers: ['App','OS','Platform','Network','Campaign','Ad group','Creative','Installs','Uninstalls','Sessions','Clicks','Impressions'], rows: adjust.acquisition.map(r => [r.app,r.os_name,r.platform,r.network,r.campaign,r.adgroup || 'Not reported',r.creative || 'Not reported',r.installs,r.uninstalls,r.sessions,r.clicks,r.impressions]) },
      { title: 'Custom events by app and platform', headers: ['App','App token','OS','Platform',...(adjust.eventMetrics || []).map(r => r.label),'Total custom events'], rows: (adjust.eventPlatforms || []).map(r => [r.app,r.app_token,r.os_name,r.platform,...(adjust.eventMetrics || []).map(d => r[d.metric] || 0),r.totalCustomEvents || 0]) }
    ])
    if (view === 'comparison' && lifecycle && adjust) {
      const comparison = buildComparison(lifecycle, adjust)
      downloadCsv('ga4-vs-adjust-installs', [
        { title: 'Summary', headers: ['GA4 first opens','Adjust installs','GA4 Android uninstalls','Adjust uninstalls','Adjust sessions','Adjust DAU','Adjust MAU','Adjust web installs','Difference (Adjust - GA4)','Variance vs GA4'], rows: [[comparison.ga4Installs,comparison.adjustInstalls,comparison.ga4Uninstalls,comparison.adjustUninstalls,comparison.sessions,comparison.daus,comparison.maus,comparison.webInstalls,comparison.difference,comparison.variancePct == null ? '' : comparison.variancePct]] },
        { title: 'Daily comparison', headers: ['Date','GA4 first opens','Adjust installs','Difference (Adjust - GA4)','Variance vs GA4'], rows: comparison.daily.map(r => [r.date,r.ga4Installs,r.adjustInstalls,r.difference,r.variancePct ?? '']) },
        { title: 'Platform comparison', headers: ['Platform','GA4 first opens','GA4 uninstalls','Adjust installs','Adjust uninstalls','Sessions','DAU','MAU','Difference (Adjust - GA4)','Variance vs GA4'], rows: comparison.platforms.map(r => [r.platform,r.ga4Installs,r.ga4Uninstalls,r.adjustInstalls,r.adjustUninstalls,r.sessions,r.daus,r.maus,r.difference,r.variancePct ?? '']) },
        { title: 'GA4 lifecycle by app version', headers: ['App version','Event','Events','Users'], rows: lifecycle.versions.map(r => [r.appVersion,r.eventName,r.eventCount,r.totalUsers]) },
        { title: 'Adjust apps and versions', headers: ['Date','App','App token','App version','OS','Platform','Installs','Uninstalls','Sessions','DAU','MAU'], rows: adjust.apps.map(r => [r.day,r.app,r.app_token,r.app_version,r.os_name,r.platform,r.installs,r.uninstalls,r.sessions,r.daus,r.maus]) },
        { title: 'GA4 events', headers: ['Event','Events','Users','Key events'], rows: (data?.events || []).map(r => [r.eventName,r.eventCount,r.totalUsers,r.keyEvents]) },
        { title: 'GA4 traffic sources', headers: ['Source / medium','Sessions','Active users'], rows: (data?.sources || []).map(r => [r.sessionSourceMedium,r.sessions,r.activeUsers]) },
        { title: 'Adjust event coverage', headers: ['Event','Metric','App events','Web events','Web status'], rows: comparison.eventCoverage.map(r => [r.label,r.metric,r.app,r.web,r.web > 0 ? 'Reported' : 'No events returned']) },
        { title: 'Adjust acquisition detail', headers: ['App','OS','Platform','Network','Campaign','Ad group','Creative','Installs','Uninstalls','Sessions','Clicks','Impressions'], rows: adjust.acquisition.map(r => [r.app,r.os_name,r.platform,r.network,r.campaign,r.adgroup,r.creative,r.installs,r.uninstalls,r.sessions,r.clicks,r.impressions]) }
      ])
    }
    if (view === 'quality' && quality) downloadCsv('engagement-and-app-stability', [
      { title: 'Summary', headers: ['Web sessions','Engaged sessions','Bounce rate','Engagement rate','Average session duration','Crash events','Crash affected users','Crash-free user rate'], rows: [[quality.web.summary.sessions,quality.web.summary.engagedSessions,quality.web.summary.bounceRate,quality.web.summary.engagementRate,quality.web.summary.averageSessionDuration,quality.crashes.summary.crashCount,quality.crashes.summary.crashAffectedUsers,quality.crashes.summary.crashFreeUsersRate]] },
      { title: 'Bounce by page', headers: ['Page','Sessions','Bounce rate','Previous bounce rate','Bounce change pp','Engagement rate','Users','Average session seconds','Views per session','Likely contributors','Recommended actions'], rows: quality.web.pages.map(r => { const a = analyzeBouncePage(r); return [r.pagePath,r.sessions,r.bounceRate,r.previous?.bounceRate ?? '',a.change == null ? '' : a.change * 100,r.engagementRate,r.activeUsers,r.averageSessionDuration,r.screenPageViewsPerSession,a.contributors.join(' | '),a.actions.join(' | ')] }) },
      { title: 'Bounce by device', headers: ['Device','Sessions','Bounce rate','Engagement rate','Users'], rows: quality.web.devices.map(r => [r.deviceCategory,r.sessions,r.bounceRate,r.engagementRate,r.activeUsers]) },
      { title: 'Bounce by country', headers: ['Country','Sessions','Bounce rate','Engagement rate','Users'], rows: quality.web.countries.map(r => [r.country,r.sessions,r.bounceRate,r.engagementRate,r.activeUsers]) },
      { title: 'Bounce by source medium', headers: ['Source / medium','Sessions','Bounce rate','Engagement rate','Users'], rows: quality.web.sources.map(r => [r.sessionSourceMedium,r.sessions,r.bounceRate,r.engagementRate,r.activeUsers]) },
      { title: 'Crash trend', headers: ['Date','Crash events','Affected users','Crash-free user rate'], rows: quality.crashes.trend.map(r => [r.date,r.crashCount,r.crashAffectedUsers,r.crashFreeUsersRate]) },
      { title: 'Crashes by app version', headers: ['App version','Crashes','Affected users'], rows: quality.crashes.versions.map(r => [r.appVersion,r.eventCount,r.totalUsers]) },
      { title: 'Crashes by OS', headers: ['OS','Crashes','Affected users'], rows: quality.crashes.operatingSystems.map(r => [r.operatingSystem,r.eventCount,r.totalUsers]) },
      { title: 'Crashes by device', headers: ['Device model','Crashes','Affected users'], rows: quality.crashes.deviceModels.map(r => [r.deviceModel,r.eventCount,r.totalUsers]) }
    ])
    if (view === 'urls' && inventory) downloadCsv('stc-url-inventory', [
      { title: 'STC URL inventory', headers: ['URL','Page title','Status','Language','Sitemap status','First detected','Sitemap last modified','Google first seen','Page views','Users','Sessions'], rows: inventory.urls.map(r => [r.url,r.pageTitle || '',r.isNew ? 'New' : 'Existing',r.language,r.inSitemap ? 'Listed' : 'GA4 only',r.firstSeen,r.lastModified || '',r.googleFirstSeen || 'Search Console required',r.screenPageViews,r.activeUsers,r.sessions]) }
    ])
    if (view === 'playstore') downloadCsv('app-stores-mystc-kw', [
      { title: 'Store summary', headers: ['Store','App','Identifier','Connection','Source'], rows: [['Google Play','mystc KW',playstore?.packageName || 'com.pixilapps.selfcare',status.playstoreConnected ? 'Connected' : 'Not connected','Developer Reporting API + console snapshot'],['Apple App Store','mystc KW','511293831',status.appstoreConnected ? 'Connected' : 'Not connected','App Store Connect API']] },
      { title: 'Store acquisition coverage', headers: ['Store','Metric','Value','Freshness','Limitation'], rows: [['Google Play','Installs',233000,'Play Console snapshot observed Oct 1, 2026','Daily and version acquisition data are not exposed by the connected Developer Reporting API'],['Google Play','Uninstalls','Not connected','Current connection','Not exposed by the connected API'],['Apple App Store','Downloads','Not connected','Current connection','Analytics Reports ingestion is not configured'],['Apple App Store','Installations and deletions','Not connected','Current connection','Requires an Analytics Report Request and report ingestion']] },
      { title: 'Google Play daily quality', headers: ['Date','Crash rate','7d crash rate','28d crash rate','User-perceived crash rate','ANR rate','7d ANR rate','28d ANR rate','User-perceived ANR rate','Measured users'], rows: (playstore?.crashTrend || []).map(row => { const anrRow = playstore?.anrTrend?.find(item => item.date === row.date) || {}; return [row.date,row.crashRate,row.crashRate7dUserWeighted,row.crashRate28dUserWeighted,row.userPerceivedCrashRate,anrRow.anrRate,anrRow.anrRate7dUserWeighted,anrRow.anrRate28dUserWeighted,anrRow.userPerceivedAnrRate,row.distinctUsers] }) },
      { title: 'Apple app metadata', headers: ['Apple ID','Name','Bundle ID','SKU','Primary locale'], rows: (appStore?.apps || []).filter(row => row.id === '511293831').map(row => [row.id,row.name,row.bundleId,row.sku,row.primaryLocale]) },
      { title: 'Apple release history', headers: ['Version','Platform','State','Release type','Created date','Copyright'], rows: (appStore?.versions || []).map(row => [row.version,row.platform,row.state,row.releaseType,row.createdDate,row.copyright]) },
      { title: 'Apple builds', headers: ['Version','Uploaded','Expires','Expired','Minimum OS','Processing state','Audience'], rows: (appStore?.builds || []).map(row => [row.version,row.uploadedDate,row.expirationDate,row.expired,row.minOsVersion,row.processingState,row.buildAudienceType]) }
    ])
    if (view === 'assistant' && assistantMessages.length) downloadCsv('ask-ak-report', [
      { title: `Ask AK · ${appliedFrom} to ${appliedTo}`, headers: ['Speaker','Report'], rows: assistantMessages.map(message => [message.role === 'assistant' ? 'AK' : 'User', message.text]) }
    ])
  }

  const topEvents = data?.events?.slice(0, 8) || []
  const maxEvent = Math.max(1, ...topEvents.map(item => item.eventCount || 0))
  const selectedPeriodLabel = `${appliedFrom} to ${appliedTo}`
  const selectedScopeLabel = appliedScope === 'all' ? 'All platforms' : appliedScope === 'web' ? 'Web only' : 'App only'
  const datesValid = Boolean(customFrom && customTo && customFrom <= customTo && customTo <= today)

  function applyDates() {
    if (!datesValid) return
    setAppliedFilters({ from: customFrom, to: customTo, scope })
    setRefreshKey(value => value + 1)
  }

  const viewTitles = {
    overview: ['Main overview', 'Sales, engagement, app activity and journey issues in one view.'],
    journey: ['URL journey analyzer', 'Investigate page activity, journeys, traffic sources and language.'],
    'plans-items': ['Plans & items', 'Review all English and Arabic products, offers and vouchers reported in GA4.'],
    'journey-monitoring': ['Journey Monitoring', 'Find failed, cancelled and payment journeys blocking sales.'],
    funnels: ['Funnels', 'Monitor multiple web and app journeys, completion, abandonment and failures.'],
    lifecycle: ['GA4 app lifecycle', 'Monitor GA4 first-open and Android app-remove signals.'],
    adjust: ['Adjust analytics', 'Analyze Adjust attribution, usage, platforms, acquisition and configured events.'],
    comparison: ['GA4 vs Adjust', 'Compare install reporting across GA4 and Adjust.'],
    quality: ['Engagement & app stability', 'Monitor website bounce, engagement and app crash health.'],
    campaigns: ['Campaign & UTM monitoring', 'Monitor production UTM links and GA4 attribution.'],
    urls: ['STC URL inventory', 'Review sitemap URLs, GA4 activity and Google Search visibility.'],
    playstore: ['App Stores', 'Monitor mystc KW across Google Play and Apple App Store Connect.'],
    assistant: ['Ask AK', 'Ask AK questions and generate reports from all connected dashboard data.'],
    settings: ['Settings', 'Review connection status and manage analytics integrations.'],
    'access-control': ['Access control', 'Approve access requests, assign dashboards and reset passwords.']
  }

  if (!auth) return <main className="auth-page"><section className="auth-card"><p>Checking secure session…</p></section></main>
  if (!auth.authenticated) return <LoginScreen onLogin={setAuth}/>

  const show = dashboard => isSuperAdmin || allowed.includes(dashboard)
  async function logout() { await request('/auth/logout', { method:'POST' }); setAuth({ authenticated:false }); window.history.replaceState({}, '', '/') }

  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand-row"><div className="brand"><div className="brand-mark"><Activity size={22} /></div><div><strong>EventScope</strong><span>GA4 intelligence</span></div></div><button className="sidebar-toggle" onClick={toggleSidebar} aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? 'Show full menu' : 'Hide menu labels'} title={sidebarCollapsed ? 'Show full menu' : 'Hide menu labels'}>{sidebarCollapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}</button></div>
      <nav className="side-nav" aria-label="Dashboard views">
        <p>Dashboards</p>
        {show('overview') && <button title="Main overview" className={view === 'overview' ? 'active' : ''} onClick={() => navigateFromSidebar('overview')}><BarChart3 size={18}/><span>Main overview</span></button>}
        {show('journey') && <button title="URL journey analyzer" className={view === 'journey' ? 'active' : ''} onClick={() => navigateFromSidebar('journey')}><Route size={18}/><span>URL journey analyzer</span></button>}
        {show('plans-items') && <button title="Plans & items" className={view === 'plans-items' ? 'active' : ''} onClick={() => navigateFromSidebar('plans-items')}><ShoppingCart size={18}/><span>Plans &amp; items</span></button>}
        {show('journey-monitoring') && <button title="Journey Monitoring" className={view === 'journey-monitoring' ? 'active' : ''} onClick={() => navigateFromSidebar('journey-monitoring')}><Siren size={18}/><span>Journey Monitoring</span></button>}
        {show('funnels') && <button title="Funnels" className={view === 'funnels' ? 'active' : ''} onClick={() => navigateFromSidebar('funnels')}><Route size={18}/><span>Funnels</span></button>}
        {show('lifecycle') && <button title="GA4 app lifecycle" className={view === 'lifecycle' ? 'active' : ''} onClick={() => navigateFromSidebar('lifecycle')}><Smartphone size={18}/><span>GA4 app lifecycle</span></button>}
        {show('adjust') && <button title="Adjust analytics" className={view === 'adjust' ? 'active' : ''} onClick={() => navigateFromSidebar('adjust')}><TrendingUp size={18}/><span>Adjust analytics</span></button>}
        {show('comparison') && <button title="GA4 vs Adjust" className={view === 'comparison' ? 'active' : ''} onClick={() => navigateFromSidebar('comparison')}><GitCompareArrows size={18}/><span>GA4 vs Adjust</span></button>}
        {show('quality') && <button title="Engagement & stability" className={view === 'quality' ? 'active' : ''} onClick={() => navigateFromSidebar('quality')}><Bug size={18}/><span>Engagement & stability</span></button>}
        {show('campaigns') && <button title="Campaigns & UTM" className={view === 'campaigns' ? 'active' : ''} onClick={() => navigateFromSidebar('campaigns')}><TrendingUp size={18}/><span>Campaigns &amp; UTM</span></button>}
        {show('urls') && <button title="STC URL inventory" className={view === 'urls' ? 'active' : ''} onClick={() => navigateFromSidebar('urls')}><Link2 size={18}/><span>STC URL inventory</span></button>}
        {show('playstore') && <button title="App Stores" className={view === 'playstore' ? 'active' : ''} onClick={() => navigateFromSidebar('playstore')}><Smartphone size={18}/><span>App Stores</span></button>}
        {show('assistant') && <button title="Ask AK" className={view === 'assistant' ? 'active' : ''} onClick={() => navigateFromSidebar('assistant')}><Bot size={18}/><span>Ask AK</span></button>}
        {isSuperAdmin && <button title="Settings" className={view === 'settings' ? 'active' : ''} onClick={() => navigateFromSidebar('settings')}><Settings2 size={18}/><span>Settings</span></button>}
        {isSuperAdmin && <button title="Access control" className={view === 'access-control' ? 'active' : ''} onClick={() => navigateFromSidebar('access-control')}><UserCog size={18}/><span>Access control</span></button>}
      </nav>
      <div className="sidebar-bottom">
        <div className="signed-in"><LockKeyhole size={15}/><span>{auth.user.username}<small>{isSuperAdmin ? 'Super Admin' : 'Viewer'}</small></span></div>
        <button className="sidebar-settings" onClick={logout}><LogOut size={18}/><span>Sign out</span></button>
      </div>
    </aside>
    <div className="workspace">
    <header className="topbar">
      <div><strong>{viewTitles[view][0]}</strong><span>{viewTitles[view][1]}</span></div>
      {!['access-control','settings'].includes(view) && <button className="secondary-button" onClick={exportCurrentDashboard} disabled={!status.connected || loading}><Download size={17}/>Export current dashboard</button>}
    </header>
    <main>
      <section className="page-heading">
        <div><p className="eyebrow">Analytics operations</p><h1>{viewTitles[view][0]}</h1><p>{viewTitles[view][1]}</p></div>
        {!['access-control','settings','playstore'].includes(view) && <div className="heading-actions">
          <label className="scope-filter">Platform<select aria-label="Platform scope" value={scope} onChange={event => setScope(event.target.value)} disabled={loading}><option value="all">All</option><option value="web">Web</option><option value="app">App</option></select></label>
          <div className="custom-dates"><label>From<input aria-label="From date" type="date" value={customFrom} max={customTo || today} onChange={event => setCustomFrom(event.target.value)}/></label><label>To<input aria-label="To date" type="date" value={customTo} min={customFrom} max={today} onChange={event => setCustomTo(event.target.value)}/></label></div>
          <button className="primary-button apply-dates" onClick={applyDates} disabled={!status.connected || loading || !datesValid}>{loading ? <RefreshCw size={17} className="spin"/> : <RefreshCw size={17}/>}Apply dates</button>
        </div>}
      </section>

      {!status.connected && <section className="connect-banner">
        <div className="connect-visual"><Radio size={30} /></div>
        <div><p className="eyebrow">Connection required</p><h2>Bring your website events into one clear view.</h2><p>Connect a GA4 Property ID and service account to activate realtime monitoring, historical trends, traffic sources, pages, devices, and event exports.</p></div>
        <button className="primary-button" onClick={() => setSettingsOpen(true)}>Connect Google Analytics</button>
      </section>}

      {error && <div className="error-banner"><AlertTriangle size={18} /><div><strong>Analytics refresh failed</strong><span>{error}</span></div><button onClick={() => loadData(true)}>Try again</button></div>}

      {view === 'access-control' ? <AccessControlView/> : view === 'settings' ? <SettingsDashboard status={status} onConfigure={() => setSettingsOpen(true)}/> : view === 'overview' ? <MainOverviewView data={overview} onOpen={openOverviewDetail} /> : view === 'legacy-overview' ? <><section className="metric-grid">
        <Metric icon={Users} label="Active users" value={data?.summary?.activeUsers} detail={status.connected ? 'Selected period' : 'Waiting for connection'} />
        <Metric icon={MousePointer2} label="Events" value={data?.summary?.eventCount} detail={status.connected ? 'All reported events' : 'Waiting for connection'} tone="blue" />
        <Metric icon={Eye} label="Page views" value={data?.summary?.screenPageViews} detail={status.connected ? 'Pages and screens' : 'Waiting for connection'} tone="purple" />
        <Metric icon={Activity} label="Key events" value={data?.summary?.keyEvents} detail={status.connected ? 'Marked in GA4' : 'Waiting for connection'} tone="amber" />
      </section>

      <section className="dashboard-grid">
        <Panel className="trend-panel" title="Activity over time" subtitle={data ? `${selectedPeriodLabel} · ${selectedScopeLabel} · ${data.property.timeZone || 'GA4 timezone'}` : 'Historical event and user movement'}>
          {data?.trend?.length ? <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}><defs><linearGradient id="eventFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#24d17e" stopOpacity=".34"/><stop offset="100%" stopColor="#24d17e" stopOpacity="0"/></linearGradient></defs><CartesianGrid stroke="#e7eee9" vertical={false}/><XAxis dataKey="date" tickFormatter={dateLabel} tickLine={false} axisLine={false} minTickGap={28}/><YAxis tickLine={false} axisLine={false}/><Tooltip labelFormatter={dateLabel}/><Area type="monotone" dataKey="eventCount" name="Events" stroke="#10b768" strokeWidth={2.5} fill="url(#eventFill)"/><Area type="monotone" dataKey="activeUsers" name="Active users" stroke="#38bdf8" strokeWidth={2} fill="transparent"/></AreaChart></ResponsiveContainer></div> : <EmptyPanel title="No historical data yet" copy="Connect GA4 to load the selected reporting period." />}
        </Panel>

        <Panel className="live-panel" title="Live now" subtitle="Last 30 minutes · refresh manually" action={<span className="live-badge"><RefreshCw size={13}/>Auto-refresh paused</span>}>
          <div className="live-total"><strong>{number(realtime?.summary?.activeUsers)}</strong><span>active users</span></div>
          <div className="live-stats"><div><span>Events</span><strong>{number(realtime?.summary?.eventCount)}</strong></div><div><span>Views</span><strong>{number(realtime?.summary?.screenPageViews)}</strong></div></div>
          <div className="live-list"><h3>Top live events</h3>{realtime?.events?.slice(0, 5).map(item => <div key={item.eventName}><span>{item.eventName}</span><strong>{number(item.eventCount)}</strong></div>)}{!realtime?.events?.length && <p>No realtime events reported.</p>}</div>
        </Panel>

        <Panel className="events-panel" title="Top events" subtitle="Highest-volume interactions in the selected period">
          {topEvents.length ? <div className="bar-list">{topEvents.map((item, index) => <div className="bar-row" key={item.eventName}><div><span>{item.eventName}</span><strong>{number(item.eventCount)}</strong></div><div className="bar-track"><i style={{ width: `${item.eventCount / maxEvent * 100}%`, background: palette[index % palette.length] }} /></div></div>)}</div> : <EmptyPanel title="No events available" copy="GA4 event names and volumes will appear here." />}
        </Panel>

        <Panel className="device-panel" title="Audience by device" subtitle="Active users by device category">
          {data?.devices?.length ? <><div className="donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.devices} dataKey="activeUsers" nameKey="deviceCategory" innerRadius={52} outerRadius={76} paddingAngle={3}>{data.devices.map((item, index) => <Cell key={item.deviceCategory} fill={palette[index % palette.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div><div className="legend-list">{data.devices.map((item, index) => <div key={item.deviceCategory}><i style={{ background: palette[index % palette.length] }} /><span>{item.deviceCategory}</span><strong>{number(item.activeUsers)}</strong></div>)}</div></> : <EmptyPanel title="No device data" copy="Device mix will appear after connection." />}
        </Panel>

        <Panel className="sources-panel" title="Traffic sources" subtitle="Sessions by source and medium">
          {data?.sources?.length ? <div className="compact-list">{data.sources.slice(0, 8).map((item, index) => <div key={item.sessionSourceMedium}><span className="rank">{String(index + 1).padStart(2, '0')}</span><span>{item.sessionSourceMedium}</span><strong>{number(item.sessions)}</strong></div>)}</div> : <EmptyPanel title="No source data" copy="Acquisition channels will appear after connection." />}
        </Panel>

        <Panel className="country-panel" title="Top countries" subtitle="Active users by country">
          {data?.countries?.length ? <div className="country-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.countries.slice(0, 8)} layout="vertical" margin={{ left: 4, right: 16 }}><CartesianGrid stroke="#e7eee9" horizontal={false}/><XAxis type="number" hide/><YAxis type="category" dataKey="country" tickLine={false} axisLine={false} width={90}/><Tooltip/><Bar dataKey="activeUsers" name="Active users" fill="#24d17e" radius={[0, 6, 6, 0]}/></BarChart></ResponsiveContainer></div> : <EmptyPanel title="No location data" copy="Country-level reporting will appear after connection." />}
        </Panel>

        <Panel className="table-panel" title="All reported events" subtitle="Search and inspect every event returned for this period" action={<button className="secondary-button compact" onClick={exportEvents} disabled={!data?.events?.length}><Download size={16}/>Export CSV</button>}>
          {data?.events ? <EventsTable rows={data.events} /> : <EmptyPanel title="No event catalog yet" copy="Connect GA4 to populate the full event list." />}
        </Panel>
      </section></> : view === 'journey' ? <JourneyView data={journey} requestedUrl={pageUrl} onAnalyze={url => analyzeUrl(url, 'journey')} loading={loading} /> : view === 'plans-items' ? <PlansItemsView data={products} /> : view === 'journey-monitoring' ? <JourneyMonitoringView data={journeyMonitoring}/> : view === 'funnels' ? <FunnelsView data={funnel} journey={funnelJourney} onJourneyChange={setFunnelJourney}/> : view === 'lifecycle' ? <AppLifecycleView data={lifecycle} /> : view === 'adjust' ? <AdjustAnalyticsView data={adjust} connected={status.adjustConnected} /> : view === 'comparison' ? <ComparisonView lifecycle={lifecycle} adjust={adjust} ga4={data} connected={status.adjustConnected} /> : view === 'quality' ? <QualityView data={quality} /> : view === 'campaigns' ? <CampaignsView data={campaigns} /> : view === 'urls' ? <UrlInventoryView data={inventory} /> : view === 'playstore' ? <PlaystoreView data={playstore} appStoreData={appStore} connected={status.playstoreConnected} appStoreConnected={status.appstoreConnected} /> : <AnalyticsAssistant context={{ data, overview, campaigns, journey, journeyMonitoring, products, funnel, lifecycle, adjust, quality, inventory, from: appliedFrom, to: appliedTo }} messages={assistantMessages} setMessages={setAssistantMessages} />}

      <footer><div><ShieldCheck size={16}/>Credentials stay encrypted on this server.</div><div><Clock3 size={16}/>Last refreshed: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'Not yet refreshed'}</div><div><Globe2 size={16}/>Property: {status.propertyId || 'Not connected'}</div></footer>
    </main>
    </div>
    <AkFloatingAssistant context={{ data, overview, campaigns, journey, journeyMonitoring, products, funnel, lifecycle, adjust, quality, inventory, from: appliedFrom, to: appliedTo }} messages={assistantMessages} setMessages={setAssistantMessages}/>
    {settingsOpen && <SettingsModal status={status} onClose={() => setSettingsOpen(false)} onSaved={saved} />}
  </div>
}

export default App
