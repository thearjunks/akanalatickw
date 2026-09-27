import test from 'node:test'
import assert from 'node:assert/strict'
import { applyUrlHistory, combineDimensionFilters, funnelDefinitions, isPublicPagePath, journeyFailureEvents, mergeCrashTrend, mergeItemDetails, normalizePropertyId, normalizeScope, normalizeTrackedPage, parseSitemap, platformDimension, previousDateRange, productType, validateServiceAccount } from '../server/ga4.js'

test('normalizes numeric property identifiers', () => {
  assert.equal(normalizePropertyId(' properties/123456789 '), '123456789')
})

test('rejects a Measurement ID', () => {
  assert.throws(() => normalizePropertyId('G-ABC123'), /numeric/)
})

test('builds web and app platform scopes', () => {
  assert.equal(normalizeScope('unknown'), 'all')
  assert.deepEqual(platformDimension('web'), { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'web' } } })
  assert.deepEqual(platformDimension('app'), { filter: { fieldName: 'platform', inListFilter: { values: ['Android', 'iOS'] } } })
  assert.equal(combineDimensionFilters(null, platformDimension('all')), undefined)
})

test('requires service-account credentials', () => {
  assert.throws(() => validateServiceAccount({ type: 'authorized_user' }), /service account/)
  assert.doesNotThrow(() => validateServiceAccount({ type: 'service_account', client_email: 'reader@example.com', private_key: 'key' }))
})

test('normalizes tracked STC page URLs', () => {
  assert.deepEqual(normalizeTrackedPage('https://www.stc.com.kw/ar/prepaid-plans/?x=1'), {
    url: 'https://www.stc.com.kw/ar/prepaid-plans',
    path: '/ar/prepaid-plans',
    routeLanguage: 'ar'
  })
  assert.equal(normalizeTrackedPage('/en/5g').path, '/en/5g')
})

test('rejects non-STC journey URLs', () => {
  assert.throws(() => normalizeTrackedPage('https://example.com/en/page'), /stc\.com\.kw/)
})

test('merges crash counts and stability metrics by date', () => {
  assert.deepEqual(mergeCrashTrend(
    [{ date: '20260923', eventCount: 3 }],
    [{ date: '20260923', crashAffectedUsers: 2, crashFreeUsersRate: 0.98 }]
  ), [{ date: '20260923', crashCount: 3, crashAffectedUsers: 2, crashFreeUsersRate: 0.98 }])
})

test('calculates the immediately preceding equal-length comparison period', () => {
  assert.deepEqual(previousDateRange('2026-09-01', '2026-09-07'), { startDate: '2026-08-25', endDate: '2026-08-31' })
})

test('monitors payment and journey failure events', () => {
  assert.ok(['purchase_failed', 'failed_purchase', 'cancelled_purchase', 'failed_login', 'id_verify_failed'].every(event => journeyFailureEvents.includes(event)))
})

test('defines separate prepaid GNL web and app funnels with success and failure outcomes', () => {
  assert.equal(funnelDefinitions.prepaid.web.steps.at(-1)[0], 'Completed purchase')
  assert.equal(funnelDefinitions.prepaid.app.steps.length, 8)
  assert.ok(funnelDefinitions.prepaid.app.steps.at(-1)[1].includes('purchase_prepaid'))
  assert.ok(['failed_login', 'id_verify_failed', 'failed_purchase', 'activated_esim_failed'].every(event => funnelDefinitions.prepaid.app.failures.includes(event)))
  assert.ok(funnelDefinitions.prepaid.web.failures.includes('failed_purchase'))
})

test('defines voucher web and app funnels from supplied and inferred events', () => {
  assert.equal(funnelDefinitions.voucher.app.steps.length, 7)
  assert.ok(funnelDefinitions.voucher.app.steps.at(-1)[1].includes('purchased_voucher'))
  assert.ok(['id_verify_failed', 'failed_login', 'failed_purchase'].every(event => funnelDefinitions.voucher.app.failures.includes(event)))
  assert.ok(funnelDefinitions.voucher.web.steps.at(-1)[1].includes('purchased_voucher'))
  assert.equal(funnelDefinitions.voucher.web.inferred, true)
})

test('defines the requested postpaid and roaming funnels with web and app contexts', () => {
  assert.ok(['prepaid', 'voucher', 'postpaid', 'youthPostpaid', 'postpaidInternet', 'vipPostpaid', 'roaming'].every(key => funnelDefinitions[key]))
  assert.deepEqual(funnelDefinitions.youthPostpaid.web.entry.values, ['/en/youth-postpaid-plans', '/ar/youth-postpaid-plans'])
  assert.ok(funnelDefinitions.postpaidInternet.app.entry.values.includes('Data - Postpaid Plans'))
  assert.ok(funnelDefinitions.vipPostpaid.app.entry.values.includes('Tamayouz - Postpaid Plans GNL'))
  assert.ok(funnelDefinitions.roaming.app.steps.at(-1)[1].includes('purchase_roaming'))
  assert.ok(Object.keys(funnelDefinitions).length >= 60)
  assert.deepEqual(funnelDefinitions.smartphone.web.steps.at(-1)[1], ['purchase'])
  assert.deepEqual(funnelDefinitions.smartphone.app.steps.at(-1)[1], ['purchased_device'])
})

test('merges standard and custom ecommerce item details', () => {
  assert.deepEqual(mergeItemDetails(
    [{ itemName: 'go 6', itemId: 'plan-6', itemBrand: 'STC', itemCategory: 'PREP', itemCategory2: 'VOICE', itemCategory3: 'BUNDLE', itemCategory5: '1 month', itemsViewed: 12 }],
    [{ itemName: 'go 6', itemId: 'plan-6', 'customItem:journey': 'PLAN', 'customItem:number_type': 'V', 'customItem:plan_id': 'plan-6', 'customItem:sim_type': 'NORMAL SIM', 'customItem:purchase_option': '(not set)' }]
  ), [{ pagePath: null, sourceName: null, itemName: 'go 6', itemId: 'plan-6', itemBrand: 'STC', itemCategory: 'PREP', itemCategory2: 'VOICE', itemCategory3: 'BUNDLE', itemCategory5: '1 month', journey: 'PLAN', numberType: 'V', planId: 'plan-6', simType: 'NORMAL SIM', purchaseOption: null, itemsViewed: 12 }])
})

test('merges app ecommerce items by item list', () => {
  assert.equal(mergeItemDetails(
    [{ itemListName: 'prepaid_get_a_new_line', itemName: 'go 6', itemId: 'plan-6', itemsViewed: 8 }],
    [{ itemListName: 'prepaid_get_a_new_line', itemName: 'go 6', itemId: 'plan-6', 'customItem:journey': 'PLAN' }]
  )[0].journey, 'PLAN')
})

test('classifies product catalogue rows', () => {
  assert.equal(productType({ pagePath: '/en/voucher', itemCategory3: 'E-VOUCHER' }), 'Vouchers')
  assert.equal(productType({ itemName: 'Roaming 10GB' }), 'Roaming plans')
  assert.equal(productType({ itemCategory3: 'BUNDLE' }), 'Bundles')
  assert.equal(productType({ itemCategory: 'POST', itemCategory3: 'PLAN' }), 'Plans')
})

test('parses sitemap URLs and metadata', () => {
  assert.deepEqual(parseSitemap('<urlset><url><loc>https://www.stc.com.kw/en/a&amp;b</loc><lastmod>2026-09-24</lastmod></url></urlset>'), [
    { url: 'https://www.stc.com.kw/en/a&b', lastModified: '2026-09-24' }
  ])
})

test('excludes personalized and invalid GA4 routes from public URL inventory', () => {
  assert.equal(isPublicPagePath('/en/prepaid-plans'), true)
  assert.equal(isPublicPagePath('/selfcare/number/50010470/usage'), false)
  assert.equal(isPublicPagePath('/selfcare/settings/number-properties/undefined'), false)
  assert.equal(isPublicPagePath('(not set)'), false)
})

test('baselines existing URLs and tags later discoveries as new', () => {
  const baseline = applyUrlHistory([{ url: 'https://www.stc.com.kw/en/a' }], null, '2026-09-01T00:00:00.000Z')
  assert.equal(baseline.urls[0].isNew, false)
  const next = applyUrlHistory([{ url: 'https://www.stc.com.kw/en/a' }, { url: 'https://www.stc.com.kw/en/b' }], baseline.history, '2026-09-02T00:00:00.000Z')
  assert.equal(next.urls[0].isNew, false)
  assert.equal(next.urls[1].isNew, true)
})
