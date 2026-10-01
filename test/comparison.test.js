import test from 'node:test'
import assert from 'node:assert/strict'
import { buildComparison } from '../src/comparison.js'

test('compares GA4 first opens with Adjust installs by date and platform', () => {
  const result = buildComparison(
    { summary: { installs: 100, uninstalls: 12 }, trend: [{ date: '20260901', installs: 60 }], platforms: [{ platform: 'ANDROID', eventName: 'first_open', eventCount: 100 }, { platform: 'ANDROID', eventName: 'app_remove', eventCount: 12 }] },
    { summary: { installs: 80, uninstalls: 8, sessions: 200, daus: 50, maus: 70 }, trend: [{ day: '2026-09-01', installs: 50 }, { day: '2026-09-02', installs: 30 }], apps: [{ os_name: 'android', platform: 'mobile_app', installs: '80', uninstalls: '8', sessions: '200', daus: '50', maus: '70' }, { os_name: 'unknown', platform: 'web', installs: '4' }] }
  )
  assert.deepEqual([result.difference, result.variancePct], [-20, -0.2])
  assert.deepEqual(result.daily.map(row => [row.date, row.difference]), [['2026-09-01', -10], ['2026-09-02', 30]])
  assert.deepEqual(result.platforms[0], { platform: 'android', ga4Installs: 100, ga4Uninstalls: 12, adjustInstalls: 80, adjustUninstalls: 8, sessions: 200, daus: 50, maus: 70, difference: -20, variancePct: -0.2 })
  assert.equal(result.webInstalls, 4)
})

test('flags web traffic when Adjust custom commerce events are zero', () => {
  const result = buildComparison({}, {
    scope: 'all',
    summary: {},
    platforms: [
      { platform: 'mobile_app', os_name: 'android', installs: 12, sessions: 80 },
      { platform: 'web', os_name: 'android', installs: 4, sessions: 20 }
    ],
    eventCoverageAvailable: true,
    eventMetrics: [{ metric: 'purchase_prepaid_events', label: 'Prepaid purchases' }],
    eventPlatforms: [
      { platform: 'mobile_app', os_name: 'android', purchase_prepaid_events: 7 },
      { platform: 'web', os_name: 'android', purchase_prepaid_events: 0 }
    ]
  })
  assert.deepEqual(result.eventTotals, { app: 7, web: 0 })
  assert.equal(result.activityByGroup.web.sessions, 20)
  assert.match(result.webCoverageStatus, /Web traffic is present/)
})
