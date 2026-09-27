import test from 'node:test'
import assert from 'node:assert/strict'
import { DASHBOARDS, hashPassword, verifyPassword } from '../server/auth.js'

test('hashes passwords with a random salt and verifies without exposing plaintext', () => {
  const first = hashPassword('AK1AK')
  const second = hashPassword('AK1AK')
  assert.notEqual(first, second)
  assert.equal(first.includes('AK1AK'), false)
  assert.equal(verifyPassword('AK1AK', first), true)
  assert.equal(verifyPassword('wrong', first), false)
  assert.ok(DASHBOARDS.includes('campaigns'))
})
