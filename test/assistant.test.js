import test from 'node:test'
import assert from 'node:assert/strict'
import { answerAnalyticsQuestion } from '../src/assistant.js'

test('answers a GA4 and Adjust comparison from loaded data', () => {
  const answer = answerAnalyticsQuestion('Compare GA4 and Adjust installs', {
    from: '2026-09-01', to: '2026-09-07',
    lifecycle: { summary: { installs: 100 }, trend: [], platforms: [] },
    adjust: { summary: { installs: 80 }, trend: [], apps: [] }
  })
  assert.match(answer, /GA4 reported 100 first opens/)
  assert.match(answer, /Adjust reported 80 attributed installs/)
  assert.match(answer, /-20\.0% variance/)
})
