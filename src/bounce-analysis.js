export function analyzeBouncePage(row) {
  const previous = row.previous
  if (!previous?.sessions) return {
    status: 'No comparison baseline',
    change: null,
    contributors: ['This page had no measurable sessions in the preceding comparison period.'],
    actions: ['Keep monitoring until there is enough prior-period traffic for a reliable comparison.']
  }

  const change = (row.bounceRate || 0) - (previous.bounceRate || 0)
  const contributors = []
  const actions = []
  if (change <= .02) {
    contributors.push(change < -.02 ? 'Bounce rate improved versus the preceding period.' : 'Bounce rate is stable within 2 percentage points of the preceding period.')
    actions.push('No urgent change is indicated; continue monitoring the page and its conversion events.')
  } else {
    if ((row.sessions || 0) > previous.sessions * 1.5) {
      contributors.push('Sessions grew by more than 50%, so a different traffic mix may be contributing to the increase.')
      actions.push('Compare source/medium, campaigns, device and country for this page to find the traffic segment with the largest change.')
    }
    if ((row.averageSessionDuration || 0) < 15) {
      contributors.push('Average session duration is under 15 seconds, which can indicate slow loading or a mismatch between visitor intent and the first screen.')
      actions.push('Check page speed and make the headline, offer and primary call-to-action immediately match the campaign or search promise.')
    }
    if ((row.screenPageViewsPerSession || 0) < 1.3) {
      contributors.push('Views per session are low, suggesting visitors often do not continue to another page or step.')
      actions.push('Strengthen the next-step button, internal links and journey tracking so visitors have a clear path forward.')
    }
    if (!contributors.length) {
      contributors.push('Bounce rate increased, but the available aggregate GA4 signals do not isolate one clear contributor.')
      actions.push('Segment this page by source/medium, device and country, and review page speed and journey-event failures before changing content.')
    }
  }
  return { status: change > .02 ? 'Increase detected' : change < -.02 ? 'Improved' : 'Stable', change, contributors, actions }
}
