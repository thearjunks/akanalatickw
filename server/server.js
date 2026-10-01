import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { createAuth } from './auth.js'
import { hasSettings, loadCampaignRegistry, loadSettings, loadUrlHistory, saveCampaignRegistry, saveSettings, saveUrlHistory } from './crypto-store.js'
import { adjustInstallDashboard, testAdjustConnection } from './adjust.js'
import { playstoreDashboard, testPlaystoreConnection, validatePlayServiceAccount } from './playstore.js'
import { appStoreDashboard, testAppStoreConnection, validateAppStoreCredentials } from './appstore.js'
import {
  appLifecycleDashboard,
  applyUrlHistory,
  funnelDashboard,
  historicalDashboard,
  journeyMonitoringDashboard,
  mainOverviewDashboard,
  campaignMonitoringDashboard,
  normalizePropertyId,
  pageJourneyDashboard,
  prepaidGnlFunnelDashboard,
  productCatalogDashboard,
  qualityDashboard,
  urlInventoryDashboard,
  realtimeDashboard,
  testConnection,
  validateServiceAccount
} from './ga4.js'

const app = express()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT || 4777)
const host = process.env.HOST || '127.0.0.1'

app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'")
  next()
})

app.use('/api', (req, res, next) => {
  const required = process.env.DASHBOARD_ACCESS_TOKEN
  if (!required || req.get('X-Dashboard-Token') === required) return next()
  return res.status(401).json({ error: 'Dashboard access token is required.' })
})

app.get('/api/health', (req, res) => res.json({ status: 'ok', application: 'ga4-event-dashboard' }))

createAuth(path.resolve(process.env.EVENTSCOPE_DATA_DIR || path.join(root, '.private'))).routes(app)

app.get('/api/status', async (req, res, next) => {
  try {
    const connected = await hasSettings()
    if (!connected) return res.json({ connected: false })
    const settings = await loadSettings()
    return res.json({
      connected: true,
      propertyId: settings.propertyId,
      serviceAccountEmail: settings.serviceAccount.client_email,
      configuredAt: settings.configuredAt,
      firebaseConnected: Boolean(settings.firebaseProjectId),
      adjustConnected: Boolean(settings.adjustToken),
      playstoreConnected: Boolean(settings.playServiceAccount),
      playPackageName: settings.playPackageName || 'com.pixilapps.selfcare',
      playServiceAccountEmail: settings.playServiceAccount?.client_email,
      appstoreConnected: Boolean(settings.appStoreCredentials),
      appstoreKeyId: settings.appStoreCredentials?.keyId
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/settings/test', async (req, res, next) => {
  try {
    const propertyId = normalizePropertyId(req.body.propertyId)
    const serviceAccount = typeof req.body.serviceAccountJson === 'string'
      ? JSON.parse(req.body.serviceAccountJson)
      : req.body.serviceAccountJson
    validateServiceAccount(serviceAccount)
    const result = await testConnection({ propertyId, serviceAccount })
    res.json({ ok: true, ...result, serviceAccountEmail: serviceAccount.client_email })
  } catch (error) {
    next(error)
  }
})

app.post('/api/settings', async (req, res, next) => {
  try {
    const propertyId = normalizePropertyId(req.body.propertyId)
    const serviceAccount = typeof req.body.serviceAccountJson === 'string'
      ? JSON.parse(req.body.serviceAccountJson)
      : req.body.serviceAccountJson
    validateServiceAccount(serviceAccount)
    const result = await testConnection({ propertyId, serviceAccount })
    const configuredAt = new Date().toISOString()
    const current = await loadSettings()
    await saveSettings({ ...current, propertyId, serviceAccount, configuredAt })
    res.json({
      ok: true,
      propertyId,
      serviceAccountEmail: serviceAccount.client_email,
      configuredAt,
      testEventCount: result.eventCount
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/adjust-settings', async (req, res, next) => {
  try {
    const token = String(req.body.token || '').trim()
    const result = await testAdjustConnection(token)
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Configure Google Analytics before adding Adjust.' })
    await saveSettings({ ...settings, adjustToken: token, adjustConfiguredAt: new Date().toISOString() })
    res.json({ ok: true, appCount: result.apps.length })
  } catch (error) { next(error) }
})

app.get('/api/adjust-installs', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings?.adjustToken) return res.status(409).json({ error: 'Adjust is not configured.' })
    res.json(await adjustInstallDashboard(settings.adjustToken, req.query.startDate, req.query.endDate, req.query.scope))
  } catch (error) { next(error) }
})

app.post('/api/playstore-settings', async (req, res, next) => {
  try {
    const serviceAccount = typeof req.body.serviceAccountJson === 'string' ? JSON.parse(req.body.serviceAccountJson) : req.body.serviceAccountJson
    const packageName = String(req.body.packageName || '').trim()
    validatePlayServiceAccount(serviceAccount)
    if (!/^[A-Za-z0-9_.]+$/.test(packageName)) return res.status(400).json({ error: 'Enter a valid Android package name.' })
    const result = await testPlaystoreConnection({ serviceAccount, packageName })
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Configure Google Analytics before adding Playstore.' })
    await saveSettings({ ...settings, playServiceAccount: serviceAccount, playPackageName: result.packageName, playConfiguredAt: new Date().toISOString() })
    res.json({ ok: true, packageName: result.packageName, appCount: result.apps.length, serviceAccountEmail: serviceAccount.client_email })
  } catch (error) { next(error) }
})

app.get('/api/playstore', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings?.playServiceAccount) return res.status(409).json({ error: 'Playstore API is not configured.' })
    res.json(await playstoreDashboard(settings))
  } catch (error) { next(error) }
})

app.post('/api/appstore-settings', async (req, res, next) => {
  try {
    const credentials = { issuerId: String(req.body.issuerId || '').trim(), keyId: String(req.body.keyId || '').trim(), privateKey: String(req.body.privateKey || '').trim().replace(/\\n/g, '\n') }
    validateAppStoreCredentials(credentials)
    const result = await testAppStoreConnection(credentials)
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Configure Google Analytics before adding App Store Connect.' })
    await saveSettings({ ...settings, appStoreCredentials: credentials, appStoreConfiguredAt: new Date().toISOString() })
    res.json({ ok: true, appCount: result.appCount, keyId: credentials.keyId })
  } catch (error) { next(error) }
})

app.get('/api/appstore', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings?.appStoreCredentials) return res.status(409).json({ error: 'App Store Connect API is not configured.' })
    res.json(await appStoreDashboard(settings.appStoreCredentials))
  } catch (error) { next(error) }
})

app.get('/api/dashboard', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    res.json(await historicalDashboard(settings, req.query.startDate || '28daysAgo', req.query.endDate || 'today', req.query.scope))
  } catch (error) {
    next(error)
  }
})

app.get('/api/main-overview', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    res.json(await mainOverviewDashboard(settings, req.query.startDate || '28daysAgo', req.query.endDate || 'today', req.query.scope))
  } catch (error) { next(error) }
})

app.get('/api/campaigns', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    const [analytics, registry] = await Promise.all([
      campaignMonitoringDashboard(settings, req.query.startDate || '28daysAgo', req.query.endDate || 'today', req.query.scope),
      loadCampaignRegistry()
    ])
    res.json({ ...analytics, registry })
  } catch (error) { next(error) }
})

app.post('/api/campaigns', async (req, res, next) => {
  try {
    const websiteUrl = String(req.body.websiteUrl || '').trim()
    const campaignSource = String(req.body.campaignSource || '').trim()
    const campaignMedium = String(req.body.campaignMedium || '').trim()
    const campaignName = String(req.body.campaignName || '').trim()
    const campaignId = String(req.body.campaignId || '').trim()
    if (!websiteUrl || !campaignSource || !campaignMedium || (!campaignName && !campaignId)) return res.status(400).json({ error: 'Website URL, campaign source, campaign medium, and campaign name or campaign ID are required.' })
    const url = new URL(websiteUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return res.status(400).json({ error: 'Website URL must use HTTP or HTTPS.' })
    const fields = {
      utm_id: campaignId, utm_source: campaignSource, utm_medium: campaignMedium, utm_campaign: campaignName,
      utm_term: String(req.body.campaignTerm || '').trim(), utm_content: String(req.body.campaignContent || '').trim()
    }
    for (const [key, value] of Object.entries(fields)) if (value) url.searchParams.set(key, value)
    const registry = await loadCampaignRegistry()
    const campaign = { id: crypto.randomUUID(), websiteUrl, campaignUrl: url.toString(), campaignId, campaignSource, campaignMedium, campaignName, campaignTerm: fields.utm_term, campaignContent: fields.utm_content, status: 'production', createdAt: new Date().toISOString() }
    registry.unshift(campaign)
    await saveCampaignRegistry(registry)
    res.status(201).json(campaign)
  } catch (error) { next(error) }
})

app.delete('/api/campaigns/:id', async (req, res, next) => {
  try {
    const registry = await loadCampaignRegistry()
    const nextRegistry = registry.filter(item => item.id !== req.params.id)
    if (nextRegistry.length === registry.length) return res.status(404).json({ error: 'Campaign link was not found.' })
    await saveCampaignRegistry(nextRegistry)
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.get('/api/realtime', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    res.json(await realtimeDashboard(settings, req.query.scope))
  } catch (error) {
    next(error)
  }
})

app.get('/api/app-lifecycle', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    res.json(await appLifecycleDashboard(settings, req.query.startDate || '28daysAgo', req.query.endDate || 'today', req.query.scope))
  } catch (error) {
    next(error)
  }
})

app.get('/api/quality', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    res.json(await qualityDashboard(settings, req.query.startDate || '28daysAgo', req.query.endDate || 'today', req.query.scope))
  } catch (error) { next(error) }
})

app.get('/api/url-inventory', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    const data = await urlInventoryDashboard(settings, req.query.startDate || '28daysAgo', req.query.endDate || 'today', req.query.scope)
    const tracked = applyUrlHistory(data.urls, await loadUrlHistory())
    await saveUrlHistory(tracked.history)
    data.urls = tracked.urls
    data.summary.new = tracked.urls.filter(item => item.isNew).length
    res.json(data)
  } catch (error) { next(error) }
})

app.get('/api/page-journey', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    res.json(await pageJourneyDashboard(settings, {
      startDate: req.query.startDate || '28daysAgo',
      endDate: req.query.endDate || 'today',
      language: req.query.language || 'en',
      url: req.query.url,
      scope: req.query.scope
    }))
  } catch (error) {
    next(error)
  }
})

app.get('/api/products-items', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    res.json(await productCatalogDashboard(settings, req.query.startDate || '28daysAgo', req.query.endDate || 'today', req.query.scope))
  } catch (error) { next(error) }
})

app.get('/api/prepaid-gnl-funnel', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    res.json(await prepaidGnlFunnelDashboard(settings, req.query.startDate || '28daysAgo', req.query.endDate || 'today', req.query.scope))
  } catch (error) { next(error) }
})

app.get('/api/funnels', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    res.json(await funnelDashboard(settings, req.query.startDate || '28daysAgo', req.query.endDate || 'today', req.query.scope, req.query.journey || 'prepaid'))
  } catch (error) { next(error) }
})

app.get('/api/journey-monitoring', async (req, res, next) => {
  try {
    const settings = await loadSettings()
    if (!settings) return res.status(409).json({ error: 'Google Analytics is not configured.' })
    res.json(await journeyMonitoringDashboard(settings, req.query.startDate || '28daysAgo', req.query.endDate || 'today', req.query.scope))
  } catch (error) { next(error) }
})

app.use(express.static(path.join(root, 'dist')))
app.get('*path', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(root, 'dist', 'index.html'))
})

app.use((error, req, res, next) => {
  console.error(error.message)
  const isJsonError = error instanceof SyntaxError
  res.status(error.status || (isJsonError ? 400 : 502)).json({ error: isJsonError ? 'Service Account JSON is invalid.' : error.message })
})

app.listen(port, host, () => {
  console.log(`GA4 Event Monitor running at http://${host}:${port}`)
})
