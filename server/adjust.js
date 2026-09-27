const REPORT_URL = 'https://automate.adjust.com/reports-service/report'

async function report(token, parameters) {
  const url = new URL(REPORT_URL)
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (response.status === 204) return { rows: [], totals: {}, warnings: [] }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || payload?.message || `Adjust API request failed (${response.status}).`)
  return payload
}

export async function testAdjustConnection(token) {
  if (!String(token || '').trim()) {
    const error = new Error('Adjust API token is required.')
    error.status = 400
    throw error
  }
  const result = await report(token.trim(), {
    date_period: 'yesterday', dimensions: 'app,app_token', metrics: 'installs'
  })
  return { apps: result.rows || [] }
}

export async function adjustInstallDashboard(token, startDate, endDate, requestedScope = 'all') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '') || startDate > endDate) {
    const error = new Error('Enter a valid Adjust From–To date range.')
    error.status = 400
    throw error
  }
  const date_period = `${startDate}:${endDate}`
  const metrics = 'installs,reattributions,attribution_clicks,attribution_impressions,sessions,maus,daus,uninstalls'
  const scope = ['web', 'app'].includes(String(requestedScope || '').toLowerCase()) ? String(requestedScope).toLowerCase() : 'all'
  const [daily, apps, platforms, acquisition] = await Promise.all([
    report(token, { date_period, dimensions: 'day,os_name,platform', metrics }),
    report(token, { date_period, dimensions: 'day,app,app_token,app_version,os_name,platform', metrics }),
    report(token, { date_period, dimensions: 'app,app_token,os_name,platform', metrics }),
    report(token, { date_period, dimensions: 'app,os_name,platform,network,campaign,adgroup,creative', metrics: 'installs,uninstalls,sessions,attribution_clicks,attribution_impressions', sort: '-installs' })
  ])
  const normalize = row => {
    const result = { ...row }
    for (const key of ['installs','uninstalls','sessions','daus','maus','reattributions','attribution_clicks','attribution_impressions']) result[key] = Number(row[key] || 0)
    return { ...result, clicks: result.attribution_clicks, impressions: result.attribution_impressions }
  }
  const matchesScope = row => scope === 'all' || (scope === 'web' ? String(row.platform || '').toLowerCase().includes('web') : ['android', 'ios'].includes(String(row.os_name || '').toLowerCase()) || String(row.platform || '').toLowerCase().includes('app'))
  const sumMetrics = rows => rows.reduce((sum, row) => {
    for (const key of ['installs','uninstalls','sessions','daus','maus','reattributions','clicks','impressions']) sum[key] = (sum[key] || 0) + (row[key] || 0)
    return sum
  }, {})
  const dailyRows = (daily.rows || []).map(normalize).filter(matchesScope)
  const trendByDay = new Map()
  for (const row of dailyRows) trendByDay.set(row.day, { day: row.day, ...sumMetrics([...(trendByDay.get(row.day)?._rows || []), row]), _rows: [...(trendByDay.get(row.day)?._rows || []), row] })
  const trend = [...trendByDay.values()].map(({ _rows, ...row }) => row).sort((a, b) => a.day.localeCompare(b.day))
  const appRows = (apps.rows || []).map(normalize).filter(matchesScope)
  const platformRows = (platforms.rows || []).map(normalize).filter(matchesScope)
  const acquisitionRows = (acquisition.rows || []).map(normalize).filter(matchesScope)
  return {
    generatedAt: new Date().toISOString(),
    period: { startDate, endDate },
    scope,
    summary: scope === 'all' ? normalize(daily.totals || {}) : sumMetrics(dailyRows),
    trend,
    apps: appRows,
    platforms: platformRows,
    acquisition: acquisitionRows,
    warnings: [...(daily.warnings || []), ...(apps.warnings || []), ...(platforms.warnings || []), ...(acquisition.warnings || [])]
  }
}
