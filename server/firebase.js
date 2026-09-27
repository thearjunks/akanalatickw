import crypto from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const CRASHLYTICS_API = 'https://firebasecrashlytics.googleapis.com/v1alpha'
const FIREBASE_API = 'https://firebase.googleapis.com/v1beta1'

const base64url = value => Buffer.from(value).toString('base64url')

async function accessToken(account) {
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }))}`
  const assertion = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url')}`
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'Firebase authentication failed.')
  return payload.access_token
}

async function get(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message || `Firebase request failed (${response.status}).`)
  return payload
}

export async function testCrashlyticsConnection(serviceAccount) {
  const projectId = serviceAccount.project_id
  if (!projectId) throw new Error('The service account JSON has no project_id.')
  const token = await accessToken(serviceAccount)
  const [android, ios] = await Promise.all([
    get(`${FIREBASE_API}/projects/${projectId}/androidApps?pageSize=100`, token),
    get(`${FIREBASE_API}/projects/${projectId}/iosApps?pageSize=100`, token)
  ])
  const apps = [...(android.apps || []), ...(ios.apps || [])]
  const results = await Promise.allSettled(apps.map(async app => ({ appId: app.appId, displayName: app.displayName || app.packageName || app.bundleId || app.appId, platform: app.platform || (app.packageName ? 'ANDROID' : 'IOS'), reports: (await get(`${CRASHLYTICS_API}/projects/${projectId}/apps/${encodeURIComponent(app.appId)}/reports`, token)).reports || [] })))
  return { projectId, apps: results.filter(result => result.status === 'fulfilled').map(result => result.value), errors: results.filter(result => result.status === 'rejected').map(result => result.reason.message) }
}
