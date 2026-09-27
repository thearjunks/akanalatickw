import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeBouncePage } from '../src/bounce-analysis.js'

test('explains a material bounce increase using measured page signals', () => {
  const result = analyzeBouncePage({
    sessions: 180, bounceRate: .61, averageSessionDuration: 9, screenPageViewsPerSession: 1.1,
    previous: { sessions: 100, bounceRate: .45 }
  })
  assert.equal(result.status, 'Increase detected')
  assert.ok(Math.abs(result.change - .16) < Number.EPSILON * 2)
  assert.ok(result.contributors.length >= 3)
  assert.ok(result.actions.length >= 3)
})
