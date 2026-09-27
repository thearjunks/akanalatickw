import { buildComparison } from './comparison.js'

const n = value => new Intl.NumberFormat('en').format(value || 0)
const top = (rows, value, label, limit = 5) => (rows || []).slice(0, limit).map(row => `${row[label] || '(not set)'}: ${n(row[value])}`).join('; ')

export function answerAnalyticsQuestion(question, context) {
  const q = question.toLowerCase()
  const { data, journey, lifecycle, adjust, from, to } = context
  const period = `${from} to ${to}`
  if (!question.trim()) return 'Please enter a question about the available analytics data.'

  if (/compare|comparison|difference|variance|gap/.test(q) && /adjust|ga4|install/.test(q)) {
    if (!lifecycle || !adjust) return 'The GA4 and Adjust datasets are not both available yet.'
    const c = buildComparison(lifecycle, adjust)
    const variance = c.variancePct == null ? 'unavailable' : `${(c.variancePct * 100).toFixed(1)}%`
    return `For ${period}, GA4 reported ${n(c.ga4Installs)} first opens and Adjust reported ${n(c.adjustInstalls)} attributed installs. Adjust minus GA4 is ${n(c.difference)}, a ${variance} variance relative to GA4.`
  }
  if (/traffic|source|medium/.test(q)) {
    const rows = /page|url|journey/.test(q) ? journey?.acquisition : data?.sources
    if (!rows?.length) return 'No traffic-source rows are available for this reporting period.'
    const label = rows[0].sessionCampaignName === undefined ? 'sessionSourceMedium' : 'sessionSourceMedium'
    return `Top traffic sources for ${period}: ${top(rows, 'sessions', label)}.`
  }
  if (/campaign/.test(q)) {
    if (journey?.acquisition?.length) return `Top campaigns for ${journey.page.url}: ${top(journey.acquisition, 'sessions', 'sessionCampaignName')}.`
    if (adjust?.acquisition?.length) return `Top Adjust campaigns: ${top(adjust.acquisition, 'installs', 'campaign')}.`
    return 'No campaign rows are available for this reporting period.'
  }
  if (/language|english|arabic|\ben\b|\bar\b/.test(q)) {
    if (!journey?.browserLanguages?.length) return 'No browser-language data is available for the selected URL.'
    return `Browser languages for ${journey.page.url}: ${top(journey.browserLanguages, 'activeUsers', 'language')}. The selected route language is ${journey.language.toUpperCase()}.`
  }
  if (/journey|funnel|purchase|fail|cancel|conversion/.test(q)) {
    if (!journey) return 'The URL journey data is not available yet.'
    const success = journey.successFunnel?.at(-1)?.activeUsers || 0
    const failed = journey.failureFunnel?.at(-1)?.activeUsers || 0
    return `For ${journey.page.url} during ${period}: ${n(journey.summary.screenPageViews)} page views, ${n(journey.summary.activeUsers)} active users, ${n(journey.summary.sessions)} sessions, ${n(success)} completed purchase journeys, and ${n(failed)} failed or cancelled journeys.`
  }
  if (/uninstall|remove/.test(q)) {
    if (!lifecycle) return 'GA4 app lifecycle data is not available yet.'
    return `GA4 reported ${n(lifecycle.summary.uninstalls)} Android app_remove events from ${n(lifecycle.summary.uninstallUsers)} users for ${period}. iOS uninstall reporting is not available from this GA4 signal.`
  }
  if (/install|download|first open|first_open/.test(q)) {
    if (/adjust/.test(q)) return adjust ? `Adjust reported ${n(adjust.summary.installs)} attributed installs and ${n(adjust.summary.reattributions)} reattributions for ${period}.` : 'Adjust install data is not available yet.'
    if (!lifecycle) return 'GA4 app lifecycle data is not available yet.'
    return `GA4 reported ${n(lifecycle.summary.installs)} first_open events from ${n(lifecycle.summary.installUsers)} users for ${period}. Store downloads are not available from GA4.`
  }
  if (/event|user|view|session|overview|summary|report/.test(q)) {
    if (!data) return 'GA4 property data is not available yet.'
    return `GA4 summary for ${period}: ${n(data.summary.activeUsers)} active users, ${n(data.summary.eventCount)} events, ${n(data.summary.screenPageViews)} page views, and ${n(data.summary.keyEvents)} key events. Top events: ${top(data.events, 'eventCount', 'eventName')}.`
  }
  return 'I could not match that question to the loaded reports. Try asking about GA4 users or events, traffic sources, campaigns, URL journeys, languages, installs, uninstalls, Adjust, or the GA4-vs-Adjust variance.'
}
