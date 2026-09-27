function variance(adjust, ga4) {
  return ga4 ? (adjust - ga4) / ga4 : null
}

export function buildComparison(lifecycle, adjust) {
  const ga4ByDay = new Map((lifecycle?.trend || []).map(row => [
    `${row.date.slice(0, 4)}-${row.date.slice(4, 6)}-${row.date.slice(6, 8)}`,
    row.installs || 0
  ]))
  const adjustByDay = new Map((adjust?.trend || []).map(row => [row.day, row.installs || 0]))
  const daily = [...new Set([...ga4ByDay.keys(), ...adjustByDay.keys()])].sort().map(date => {
    const ga4Installs = ga4ByDay.get(date) || 0
    const adjustInstalls = adjustByDay.get(date) || 0
    return { date, ga4Installs, adjustInstalls, difference: adjustInstalls - ga4Installs, variancePct: variance(adjustInstalls, ga4Installs) }
  })

  const ga4Platforms = new Map()
  for (const row of lifecycle?.platforms || []) if (['first_open', 'app_remove'].includes(row.eventName)) {
    const key = (row.platform || '(not set)').toLowerCase()
    const item = ga4Platforms.get(key) || { installs: 0, uninstalls: 0 }
    item[row.eventName === 'first_open' ? 'installs' : 'uninstalls'] += Number(row.eventCount || 0)
    ga4Platforms.set(key, item)
  }
  const adjustPlatforms = new Map()
  for (const row of adjust?.platforms || adjust?.apps || []) {
    const os = (row.os_name || '').toLowerCase()
    const platform = (row.platform || '').toLowerCase()
    const key = ['ios', 'android'].includes(os) ? os : platform === 'web' ? 'web' : os || platform || '(not set)'
    const item = adjustPlatforms.get(key) || { installs: 0, uninstalls: 0, sessions: 0, daus: 0, maus: 0 }
    for (const metric of Object.keys(item)) item[metric] += Number(row[metric] || 0)
    adjustPlatforms.set(key, item)
  }
  const platforms = [...new Set([...ga4Platforms.keys(), ...adjustPlatforms.keys()])].sort().map(platform => {
    const ga4 = ga4Platforms.get(platform) || { installs: 0, uninstalls: 0 }
    const ga4Installs = ga4.installs
    const metrics = adjustPlatforms.get(platform) || { installs: 0, uninstalls: 0, sessions: 0, daus: 0, maus: 0 }
    return { platform, ga4Installs, ga4Uninstalls: ga4.uninstalls, adjustInstalls: metrics.installs, adjustUninstalls: metrics.uninstalls, sessions: metrics.sessions, daus: metrics.daus, maus: metrics.maus, difference: metrics.installs - ga4Installs, variancePct: variance(metrics.installs, ga4Installs) }
  })

  const ga4Installs = lifecycle?.summary?.installs || 0
  const adjustInstalls = adjust?.summary?.installs || 0
  return { ga4Installs, adjustInstalls, ga4Uninstalls: lifecycle?.summary?.uninstalls || 0, adjustUninstalls: adjust?.summary?.uninstalls || 0, sessions: adjust?.summary?.sessions || 0, daus: adjust?.summary?.daus || 0, maus: adjust?.summary?.maus || 0, webInstalls: platforms.find(row => row.platform === 'web')?.adjustInstalls || 0, difference: adjustInstalls - ga4Installs, variancePct: variance(adjustInstalls, ga4Installs), daily, platforms }
}
