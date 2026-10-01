import crypto from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REPORTING_API = 'https://playdeveloperreporting.googleapis.com/v1beta1'

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')

export function validatePlayServiceAccount(account) {
  if (!account?.client_email || !account?.private_key) throw new Error('The Play service account JSON is missing client_email or private_key.')
}

async function accessToken(account) {
  validatePlayServiceAccount(account)
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/playdeveloperreporting',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  })}`
  const assertion = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url')}`
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'Google could not authorize the Play service account.')
  return payload.access_token
}

async function searchApps(account) {
  const token = await accessToken(account)
  const response = await fetch(`${REPORTING_API}/apps:search?pageSize=100`, { headers: { Authorization: `Bearer ${token}` } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error?.message || 'Google Play Developer Reporting API connection failed.')
  return payload.apps || []
}

export async function testPlaystoreConnection({ serviceAccount, packageName }) {
  const apps = await searchApps(serviceAccount)
  const normalized = String(packageName || '').trim()
  if (normalized && !apps.some(app => app.packageName === normalized || app.name === `apps/${normalized}`)) {
    throw new Error(`The service account cannot access ${normalized}. Add it in Play Console Users and permissions with app visibility.`)
  }
  return { apps, packageName: normalized || apps[0]?.packageName || apps[0]?.name?.replace('apps/', '') || '' }
}

export async function playstoreDashboard(settings) {
  const apps = await searchApps(settings.playServiceAccount)
  const token = await accessToken(settings.playServiceAccount)
  const end = new Date(); end.setUTCHours(0,0,0,0); end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 28)
  const time = date => ({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), timeZone: { id: 'America/Los_Angeles' } })
  const query = async (set, metrics) => {
    const response = await fetch(`${REPORTING_API}/apps/${settings.playPackageName}/${set}:query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ timelineSpec: { aggregationPeriod: 'DAILY', startTime: time(start), endTime: time(end) }, metrics, pageSize: 1000 }) })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error?.message || `Google Play ${set} query failed.`)
    return payload.rows || []
  }
  const value = metric => Number(metric?.decimalValue?.value ?? metric?.decimalValue ?? metric?.int64Value ?? 0)
  const rows = (items, names) => items.map(row => ({ date: `${row.startTime?.year}-${String(row.startTime?.month).padStart(2,'0')}-${String(row.startTime?.day).padStart(2,'0')}`, ...Object.fromEntries(names.map(name => [name, value(row.metrics?.find(metric => metric.metric === name))])) }))
  const [crashRows, anrRows] = await Promise.all([
    query('crashRateMetricSet', ['crashRate','crashRate7dUserWeighted','crashRate28dUserWeighted','userPerceivedCrashRate','distinctUsers']),
    query('anrRateMetricSet', ['anrRate','anrRate7dUserWeighted','anrRate28dUserWeighted','userPerceivedAnrRate','distinctUsers'])
  ])
  return {
    connected: true,
    generatedAt: new Date().toISOString(),
    packageName: settings.playPackageName,
    period: { days: 28, startDate: start.toISOString().slice(0,10), endDate: new Date(end.getTime()-86400000).toISOString().slice(0,10) },
    apps: apps.map(app => ({ name: app.displayName || app.packageName || app.name, packageName: app.packageName || app.name?.replace('apps/', '') })),
    crashTrend: rows(crashRows, ['crashRate','crashRate7dUserWeighted','crashRate28dUserWeighted','userPerceivedCrashRate','distinctUsers']),
    anrTrend: rows(anrRows, ['anrRate','anrRate7dUserWeighted','anrRate28dUserWeighted','userPerceivedAnrRate','distinctUsers'])
  }
}

