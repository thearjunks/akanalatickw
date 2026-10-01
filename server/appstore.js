import crypto from 'node:crypto'

const API = 'https://api.appstoreconnect.apple.com/v1'
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')

export function validateAppStoreCredentials(credentials) {
  if (!credentials?.issuerId || !credentials?.keyId || !credentials?.privateKey) throw new Error('App Store Connect requires an Issuer ID, Key ID and private API key.')
}

function token(credentials) {
  validateAppStoreCredentials(credentials)
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${encode({ alg: 'ES256', kid: credentials.keyId, typ: 'JWT' })}.${encode({ iss: credentials.issuerId, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: credentials.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${unsigned}.${signature}`
}

export async function appStoreDashboard(credentials) {
  const jwt = token(credentials)
  const get = async path => {
    const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${jwt}` } })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.errors?.[0]?.detail || `App Store Connect request failed: ${path}`)
    return payload.data || []
  }
  const appsRaw = await get('/apps?limit=200')
  const mystcId = '511293831'
  const [versionsResult, buildsResult] = await Promise.allSettled([get(`/apps/${mystcId}/appStoreVersions?limit=200&include=build`), get(`/builds?filter[app]=${mystcId}&limit=50&sort=-uploadedDate`)])
  const versionsRaw = versionsResult.status === 'fulfilled' ? versionsResult.value : []
  const buildsRaw = buildsResult.status === 'fulfilled' ? buildsResult.value : []
  return {
    connected: true,
    generatedAt: new Date().toISOString(),
    apps: appsRaw.map(row => ({ id: row.id, name: row.attributes?.name || 'Unnamed app', bundleId: row.attributes?.bundleId || '', sku: row.attributes?.sku || '', primaryLocale: row.attributes?.primaryLocale || '' })),
    versions: versionsRaw.map(row => ({ id: row.id, version: row.attributes?.versionString || '', platform: row.attributes?.platform || '', state: row.attributes?.appStoreState || '', releaseType: row.attributes?.releaseType || '', createdDate: row.attributes?.createdDate || '', copyright: row.attributes?.copyright || '', downloadable: row.attributes?.downloadable ?? null })),
    builds: buildsRaw.map(row => ({ id: row.id, version: row.attributes?.version || '', uploadedDate: row.attributes?.uploadedDate || '', expirationDate: row.attributes?.expirationDate || '', expired: row.attributes?.expired ?? null, minOsVersion: row.attributes?.minOsVersion || '', processingState: row.attributes?.processingState || '', buildAudienceType: row.attributes?.buildAudienceType || '' })),
    coverage: { apps: true, versions: versionsResult.status === 'fulfilled', builds: buildsResult.status === 'fulfilled', versionsError: versionsResult.status === 'rejected' ? versionsResult.reason.message : '', buildsError: buildsResult.status === 'rejected' ? buildsResult.reason.message : '' }
  }
}

export async function testAppStoreConnection(credentials) {
  const report = await appStoreDashboard(credentials)
  return { appCount: report.apps.length, apps: report.apps }
}

