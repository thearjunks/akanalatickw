import crypto from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta'
const FUNNEL_API = 'https://analyticsdata.googleapis.com/v1alpha'
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
let cachedToken = null

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function validateServiceAccount(account) {
  if (!account || account.type !== 'service_account') {
    const error = new Error('The JSON must be a Google service account credential.')
    error.status = 400
    throw error
  }
  if (!account.client_email || !account.private_key) {
    const error = new Error('The service account JSON is missing client_email or private_key.')
    error.status = 400
    throw error
  }
}

function normalizePropertyId(value) {
  const propertyId = String(value || '').trim().replace(/^properties\//, '')
  if (!/^\d+$/.test(propertyId)) {
    const error = new Error('Property ID must be the numeric GA4 Property ID.')
    error.status = 400
    throw error
  }
  return propertyId
}

async function getAccessToken(account) {
  validateServiceAccount(account)
  if (cachedToken?.email === account.client_email && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value
  }

  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  }))
  const unsigned = `${header}.${claims}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url')
  const assertion = `${unsigned}.${signature}`

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'Google authentication failed.')

  cachedToken = {
    email: account.client_email,
    value: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
  }
  return cachedToken.value
}

async function query(settings, method, body) {
  const { _scope = 'all', ...requestBody } = body
  const scopeFilter = platformDimension(_scope)
  if (scopeFilter) requestBody.dimensionFilter = combineDimensionFilters(requestBody.dimensionFilter, scopeFilter)
  const propertyId = normalizePropertyId(settings.propertyId)
  const token = await getAccessToken(settings.serviceAccount)
  const response = await fetch(`${DATA_API}/properties/${propertyId}:${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = payload?.error?.message || 'Google Analytics Data API request failed.'
    throw new Error(message)
  }
  return payload
}

async function queryFunnel(settings, body) {
  const propertyId = normalizePropertyId(settings.propertyId)
  const token = await getAccessToken(settings.serviceAccount)
  const response = await fetch(`${FUNNEL_API}/properties/${propertyId}:runFunnelReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message || 'Google Analytics funnel request failed.')
  return payload
}

function rows(report) {
  const dimensions = report.dimensionHeaders?.map(item => item.name) || []
  const metrics = report.metricHeaders?.map(item => item.name) || []
  return (report.rows || []).map(row => {
    const item = {}
    dimensions.forEach((name, index) => { item[name] = row.dimensionValues?.[index]?.value ?? null })
    metrics.forEach((name, index) => {
      const raw = row.metricValues?.[index]?.value
      item[name] = raw == null ? null : Number(raw)
    })
    return item
  })
}

function total(report) {
  const headers = report.metricHeaders?.map(item => item.name) || []
  const values = report.totals?.[0]?.metricValues || report.rows?.[0]?.metricValues || []
  return Object.fromEntries(headers.map((name, index) => [name, Number(values[index]?.value || 0)]))
}

const dateRange = (startDate, endDate) => [{ startDate, endDate }]
const exactDimension = (fieldName, value) => ({ filter: { fieldName, stringFilter: { matchType: 'EXACT', value } } })
const inListDimension = (fieldName, values) => ({ filter: { fieldName, inListFilter: { values } } })
const containsDimension = (fieldName, value) => ({ filter: { fieldName, stringFilter: { matchType: 'CONTAINS', value, caseSensitive: false } } })
const normalizeScope = value => ['web', 'app'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'all'
const platformDimension = scope => normalizeScope(scope) === 'web' ? exactDimension('platform', 'web') : normalizeScope(scope) === 'app' ? inListDimension('platform', ['Android', 'iOS']) : null
const combineDimensionFilters = (...filters) => {
  const expressions = filters.filter(Boolean)
  return expressions.length < 2 ? expressions[0] : { andGroup: { expressions } }
}
const funnelField = (fieldName, value) => ({ funnelFieldFilter: { fieldName, stringFilter: { matchType: 'EXACT', value } } })
const funnelContains = (fieldName, value) => ({ funnelFieldFilter: { fieldName, stringFilter: { matchType: 'CONTAINS', value, caseSensitive: false } } })
const funnelEvent = eventName => ({ funnelEventFilter: { eventName } })
const funnelOrEvents = eventNames => ({ orGroup: { expressions: eventNames.map(funnelEvent) } })
const funnelPlatform = platform => platform === 'web'
  ? funnelField('platform', 'web')
  : { orGroup: { expressions: [funnelField('platform', 'Android'), funnelField('platform', 'iOS')] } }

const planFunnel = ({ name, path, appLists, purchaseEvent = 'purchase_postpaid', webEntryEvent = 'view_item_list' }) => ({
  name,
  eyebrow: `${name} monitoring`,
  description: `Closed, ordered GA4 funnels for the ${name} purchase journey.`,
  web: {
    steps: [['Viewed plans', [webEntryEvent]], ['Selected or viewed a plan', ['clicked_cta', 'select_item', 'view_item']], ['Completed purchase', ['purchase']]],
    purchases: [], failures: ['failed_purchase'], outcomes: ['purchase', 'failed_purchase'],
    monitored: ['view_item_list', 'select_item', 'view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase', 'failed_purchase'],
    entry: { type: 'exact', field: 'unifiedPagePathScreen', values: [`/en/${path}`, `/ar/${path}`] }
  },
  app: {
    steps: [['Viewed plans', ['view_item_list']], ['Selected or viewed a plan', ['select_item', 'view_item']], ['Completed purchase', ['purchase', purchaseEvent]]],
    purchases: purchaseEvent === 'purchase_roaming' ? [purchaseEvent] : [], failures: ['failed_purchase'], outcomes: ['purchase', purchaseEvent, 'failed_purchase'],
    monitored: ['view_item_list', 'select_item', 'view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase', purchaseEvent, 'failed_purchase'],
    entry: { type: 'exact', field: 'itemListName', values: appLists }
  },
  coverage: {
    web: `The web funnel starts on /en/${path} or /ar/${path}.`,
    app: `The app funnel starts only when itemListName matches ${appLists.join(' or ')}.`
  }
})

const eventFunnel = (name, steps, failures = [], outcomeLabel = 'Successful outcomes', entry = null, aggregateOutcome = true) => {
  const monitored = [...new Set([...steps.flatMap(([, events]) => events), ...failures])]
  const purchases = aggregateOutcome ? steps.at(-1)[1] : []
  const platform = { steps, purchases, failures, outcomes: [...purchases, ...failures], monitored, entry }
  return {
    name, eyebrow: `${name} monitoring`, outcomeLabel,
    description: `Ordered GA4 event funnel for the ${name} journey.`,
    web: { ...platform }, app: { ...platform },
    coverage: { web: 'Web results use only events reported with platform web.', app: 'App results use only events reported with platform Android or iOS.' }
  }
}

const funnelDefinitions = {
  prepaid: {
    name: 'Prepaid GNL',
    eyebrow: 'Get a New Line monitoring',
    description: 'Closed, ordered GA4 funnels for the prepaid Get a New Line journey.',
    web: {
    steps: [
      ['Viewed prepaid plans', ['view_item_list']],
      ['Selected or viewed an item', ['select_item', 'view_item']],
      ['Added to cart', ['add_to_cart']],
      ['Started checkout', ['begin_checkout']],
      ['Completed purchase', ['purchase']]
    ],
    purchases: [],
    failures: ['failed_purchase', 'activated_esim_failed'],
    outcomes: ['purchase', 'failed_purchase', 'activated_esim', 'activated_esim_failed'],
      monitored: ['view_item_list', 'select_item', 'view_item', 'add_to_cart', 'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase', 'failed_purchase', 'activated_esim', 'activated_esim_failed'],
      entry: { type: 'exact', field: 'unifiedPagePathScreen', values: ['/en/prepaid-plans', '/ar/prepaid-plans'] }
    },
    app: {
    steps: [
      ['Opened GNL journey', ['clicked_cta', 'clicked_link', 'view_item_list']],
      ['Selected or viewed an item', ['select_item', 'view_item']],
      ['Added to cart', ['add_to_cart']],
      ['Selected SIM or number', ['select_sim', 'select_number']],
      ['Viewed cart', ['view_cart']],
      ['Started checkout', ['begin_checkout']],
      ['Added payment information', ['add_payment_info']],
      ['Completed purchase', ['purchase', 'purchase_prepaid', 'purchase_prepaid_bundle', 'purchase_prepaid_Plan', 'purchase_addon', 'purchased_device', 'purchase_vas']]
    ],
    purchases: ['purchase_prepaid', 'purchase_prepaid_bundle', 'purchase_prepaid_Plan', 'purchase'],
    failures: ['failed_login', 'id_verify_failed', 'failed_purchase', 'activated_esim_failed'],
    outcomes: ['purchase', 'purchase_prepaid', 'purchase_prepaid_bundle', 'purchase_prepaid_Plan', 'purchase_addon', 'purchased_device', 'purchase_vas', 'failed_login', 'id_verify_failed', 'failed_purchase', 'activated_esim', 'activated_esim_failed'],
      monitored: ['clicked_cta', 'clicked_link', 'view_item_list', 'select_item', 'view_item', 'add_to_cart', 'select_sim', 'select_number', 'view_cart', 'login', 'failed_login', 'id_verify_startred', 'id_verify_started', 'id_verify_success', 'id_verify_failed', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase', 'purchase_prepaid', 'purchase_prepaid_bundle', 'purchase_prepaid_Plan', 'purchase_addon', 'purchased_device', 'purchase_vas', 'failed_purchase', 'activated_esim', 'activated_esim_failed'],
      entry: { type: 'exact', field: 'itemListName', values: ['prepaid_get_a_new_line', 'Prepaid - Get a New Line'] }
    }
  },
  voucher: {
    name: 'Voucher',
    eyebrow: 'Voucher purchase monitoring',
    description: 'Closed, ordered GA4 funnels for voucher discovery, checkout and purchase.',
    web: {
      steps: [
        ['Viewed voucher list', ['view_item_list']],
        ['Selected or viewed a voucher', ['select_item', 'view_item']],
        ['Added voucher to cart', ['add_to_cart']],
        ['Completed voucher purchase', ['purchase', 'purchased_voucher']]
      ],
      purchases: [],
      failures: ['failed_purchase'],
      outcomes: ['purchase', 'purchased_voucher', 'failed_purchase'],
      monitored: ['view_item_list', 'select_item', 'view_item', 'add_to_cart', 'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase', 'purchased_voucher', 'failed_purchase'],
      entry: { type: 'exact', field: 'unifiedPagePathScreen', values: ['/en/voucher', '/ar/voucher'] },
      inferred: true
    },
    app: {
      steps: [
        ['Viewed voucher list', ['view_item_list']],
        ['Selected or viewed a voucher', ['select_item', 'view_item']],
        ['Added voucher to cart', ['add_to_cart']],
        ['Viewed cart', ['view_cart']],
        ['Started checkout', ['begin_checkout']],
        ['Added payment information', ['add_payment_info']],
        ['Completed voucher purchase', ['purchase', 'purchased_voucher']]
      ],
      purchases: ['purchased_voucher', 'purchase'],
      failures: ['id_verify_failed', 'failed_login', 'failed_purchase'],
      outcomes: ['purchase', 'purchased_voucher', 'id_verify_failed', 'failed_login', 'failed_purchase'],
      monitored: ['view_item_list', 'select_item', 'view_item', 'add_to_cart', 'id_verify_startred', 'id_verify_started', 'id_verify_success', 'id_verify_failed', 'login', 'failed_login', 'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase', 'purchased_voucher', 'failed_purchase'],
      entry: null
    }
  },
  postpaid: planFunnel({ name: 'Postpaid plans', path: 'postpaid-plans', appLists: ['postpaid - Get a New Line', 'Voice - Postpaid Plans'] }),
  youthPostpaid: planFunnel({ name: 'Youth postpaid plans', path: 'youth-postpaid-plans', appLists: ['youth - Get a New Line'] }),
  postpaidInternet: planFunnel({ name: 'Postpaid internet plans', path: 'postpaid-internet-plans', appLists: ['Data - Postpaid Plans'] }),
  vipPostpaid: planFunnel({ name: 'VIP postpaid plans', path: 'vip-postpaid-plans', appLists: ['Tamayouz - Postpaid Plans GNL', 'Tamayouz - Postpaid Plans Estore'] }),
  roaming: planFunnel({ name: 'Roaming bundles', path: 'roaming-bundles', appLists: ['Roaming - Get a Plan Line'], purchaseEvent: 'purchase_roaming', webEntryEvent: 'page_view' })
}

const commerceSteps = (purchaseEvents, item = 'item') => [
  [`Viewed ${item}`, ['view_item_list', 'view_item']],
  [`Selected ${item}`, ['select_item', 'clicked_cta']],
  ['Added to cart', ['add_to_cart']],
  ['Completed purchase', purchaseEvents]
]
const categoryEntry = values => ({ type: 'exact', field: 'itemCategory', values })
const productPurchaseFunnel = (name, item, entry = null, webSkipsCart = false) => {
  const definition = eventFunnel(name, commerceSteps(['purchased_device'], item), ['failed_purchase'], 'Recorded purchases', entry)
  definition.web = {
    ...definition.web,
    steps: webSkipsCart ? [[`Viewed ${item}`, ['view_item_list', 'view_item']], [`Selected ${item}`, ['select_item', 'clicked_cta']], ['Completed purchase', ['purchase']]] : commerceSteps(['purchase'], item),
    purchases: ['purchase'],
    outcomes: ['purchase', 'failed_purchase'],
    monitored: [...new Set([...definition.web.monitored.filter(event => event !== 'purchased_device'), 'purchase'])],
    eventContext: entry,
    purchaseMetricContext: entry
  }
  return definition
}
Object.assign(funnelDefinitions, Object.fromEntries([
  ['postpaidVoice', eventFunnel('Postpaid voice plans', commerceSteps(['purchase', 'purchase_postpaid'], 'voice plan'), ['failed_purchase'], 'Recorded purchases', categoryEntry(['POST']), false)],
  ['prepaidVoice', eventFunnel('Prepaid voice plans', commerceSteps(['purchase', 'purchase_prepaid'], 'voice plan'), ['failed_purchase'], 'Recorded purchases', categoryEntry(['PREP']), false)],
  ['prepaidData', eventFunnel('Prepaid data plans', commerceSteps(['purchase', 'purchase_prepaid'], 'data plan'), ['failed_purchase'], 'Recorded purchases', categoryEntry(['PREP']), false)],
  ['device', productPurchaseFunnel('Device purchase', 'device')],
  ['smartphone', productPurchaseFunnel('Smartphone purchase', 'smartphone', categoryEntry(['SMARTPHONE']))],
  ['router', productPurchaseFunnel('Router purchase', 'router', categoryEntry(['ROUTER']))],
  ['tablet', productPurchaseFunnel('Tablet purchase', 'tablet', categoryEntry(['TABLET']))],
  ['gamingConsole', productPurchaseFunnel('Gaming console purchase', 'gaming console', categoryEntry(['GAMINGCONSOLE']), true)],
  ['display', productPurchaseFunnel('Display purchase', 'display', categoryEntry(['DISPLAY']), true)],
  ['accessory', productPurchaseFunnel('Accessory purchase', 'accessory', categoryEntry(['ACCESSORY']), true)],
  ['addon', eventFunnel('Add-on purchase', commerceSteps(['purchase_addon'], 'add-on'), ['failed_purchase'], 'Recorded purchases', categoryEntry(['addon']))],
  ['booster', eventFunnel('Booster purchase', commerceSteps(['purchase_addon'], 'booster'), ['failed_purchase'], 'Recorded purchases', categoryEntry(['Booster']))],
  ['bundle', eventFunnel('Bundle purchase', commerceSteps(['purchase_addon'], 'bundle'), ['failed_purchase'], 'Recorded purchases', categoryEntry(['bundle']))],
  ['vas', eventFunnel('VAS purchase', commerceSteps(['purchase_vas'], 'VAS'), ['failed_purchase'], 'Recorded purchases')],
  ['offer', eventFunnel('Promotional offer purchase', [['Viewed promotion', ['view_promotion']], ['Selected promotion', ['select_promotion']], ['Completed purchase', ['purchase_offer']]], ['failed_purchase'], 'Recorded purchases')],
  ['premiumNumber', eventFunnel('Premium-number selection', [['Viewed numbers', ['view_number']], ['Selected number', ['select_number']], ['Completed purchase', ['purchase', 'purchase_postpaid']]], ['failed_purchase'], 'Recorded purchases', null, false)],
  ['quickPay', eventFunnel('Quick Pay bill payment', [['Viewed bill payment', ['view_item', 'clicked_cta']], ['Started bill payment', ['begin_checkout_billpayment']], ['Completed payment', ['purchase_billpayment']]], ['purchase_failed', 'failed_purchase'], 'Recorded payments')],
  ['recharge', eventFunnel('Quick Pay recharge', [['Viewed recharge', ['view_item', 'clicked_cta']], ['Started payment', ['begin_checkout']], ['Completed recharge', ['purchase_recharge']]], ['purchase_failed', 'failed_purchase'], 'Recorded recharges')],
  ['login', eventFunnel('Login/sign-in', [['Viewed sign-in', ['sign_in_screen_viewed']], ['Started login', ['login_started']], ['Login completed', ['login']]], ['failed_login'])],
  ['failedLogin', eventFunnel('Failed login', [['Viewed sign-in', ['sign_in_screen_viewed']], ['Started login', ['login_started']], ['Login failed', ['failed_login']]], ['failed_login'], 'Failure outcomes')],
  ['identityVerification', eventFunnel('Identity verification', [['Verification started', ['id_verify_started']], ['Verification completed', ['id_verify_success']]], ['id_verify_failed'])],
  ['civilIdUpdate', eventFunnel('Civil ID update', [['Civil ID update started', ['updated_civilid_started']], ['Civil ID updated', ['updated_civilid_success']]], [])],
  ['switchToStc', eventFunnel('Switch to STC', [['Journey started', ['lead_switch_to_stc_started']], ['Line viewed', ['lead_switch_to_stc_line_viewed']], ['Line selected', ['lead_switch_to_stc_line_selected']], ['Lead completed', ['lead_switch_to_stc']]], [])],
  ['lineSelection', eventFunnel('Line selection', [['Viewed line', ['lead_switch_to_stc_line_viewed', 'view_item']], ['Selected line', ['lead_switch_to_stc_line_selected', 'select_item']]], [])],
  ['numberSelection', eventFunnel('Number selection', [['Viewed number', ['view_number']], ['Selected number', ['select_number']]], [])],
  ['simSelection', eventFunnel('SIM selection', [['Viewed plan', ['view_item']], ['Selected SIM', ['select_sim']]], [])],
  ['ownershipClaim', eventFunnel('Ownership claim', [['Claim started', ['clicked_cta']], ['Ownership claimed', ['claim_ownership_success']]], ['claim_ownership_failed'])],
  ['ownershipSetup', eventFunnel('Ownership setup', [['Setup started', ['clicked_cta']], ['Ownership set', ['set_ownership_success']]], ['claim_ownership_failed'])],
  ['addCard', eventFunnel('Add card', [['Card journey started', ['clicked_cta']], ['Card added', ['added_card']]], ['failed_added_card'])],
  ['paymentMethod', eventFunnel('Add payment method', [['Payment method viewed', ['add_payment_info']], ['Payment method added', ['added_payment_method']]], ['failed_added_card'])],
  ['autopay', eventFunnel('AutoPay settings', [['AutoPay viewed', ['view_item']], ['AutoPay changed', ['autopay_toggle_on', 'autopay_toggle_off']]], [])],
  ['socialLinking', eventFunnel('Social-account linking', [['Linking started', ['social_account_link']], ['Account linked', ['social_link_success']]], [])],
  ['support', eventFunnel('Contact support', [['Support selected', ['clicked_cta', 'clicked_link']], ['Support contacted', ['contacted_support']]], [])],
  ['qitafJoin', eventFunnel('Join Qitaf', [['Qitaf selected', ['clicked_cta']], ['Qitaf joined', ['joined_qitaf']]], ['joined_qitaf_failed'])],
  ['qitafEarn', eventFunnel('Earn Qitaf points', [['Qitaf joined', ['joined_qitaf']], ['Points earned', ['earned_points']]], [])],
  ['qitafSpend', eventFunnel('Spend Qitaf points', [['Spend started', ['spend_points']], ['Points activated', ['spend_points_activated']]], ['spend_points_failed'])],
  ['qitafFailure', eventFunnel('Qitaf enrolment failure', [['Enrolment started', ['clicked_cta']], ['Enrolment failed', ['joined_qitaf_failed']]], ['joined_qitaf_failed'], 'Failure outcomes')],
  ['pointsFailure', eventFunnel('Points-payment failure', [['Spend started', ['spend_points']], ['Points payment failed', ['spend_points_failed']]], ['spend_points_failed'], 'Failure outcomes')],
  ['partnerRewards', eventFunnel('Partner rewards', [['Reward viewed', ['view_item']], ['Reward selected', ['select_item']], ['Reward completed', ['purchase_offer']]], ['failed_purchase'])],
  ['stcRewards', eventFunnel('STC rewards', [['Reward viewed', ['view_item']], ['Points spent', ['spend_points']], ['Reward completed', ['spend_points_activated']]], ['spend_points_failed'])],
  ['promotion', eventFunnel('Promotion engagement', [['Promotion viewed', ['view_promotion']], ['Promotion selected', ['select_promotion']]], [])],
  ['notificationReceived', eventFunnel('Notification received', [['Notification received', ['os_notification_received']], ['Notification opened', ['os_notification_opened']]], [])],
  ['notificationOpened', eventFunnel('Notification opened', [['Notification viewed', ['view_notification']], ['Notification opened', ['os_notification_opened', 'select_notification']]], [])],
  ['notificationSelection', eventFunnel('Notification selection', [['Notification viewed', ['view_notification']], ['Notification selected', ['select_notification']]], [])],
  ['searchJourney', eventFunnel('Search and results', [['Search started', ['search']], ['Results viewed', ['view_search_results']]], [])],
  ['navigation', eventFunnel('Navigation and CTA clicks', [['Navigation clicked', ['clicked_navigation']], ['CTA clicked', ['clicked_cta', 'clicked_link']]], [])],
  ['productList', eventFunnel('Product-list viewing', [['List viewed', ['view_item_list']], ['Item selected', ['select_item']]], [])],
  ['productDetail', eventFunnel('Product-detail viewing', [['List viewed', ['view_item_list']], ['Item viewed', ['view_item']]], [])],
  ['cart', eventFunnel('Cart activity', [['Item viewed', ['view_item']], ['Added to cart', ['add_to_cart']], ['Cart viewed', ['view_cart']]], ['remove_from_cart'])],
  ['checkout', eventFunnel('Checkout', [['Cart viewed', ['view_cart']], ['Checkout started', ['begin_checkout']], ['Payment information added', ['add_payment_info']], ['Purchase completed', ['purchase']]], ['failed_purchase', 'purchase_failed'], 'Recorded purchases', null, false)],
  ['shipping', eventFunnel('Shipping-information submission', [['Checkout started', ['begin_checkout']], ['Shipping information added', ['add_shipping_info']]], [])],
  ['paymentInfo', eventFunnel('Payment-information submission', [['Checkout started', ['begin_checkout']], ['Payment information added', ['add_payment_info']]], ['failed_added_card'])],
  ['orderView', eventFunnel('Order viewing', [['Purchase completed', ['purchase']], ['Order viewed', ['view_order']]], [])],
  ['firstOpen', eventFunnel('First app open/install proxy', [['Session started', ['session_start']], ['First open', ['first_open']]], [])],
  ['appUpdate', eventFunnel('App update', [['App opened', ['session_start']], ['App updated', ['app_update']]], [])],
  ['appRemove', eventFunnel('App removal', [['App used', ['session_start']], ['App removed', ['app_remove']]], [])],
  ['appClearData', eventFunnel('App data cleared', [['App used', ['session_start']], ['App data cleared', ['app_clear_data']]], [])],
  ['appCrash', eventFunnel('App exceptions/crashes', [['App session', ['session_start']], ['App exception', ['app_exception']]], ['app_exception'], 'Crash outcomes')],
  ['appError', eventFunnel('Application errors', [['App session', ['session_start']], ['Application error', ['app_error']]], ['app_error'], 'Error outcomes')],
  ['osUpdate', eventFunnel('OS update', [['App session', ['session_start']], ['OS updated', ['os_update']]], [])],
  ['notificationAttribution', eventFunnel('Notification influence attribution', [['Notification received', ['os_notification_received']], ['Influenced open', ['os_notification_influence_open']]], [])]
].map(([key, definition]) => [key, definition])))
const journeyFailureEvents = ['purchase_failed', 'failed_purchase', 'cancelled_purchase', 'failed_login', 'id_verify_failed', 'spend_points_failed', 'failed_added_card', 'joined_qitaf_failed', 'claim_ownership_failed', 'notify_device_failed', 'app_error']
const journeyFailureDetails = {
  purchase_failed: ['Payment', 'Failed payment'], failed_purchase: ['Payment', 'Failed payment'], cancelled_purchase: ['Payment', 'Cancelled payment'],
  failed_added_card: ['Payment method', 'Card addition failed'], spend_points_failed: ['Payment method', 'Points payment failed'],
  failed_login: ['Sign in', 'Login failed'], id_verify_failed: ['Identity verification', 'Identity verification failed'],
  joined_qitaf_failed: ['Loyalty enrolment', 'Qitaf enrolment failed'], claim_ownership_failed: ['Ownership verification', 'Ownership claim failed'],
  notify_device_failed: ['Device notification', 'Device notification failed'], app_error: ['Application', 'Application error']
}

function funnelStep(name, expression, withinDurationFromPriorStep) {
  return {
    name,
    filterExpression: expression,
    ...(withinDurationFromPriorStep ? { withinDurationFromPriorStep } : {})
  }
}

function parseFunnel(report, expectedSteps) {
  const parsed = new Map((report?.rows || []).map(row => {
    const step = row.dimensionValues?.[0]?.value?.replace(/^\d+\.\s*/, '')
    const values = row.metricValues || []
    return [step, {
      step,
      activeUsers: Number(values[0]?.value || 0),
      completionRate: Number(values[1]?.value || 0),
      abandonments: Number(values[2]?.value || 0),
      abandonmentRate: Number(values[3]?.value || 0)
    }]
  }))
  return expectedSteps.map(step => parsed.get(step) || { step, activeUsers: 0, completionRate: 0, abandonments: 0, abandonmentRate: 0 })
}

async function runJourneyFunnel(settings, startDate, endDate, path, outcome, outcomeEvents, scope = 'all') {
  const stepNames = ['Viewed selected page', 'Selected an item, plan or number', 'Started checkout', outcome]
  const entry = {
    andGroup: {
      expressions: [funnelEvent('page_view'), funnelField('unifiedPagePathScreen', path), ...(normalizeScope(scope) === 'web' ? [funnelField('platform', 'web')] : normalizeScope(scope) === 'app' ? [{ orGroup: { expressions: [funnelField('platform', 'Android'), funnelField('platform', 'iOS')] } }] : [])]
    }
  }
  const report = await queryFunnel(settings, {
    dateRanges: dateRange(startDate, endDate),
    funnel: {
      isOpenFunnel: false,
      steps: [
        funnelStep('Viewed selected page', entry),
        funnelStep('Selected an item, plan or number', funnelOrEvents(['select_item', 'clicked_cta', 'select_number', 'view_number']), '1800s'),
        funnelStep('Started checkout', funnelEvent('begin_checkout'), '1800s'),
        funnelStep(outcome, funnelOrEvents(outcomeEvents), '1800s')
      ]
    }
  })
  return {
    steps: parseFunnel(report?.funnelTable, stepNames),
    sampling: report?.funnelTable?.metadata?.samplingMetadatas?.[0] || null
  }
}

async function runFunnelPlatform(settings, startDate, endDate, journey, platform) {
  const definition = funnelDefinitions[journey][platform]
  const stepNames = definition.steps.map(([name]) => name)
  const entryFilter = definition.entry?.type === 'contains' ? funnelContains : funnelField
  const entryContext = definition.entry && { orGroup: { expressions: definition.entry.values.map(value => entryFilter(definition.entry.field, value)) } }
  const firstStep = {
    andGroup: {
      expressions: [funnelPlatform(platform), entryContext, funnelOrEvents(definition.steps[0][1])].filter(Boolean)
    }
  }
  const funnelReport = await queryFunnel(settings, {
    dateRanges: dateRange(startDate, endDate),
    funnel: {
      isOpenFunnel: false,
      steps: definition.steps.map(([name, events], index) => funnelStep(name, index === 0 ? firstStep : funnelOrEvents(events), index ? '1800s' : undefined))
    }
  })
  const reportContext = definition.eventContext && (definition.eventContext.type === 'contains'
    ? containsDimension(definition.eventContext.field, definition.eventContext.values[0])
    : inListDimension(definition.eventContext.field, definition.eventContext.values))
  const eventReport = await query(settings, 'runReport', {
    dateRanges: dateRange(startDate, endDate),
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    dimensionFilter: combineDimensionFilters(platformDimension(platform), reportContext, inListDimension('eventName', definition.monitored)),
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 100
  })
  let commercePurchases = 0
  if (definition.purchaseMetricContext) {
    try {
      const purchaseReport = await query(settings, 'runReport', {
        dateRanges: dateRange(startDate, endDate),
        metrics: [{ name: 'ecommercePurchases' }],
        dimensionFilter: combineDimensionFilters(platformDimension(platform), reportContext),
        metricAggregations: ['TOTAL']
      })
      commercePurchases = total(purchaseReport).ecommercePurchases || 0
    } catch {}
  }
  const steps = parseFunnel(funnelReport?.funnelTable, stepNames)
  const events = rows(eventReport)
  const byEvent = new Map(events.map(row => [row.eventName, row]))
  const entrants = steps[0]?.activeUsers || 0
  const completions = steps.at(-1)?.activeUsers || 0
  const failures = definition.failures.map(eventName => ({ eventName, eventCount: byEvent.get(eventName)?.eventCount || 0, totalUsers: byEvent.get(eventName)?.totalUsers || 0 }))
  const purchaseRows = definition.purchases.map(eventName => byEvent.get(eventName)).filter(Boolean)
  const journeyPurchaseRows = purchaseRows.filter(row => row.eventName !== 'purchase' && row.eventCount)
  const recordedPurchase = (journeyPurchaseRows.length ? journeyPurchaseRows : purchaseRows).reduce((best, row) => row.eventCount > (best?.eventCount || 0) ? row : best, null)
  return {
    platform,
    steps,
    failures,
    events: definition.monitored.map(eventName => ({ eventName, eventCount: byEvent.get(eventName)?.eventCount || 0, totalUsers: byEvent.get(eventName)?.totalUsers || 0 })),
    outcomes: definition.outcomes.map(eventName => ({ eventName, eventCount: byEvent.get(eventName)?.eventCount || 0, totalUsers: byEvent.get(eventName)?.totalUsers || 0 })),
    summary: {
      entrants,
      completions,
      recordedPurchaseEvents: recordedPurchase?.eventCount || commercePurchases || completions,
      recordedPurchaseUsers: recordedPurchase?.totalUsers || completions,
      recordedPurchaseEvent: recordedPurchase?.eventName || (commercePurchases ? 'ecommercePurchases' : 'ordered purchase'),
      completionRate: entrants ? completions / entrants : 0,
      abandonedUsers: Math.max(0, entrants - completions),
      failureEvents: failures.reduce((sum, row) => sum + row.eventCount, 0),
      failureUsers: failures.reduce((sum, row) => sum + row.totalUsers, 0)
    },
    sampling: funnelReport?.funnelTable?.metadata?.samplingMetadatas?.[0] || null
  }
}

export async function funnelDashboard(settings, startDate = '28daysAgo', endDate = 'today', scope = 'all', journey = 'prepaid') {
  if (!funnelDefinitions[journey]) {
    const error = new Error(`Unknown funnel journey. Choose one of: ${Object.keys(funnelDefinitions).join(', ')}.`)
    error.status = 400
    throw error
  }
  const normalizedScope = normalizeScope(scope)
  const platforms = normalizedScope === 'all' ? ['web', 'app'] : [normalizedScope]
  const selected = funnelDefinitions[journey]
  const reports = await Promise.all(platforms.map(platform => runFunnelPlatform(settings, startDate, endDate, journey, platform)))
  return {
    generatedAt: new Date().toISOString(),
    period: { startDate, endDate },
    scope: normalizedScope,
    journey,
    name: selected.name,
    eyebrow: selected.eyebrow,
    description: selected.description,
    outcomeLabel: selected.outcomeLabel || 'Recorded purchases',
    availableJourneys: Object.entries(funnelDefinitions).map(([value, definition]) => ({ value, label: definition.name })),
    reports,
    coverage: {
      web: selected.coverage?.web || (journey === 'voucher' ? 'The voucher web funnel is inferred from standard GA4 ecommerce events and starts on /en/voucher or /ar/voucher. Confirm the production web event specification when available.' : 'The closed web funnel starts only when view_item_list is reported on /en/prepaid-plans or /ar/prepaid-plans.'),
      app: selected.coverage?.app || (journey === 'voucher' ? 'The voucher app funnel uses the supplied event specification. Because GA4 does not consistently attach a voucher item-list value to the entry event, purchased_voucher is the journey-specific completion signal.' : 'The closed app funnel starts only when the entry event carries itemListName prepaid_get_a_new_line or Prepaid - Get a New Line.'),
      failures: 'Failure counts are event aggregates for the selected platform. They are journey-specific only when the failure event retains journey context; GA4 Data API cannot join unrelated events by an individual journey ID.'
    }
  }
}

export const prepaidGnlFunnelDashboard = (settings, startDate, endDate, scope) => funnelDashboard(settings, startDate, endDate, scope, 'prepaid')

export async function testConnection(settings) {
  const report = await query(settings, 'runReport', {
    dateRanges: dateRange('yesterday', 'today'),
    metrics: [{ name: 'eventCount' }],
    limit: 1
  })
  return { propertyId: normalizePropertyId(settings.propertyId), eventCount: total(report).eventCount || 0 }
}

export async function historicalDashboard(settings, startDate = '28daysAgo', endDate = 'today', scope = 'all') {
  const common = { dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, _scope: scope }
  const [summary, trend, events, pages, sources, devices, countries] = await Promise.all([
    query(settings, 'runReport', {
      ...common,
      metrics: ['activeUsers', 'sessions', 'eventCount', 'screenPageViews', 'keyEvents'].map(name => ({ name })),
      metricAggregations: ['TOTAL']
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'date' }],
      metrics: ['activeUsers', 'eventCount', 'screenPageViews'].map(name => ({ name })),
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 366
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'eventName' }],
      metrics: ['eventCount', 'totalUsers', 'keyEvents'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }],
      limit: 100
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'pageTitle' }, { name: 'pagePath' }],
      metrics: ['screenPageViews', 'activeUsers'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'screenPageViews' } }],
      limit: 25
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'sessionSourceMedium' }],
      metrics: ['sessions', 'activeUsers'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
      limit: 20
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ desc: true, metric: { metricName: 'activeUsers' } }]
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ desc: true, metric: { metricName: 'activeUsers' } }],
      limit: 15
    })
  ])

  return {
    period: { startDate, endDate },
    generatedAt: new Date().toISOString(),
    property: {
      id: normalizePropertyId(settings.propertyId),
      currencyCode: summary.metadata?.currencyCode || null,
      timeZone: summary.metadata?.timeZone || null
    },
    summary: total(summary),
    trend: rows(trend),
    events: rows(events),
    pages: rows(pages),
    sources: rows(sources),
    devices: rows(devices),
    countries: rows(countries)
  }
}

export async function realtimeDashboard(settings, scope = 'all') {
  const [summary, events] = await Promise.all([
    query(settings, 'runRealtimeReport', {
      metrics: ['activeUsers', 'eventCount', 'screenPageViews', 'keyEvents'].map(name => ({ name })),
      metricAggregations: ['TOTAL'], _scope: scope
    }),
    query(settings, 'runRealtimeReport', {
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }],
      limit: 50, _scope: scope
    })
  ])
  return {
    generatedAt: new Date().toISOString(),
    window: 'Last 30 minutes',
    summary: total(summary),
    events: rows(events)
  }
}

export async function appLifecycleDashboard(settings, startDate = '28daysAgo', endDate = 'today', scope = 'all') {
  const lifecycleEvents = ['first_open', 'app_remove']
  const common = {
    dateRanges: dateRange(startDate, endDate),
    keepEmptyRows: false,
    dimensionFilter: inListDimension('eventName', lifecycleEvents), _scope: scope
  }
  const [summary, trend, platforms, operatingSystems, versions] = await Promise.all([
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'eventName' }],
      metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }]
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'date' }, { name: 'eventName' }],
      metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 1000
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'platform' }, { name: 'eventName' }],
      metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }],
      limit: 50
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'operatingSystem' }, { name: 'eventName' }],
      metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }],
      limit: 50
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'appVersion' }, { name: 'eventName' }],
      metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }],
      limit: 50
    })
  ])

  const summaryRows = rows(summary)
  const installs = summaryRows.find(row => row.eventName === 'first_open') || { eventCount: 0, totalUsers: 0 }
  const removals = summaryRows.find(row => row.eventName === 'app_remove') || { eventCount: 0, totalUsers: 0 }
  const byDate = new Map()
  for (const row of rows(trend)) {
    const item = byDate.get(row.date) || { date: row.date, installs: 0, installUsers: 0, uninstalls: 0, uninstallUsers: 0 }
    if (row.eventName === 'first_open') {
      item.installs = row.eventCount || 0
      item.installUsers = row.totalUsers || 0
    } else if (row.eventName === 'app_remove') {
      item.uninstalls = row.eventCount || 0
      item.uninstallUsers = row.totalUsers || 0
    }
    byDate.set(row.date, item)
  }

  return {
    generatedAt: new Date().toISOString(),
    period: { startDate, endDate },
    property: { id: normalizePropertyId(settings.propertyId), timeZone: summary.metadata?.timeZone || null },
    summary: {
      downloads: null,
      installs: installs.eventCount || 0,
      installUsers: installs.totalUsers || 0,
      uninstalls: removals.eventCount || 0,
      uninstallUsers: removals.totalUsers || 0,
      netInstalls: (installs.eventCount || 0) - (removals.eventCount || 0)
    },
    trend: [...byDate.values()],
    platforms: rows(platforms),
    operatingSystems: rows(operatingSystems),
    versions: rows(versions),
    availability: {
      downloads: { available: false, reason: 'GA4 does not report App Store or Google Play download counts. Connect the store consoles for download data.' },
      installs: { available: true, sourceEvent: 'first_open', definition: 'First launch after installation or reinstallation; this is the GA4/Firebase install proxy.' },
      uninstalls: { available: true, sourceEvent: 'app_remove', definition: 'App removal reported by Firebase for Android. iOS uninstall coverage is not provided by this event.' }
    }
  }
}

function mergeCrashTrend(crashRows, stabilityRows) {
  const byDate = new Map()
  for (const row of stabilityRows) byDate.set(row.date, { date: row.date, crashCount: 0, ...row })
  for (const row of crashRows) byDate.set(row.date, { date: row.date, crashAffectedUsers: 0, crashFreeUsersRate: 0, ...byDate.get(row.date), crashCount: row.eventCount || 0 })
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function previousDateRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) return null
  const days = Math.round((end - start) / 86400000) + 1
  const previousEnd = new Date(start.valueOf() - 86400000)
  const previousStart = new Date(previousEnd.valueOf() - (days - 1) * 86400000)
  return { startDate: previousStart.toISOString().slice(0, 10), endDate: previousEnd.toISOString().slice(0, 10) }
}

function mergeItemDetails(standardRows, customRows) {
  const normalize = value => value && value !== '(not set)' ? value : null
  const key = row => `${row.pagePath || row.itemListName || ''}\u0000${row.itemName}\u0000${row.itemId}`
  const customByItem = new Map(customRows.map(row => [key(row), row]))
  return standardRows.map(row => {
    const custom = customByItem.get(key(row)) || {}
    return {
      pagePath: normalize(row.pagePath),
      sourceName: normalize(row.itemListName),
      itemName: normalize(row.itemName), itemId: normalize(row.itemId), itemBrand: normalize(row.itemBrand),
      itemCategory: normalize(row.itemCategory), itemCategory2: normalize(row.itemCategory2), itemCategory3: normalize(row.itemCategory3), itemCategory5: normalize(row.itemCategory5),
      journey: normalize(custom['customItem:journey']), numberType: normalize(custom['customItem:number_type']), planId: normalize(custom['customItem:plan_id']),
      simType: normalize(custom['customItem:sim_type']), purchaseOption: normalize(custom['customItem:purchase_option']), itemsViewed: row.itemsViewed || 0
    }
  })
}

function productType(item) {
  const text = [item.pagePath, item.itemName, item.itemCategory, item.itemCategory2, item.itemCategory3, item.itemCategory5].filter(Boolean).join(' ').toLowerCase()
  if (/voucher|gift.?card|e-voucher/.test(text)) return 'Vouchers'
  if (/roaming/.test(text)) return 'Roaming plans'
  if (/booster|add.?on/.test(text)) return 'Boosters'
  if (/bundle/.test(text)) return 'Bundles'
  if (/\bplan\b|\bprep\b|\bpost\b/.test(text)) return 'Plans'
  return 'Other offers'
}

export async function productCatalogDashboard(settings, startDate = '28daysAgo', endDate = 'today', scope = 'all') {
  const normalizedScope = normalizeScope(scope)
  if (normalizedScope === 'all') {
    const [web, app] = await Promise.all([
      productCatalogDashboard(settings, startDate, endDate, 'web'),
      productCatalogDashboard(settings, startDate, endDate, 'app')
    ])
    const items = [...web.items, ...app.items]
    const vouchers = items.filter(item => item.productType === 'Vouchers')
    return {
      generatedAt: new Date().toISOString(), period: { startDate, endDate }, scope: 'all', items, vouchers,
      summary: {
        products: items.length,
        itemViews: items.reduce((sum, item) => sum + (item.itemsViewed || 0), 0),
        english: web.summary.english,
        arabic: web.summary.arabic,
        app: app.summary.products,
        vouchers: vouchers.length
      },
      coverage: {
        source: 'Combined GA4 view_item ecommerce item data from Web page paths and App item lists.',
        dataLossFromOtherRow: web.coverage.dataLossFromOtherRow || app.coverage.dataLossFromOtherRow,
        rowLimitReached: web.coverage.rowLimitReached || app.coverage.rowLimitReached
      }
    }
  }
  const isApp = normalizedScope === 'app'
  const pageFilter = { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'FULL_REGEXP', value: '^/(en|ar)(/|$)' } } }
  const itemFilter = isApp ? undefined : pageFilter
  const sourceDimension = isApp ? 'itemListName' : 'pagePath'
  const [standard, custom] = await Promise.all([
    query(settings, 'runReport', {
      dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, _scope: normalizedScope,
      dimensions: [sourceDimension, 'itemName', 'itemId', 'itemBrand', 'itemCategory', 'itemCategory2', 'itemCategory3', 'itemCategory5'].map(name => ({ name })),
      metrics: [{ name: 'itemsViewed' }], dimensionFilter: itemFilter,
      orderBys: [{ desc: true, metric: { metricName: 'itemsViewed' } }], limit: 100000
    }),
    query(settings, 'runReport', {
      dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, _scope: normalizedScope,
      dimensions: [sourceDimension, 'itemName', 'itemId', 'customItem:journey', 'customItem:number_type', 'customItem:plan_id', 'customItem:sim_type', 'customItem:purchase_option'].map(name => ({ name })),
      metrics: [{ name: 'itemsViewed' }], dimensionFilter: itemFilter,
      orderBys: [{ desc: true, metric: { metricName: 'itemsViewed' } }], limit: 100000
    })
  ])
  const items = mergeItemDetails(rows(standard), rows(custom)).map(item => ({
    ...item,
    platform: normalizedScope,
    language: isApp ? 'app' : item.pagePath?.match(/^\/(en|ar)(?:\/|$)/i)?.[1]?.toLowerCase() || 'other',
    productType: productType(item),
    pageUrl: item.pagePath ? `https://www.stc.com.kw${item.pagePath}` : null
  }))
  const vouchers = items.filter(item => item.productType === 'Vouchers')
  return {
    generatedAt: new Date().toISOString(), period: { startDate, endDate }, scope: normalizedScope, items, vouchers,
    summary: {
      products: items.length,
      itemViews: items.reduce((sum, item) => sum + (item.itemsViewed || 0), 0),
      english: items.filter(item => item.language === 'en').length,
      arabic: items.filter(item => item.language === 'ar').length,
      app: items.filter(item => item.platform === 'app').length,
      vouchers: vouchers.length
    },
    coverage: {
      source: isApp ? 'GA4 App view_item ecommerce item data grouped by item list.' : 'GA4 Web view_item ecommerce item data reported from /en and /ar website paths.',
      dataLossFromOtherRow: Boolean(standard.metadata?.dataLossFromOtherRow || custom.metadata?.dataLossFromOtherRow),
      rowLimitReached: Number(standard.rowCount || 0) > 100000 || Number(custom.rowCount || 0) > 100000
    }
  }
}

export async function qualityDashboard(settings, startDate = '28daysAgo', endDate = 'today', scope = 'all') {
  const common = { dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, _scope: scope }
  const comparisonPeriod = previousDateRange(startDate, endDate)
  const web = exactDimension('platform', 'web')
  const crashes = exactDimension('eventName', 'app_exception')
  const breakdown = async dimension => rows(await query(settings, 'runReport', {
    ...common,
    dimensions: [{ name: dimension }],
    metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
    dimensionFilter: crashes,
    orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }],
    limit: 50
  }))
  const webBreakdown = async dimension => rows(await query(settings, 'runReport', {
    ...common,
    dimensions: [{ name: dimension }],
    metrics: ['sessions', 'bounceRate', 'engagementRate', 'activeUsers'].map(name => ({ name })),
    dimensionFilter: web,
    orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
    limit: 50
  }))
  const pageBreakdown = async (range, limit = 50) => rows(await query(settings, 'runReport', {
    dateRanges: [range], keepEmptyRows: false, _scope: scope,
    dimensions: [{ name: 'pagePath' }],
    metrics: ['sessions', 'bounceRate', 'engagementRate', 'activeUsers', 'averageSessionDuration', 'screenPageViewsPerSession'].map(name => ({ name })),
    dimensionFilter: web,
    orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
    limit
  }))
  const [webSummary, currentPages, previousPages, devices, countries, sources, crashSummary, crashEvents, crashTrend, stabilityTrend, versions, operatingSystems, deviceModels] = await Promise.all([
    query(settings, 'runReport', { ...common, metrics: ['sessions', 'engagedSessions', 'bounceRate', 'engagementRate', 'averageSessionDuration'].map(name => ({ name })), dimensionFilter: web, metricAggregations: ['TOTAL'] }),
    pageBreakdown({ startDate, endDate }), comparisonPeriod ? pageBreakdown(comparisonPeriod, 250) : Promise.resolve([]),
    webBreakdown('deviceCategory'), webBreakdown('country'), webBreakdown('sessionSourceMedium'),
    query(settings, 'runReport', { ...common, metrics: ['crashAffectedUsers', 'crashFreeUsersRate', 'activeUsers'].map(name => ({ name })), metricAggregations: ['TOTAL'] }),
    query(settings, 'runReport', { ...common, metrics: ['eventCount', 'totalUsers'].map(name => ({ name })), dimensionFilter: crashes, metricAggregations: ['TOTAL'] }),
    query(settings, 'runReport', { ...common, dimensions: [{ name: 'date' }], metrics: [{ name: 'eventCount' }], dimensionFilter: crashes, orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 366 }),
    query(settings, 'runReport', { ...common, dimensions: [{ name: 'date' }], metrics: ['crashAffectedUsers', 'crashFreeUsersRate'].map(name => ({ name })), orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 366 }),
    breakdown('appVersion'), breakdown('operatingSystem'), breakdown('deviceModel')
  ])
  const previousByPage = new Map(previousPages.map(row => [row.pagePath, row]))
  const pages = currentPages.map(row => ({ ...row, previous: previousByPage.get(row.pagePath) || null }))
  const crashTotals = total(crashEvents)
  return {
    generatedAt: new Date().toISOString(), period: { startDate, endDate }, comparisonPeriod,
    web: { summary: total(webSummary), pages, devices, countries, sources },
    crashes: {
      summary: { ...total(crashSummary), crashCount: crashTotals.eventCount || 0, eventUsers: crashTotals.totalUsers || 0 },
      trend: mergeCrashTrend(rows(crashTrend), rows(stabilityTrend)), versions, operatingSystems, deviceModels,
      topIssues: [],
      issueCoverage: 'GA4 provides app_exception totals and stability metrics, but not Crashlytics issue titles or stack traces. Connect Firebase Crashlytics for issue-level diagnostics.'
    }
  }
}

function parseSitemap(xml) {
  const decode = value => value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'")
  return [...xml.matchAll(/<url>\s*([\s\S]*?)<\/url>/gi)].map(match => {
    const block = match[1]
    return {
      url: decode(block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1] || ''),
      lastModified: block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1] || null
    }
  }).filter(item => item.url)
}

function isPublicPagePath(value) {
  const path = String(value || '')
  return path.startsWith('/') && !/^\/(?:selfcare)(?:\/|$)/i.test(path) && !/\b\d{7,8}\b|\bundefined\b/i.test(path) && !/^\((?:not set|other)\)$/i.test(path)
}

function applyUrlHistory(urls, history, now = new Date().toISOString()) {
  const initialized = Boolean(history?.initializedAt)
  const records = history?.urls || {}
  const week = 7 * 86400000
  const enriched = urls.map(item => {
    const record = records[item.url] || { firstSeen: now, baseline: !initialized }
    records[item.url] = record
    return { ...item, firstSeen: record.firstSeen, isNew: !record.baseline && Date.parse(now) - Date.parse(record.firstSeen) <= week, googleFirstSeen: null }
  })
  return { urls: enriched, history: { initializedAt: history?.initializedAt || now, updatedAt: now, urls: records } }
}

export async function urlInventoryDashboard(settings, startDate = '28daysAgo', endDate = 'today', scope = 'all') {
  const [sitemapResponse, ga4Report] = await Promise.all([
    fetch('https://www.stc.com.kw/sitemap.xml', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EventScope/1.0)', Accept: 'application/xml,text/xml,*/*' } }),
    query(settings, 'runReport', {
      dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, _scope: scope,
      dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: ['screenPageViews', 'activeUsers', 'sessions'].map(name => ({ name })), dimensionFilter: exactDimension('platform', 'web'),
      orderBys: [{ desc: true, metric: { metricName: 'screenPageViews' } }], limit: 100000
    })
  ])
  if (!sitemapResponse.ok) throw new Error(`STC sitemap request failed (${sitemapResponse.status}).`)
  const sitemap = parseSitemap(await sitemapResponse.text())
  const inventory = new Map(sitemap.map(item => {
    const parsed = new URL(item.url)
    return [parsed.pathname.replace(/\/$/, '') || '/', { ...item, path: parsed.pathname, language: parsed.pathname.match(/^\/(en|ar)(?:\/|$)/i)?.[1]?.toLowerCase() || 'other', inSitemap: true, screenPageViews: 0, activeUsers: 0, sessions: 0 }]
  }))
  for (const row of rows(ga4Report)) {
    if (!isPublicPagePath(row.pagePath)) continue
    const key = (row.pagePath || '/').replace(/\/$/, '') || '/'
    const item = inventory.get(key) || { url: `https://www.stc.com.kw${row.pagePath || '/'}`, path: row.pagePath || '/', language: row.pagePath?.match(/^\/(en|ar)(?:\/|$)/i)?.[1]?.toLowerCase() || 'other', lastModified: null, inSitemap: false }
    inventory.set(key, { ...item, pageTitle: row.pageTitle, screenPageViews: row.screenPageViews || 0, activeUsers: row.activeUsers || 0, sessions: row.sessions || 0 })
  }
  const urls = [...inventory.values()].sort((a, b) => (b.screenPageViews || 0) - (a.screenPageViews || 0) || a.url.localeCompare(b.url))
  return {
    generatedAt: new Date().toISOString(), period: { startDate, endDate }, urls,
    summary: { total: urls.length, sitemap: sitemap.length, ga4Active: urls.filter(item => item.screenPageViews > 0).length, en: urls.filter(item => item.language === 'en').length, ar: urls.filter(item => item.language === 'ar').length },
    searchConsole: { connected: false, reason: 'The dashboard service account does not have access to a Google Search Console property for stc.com.kw.' }
  }
}

function normalizeTrackedPage(value, fallbackLanguage = 'en') {
  const fallback = `https://www.stc.com.kw/${fallbackLanguage === 'ar' ? 'ar' : 'en'}/prepaid-plans`
  let parsed
  try {
    parsed = new URL(String(value || fallback).trim(), 'https://www.stc.com.kw')
  } catch {
    const error = new Error('Enter a valid STC page URL or path.')
    error.status = 400
    throw error
  }
  const hostname = parsed.hostname.toLowerCase()
  if (parsed.protocol !== 'https:' || (hostname !== 'stc.com.kw' && !hostname.endsWith('.stc.com.kw'))) {
    const error = new Error('The URL must be an HTTPS page on stc.com.kw.')
    error.status = 400
    throw error
  }
  const path = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
  const routeLanguage = path.match(/^\/(en|ar)(?:\/|$)/i)?.[1]?.toLowerCase() || 'other'
  return { url: `https://${hostname}${path}`, path, routeLanguage }
}

export async function pageJourneyDashboard(settings, { startDate = '28daysAgo', endDate = 'today', language = 'en', url, scope = 'all' } = {}) {
  const trackedPage = normalizeTrackedPage(url, language)
  const { path, routeLanguage } = trackedPage
  const common = { dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, dimensionFilter: exactDimension('pagePath', path), _scope: scope }

  const itemViewFilter = { andGroup: { expressions: [exactDimension('pagePath', path), exactDimension('eventName', 'view_item')] } }
  const itemScope = normalizeScope(scope) === 'app' ? null : 'all'
  const [summary, pageTitles, events, acquisition, browserLanguages, successFunnel, failureFunnel, standardItems, customItems] = await Promise.all([
    query(settings, 'runReport', {
      ...common,
      metrics: ['screenPageViews', 'activeUsers', 'sessions', 'eventCount', 'keyEvents'].map(name => ({ name }))
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'pageTitle' }],
      metrics: [{ name: 'screenPageViews' }],
      orderBys: [{ desc: true, metric: { metricName: 'screenPageViews' } }],
      limit: 10
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'eventName' }],
      metrics: ['eventCount', 'totalUsers', 'keyEvents'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }],
      limit: 100
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'sessionSourceMedium' }, { name: 'sessionCampaignName' }],
      metrics: ['sessions', 'activeUsers', 'keyEvents'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
      limit: 50
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: [{ name: 'language' }],
      metrics: ['activeUsers', 'sessions'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'activeUsers' } }],
      limit: 20
    }),
    runJourneyFunnel(settings, startDate, endDate, path, 'Completed purchase', ['purchase'], scope),
    runJourneyFunnel(settings, startDate, endDate, path, 'Purchase failed or cancelled', ['purchase_failed', 'failed_purchase', 'cancelled_purchase'], scope),
    itemScope ? query(settings, 'runReport', {
      dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, _scope: scope,
      dimensions: ['itemName', 'itemId', 'itemBrand', 'itemCategory', 'itemCategory2', 'itemCategory3', 'itemCategory5'].map(name => ({ name })),
      metrics: [{ name: 'itemsViewed' }], dimensionFilter: itemViewFilter,
      orderBys: [{ desc: true, metric: { metricName: 'itemsViewed' } }], limit: 250, _scope: itemScope
    }) : Promise.resolve({}),
    itemScope ? query(settings, 'runReport', {
      dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, _scope: scope,
      dimensions: ['itemName', 'itemId', 'customItem:journey', 'customItem:number_type', 'customItem:plan_id', 'customItem:sim_type', 'customItem:purchase_option'].map(name => ({ name })),
      metrics: [{ name: 'itemsViewed' }], dimensionFilter: itemViewFilter,
      orderBys: [{ desc: true, metric: { metricName: 'itemsViewed' } }], limit: 250, _scope: itemScope
    }) : Promise.resolve({})
  ])

  const titles = rows(pageTitles)
  const primaryTitle = titles[0]?.pageTitle || null
  let realtime = { available: false, reason: 'No page title was reported for this route.', activeUsers: null, views: null }
  if (primaryTitle) {
    const live = await query(settings, 'runRealtimeReport', {
      dimensions: [{ name: 'unifiedScreenName' }],
      metrics: ['activeUsers', 'screenPageViews'].map(name => ({ name })),
      dimensionFilter: exactDimension('unifiedScreenName', primaryTitle),
      limit: 10, _scope: scope
    })
    const liveRows = rows(live)
    realtime = {
      available: true,
      matchedTitle: primaryTitle,
      activeUsers: liveRows.reduce((sum, row) => sum + (row.activeUsers || 0), 0),
      views: liveRows.reduce((sum, row) => sum + (row.screenPageViews || 0), 0)
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    period: { startDate, endDate },
    language: routeLanguage,
    page: { path, url: trackedPage.url, hostname: new URL(trackedPage.url).hostname, titles },
    summary: total(summary),
    realtime,
    successFunnel: successFunnel.steps,
    failureFunnel: failureFunnel.steps,
    funnelSampling: { success: successFunnel.sampling, failure: failureFunnel.sampling },
    events: rows(events),
    itemDetails: mergeItemDetails(rows(standardItems), rows(customItems)),
    itemCoverage: {
      event: 'view_item',
      standardDataLossFromOtherRow: Boolean(standardItems.metadata?.dataLossFromOtherRow),
      sampling: customItems.metadata?.samplingMetadatas?.[0] || null
    },
    acquisition: rows(acquisition),
    browserLanguages: rows(browserLanguages),
    methodology: {
      funnel: 'Closed user funnel. Each step must occur after the prior step and within 30 minutes.',
      entry: `page_view on ${path}`,
      realtime: primaryTitle ? `Matched by realtime page/screen title: ${primaryTitle}` : 'Unavailable because the route has no reported page title.'
    }
  }
}

export async function journeyMonitoringDashboard(settings, startDate = '28daysAgo', endDate = 'today', scope = 'all') {
  const common = { dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, dimensionFilter: inListDimension('eventName', journeyFailureEvents), _scope: scope }
  const [summaryReport, detailReport] = await Promise.all([query(settings, 'runReport', {
    ...common,
    dimensions: ['eventName', 'pagePath', 'pageTitle'].map(name => ({ name })),
    metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
    orderBys: [{ desc: true, metric: { metricName: 'totalUsers' } }], limit: 1000
  }), query(settings, 'runReport', {
    ...common,
    dimensions: ['dateHourMinute', 'eventName', 'unifiedPagePathScreen', 'unifiedScreenName', 'transactionId'].map(name => ({ name })),
    metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
    orderBys: [{ desc: true, dimension: { dimensionName: 'dateHourMinute' } }], limit: 10000
  })])
  const normalize = value => value && value !== '(not set)' ? value : null
  const issues = rows(detailReport).map(row => {
    const [step, issue] = journeyFailureDetails[row.eventName] || ['Journey', row.eventName]
    return { ...row, step, issue, pagePath: normalize(row.unifiedPagePathScreen), pageTitle: normalize(row.unifiedScreenName), transactionId: normalize(row.transactionId), itemName: normalize(row.itemName), itemId: normalize(row.itemId) }
  })
  const summaryRows = rows(summaryReport)
  return {
    generatedAt: new Date().toISOString(), period: { startDate, endDate }, issues,
    summary: {
      issueRows: issues.length,
      affectedUserReports: summaryRows.reduce((sum, row) => sum + (row.totalUsers || 0), 0),
      failureEvents: summaryRows.reduce((sum, row) => sum + (row.eventCount || 0), 0),
      failedPayments: summaryRows.filter(row => ['purchase_failed', 'failed_purchase', 'cancelled_purchase', 'failed_added_card', 'spend_points_failed'].includes(row.eventName)).reduce((sum, row) => sum + (row.eventCount || 0), 0)
    },
    coverage: { timestamp: 'Minute-level aggregate in the GA4 property timezone.', userDetails: 'Personal user details are not available from the GA4 Data API and must not be sent to Google Analytics.', commerce: 'Transaction references appear when transaction_id is collected. Plan and product details require a compatible registered event dimension or BigQuery event export.' }
  }
}

const overviewPurchaseEvents = ['purchase', 'purchase_prepaid', 'purchase_prepaid_bundle', 'purchase_postpaid', 'purchase_addon', 'purchase_roaming', 'purchased_voucher', 'purchased_device', 'purchase_vas']
const expectedPurchaseTypes = ['Plans', 'Bundles', 'Vouchers', 'Boosters', 'Add-ons', 'Roaming plans', 'Roaming bundles', 'Devices', 'Qitaf']

function overviewJourney(pagePath = '', eventName = '') {
  const text = `${pagePath} ${eventName}`.toLowerCase()
  if (text.includes('voucher')) return 'Voucher'
  if (text.includes('roaming')) return 'Roaming'
  if (text.includes('postpaid-internet')) return 'Postpaid internet'
  if (text.includes('youth-postpaid')) return 'Youth postpaid'
  if (text.includes('vip-postpaid')) return 'VIP postpaid'
  if (text.includes('postpaid')) return 'Postpaid'
  if (text.includes('device') || text.includes('smartphone') || text.includes('router') || text.includes('tablet') || text.includes('gaming') || text.includes('accessor')) return 'Device purchase'
  if (text.includes('prepaid') || text.includes('gnl')) return 'Prepaid GNL'
  return 'Other / context unavailable'
}

function overviewProductType(row) {
  const text = [row.eventName, row.itemName, row.itemCategory, row.itemCategory2, row.itemCategory3].filter(Boolean).join(' ').toLowerCase()
  if (text.includes('voucher')) return 'Vouchers'
  if (text.includes('booster')) return 'Boosters'
  if (text.includes('addon') || text.includes('add-on') || text.includes('vas')) return 'Add-ons'
  if (text.includes('roaming') && (text.includes('bundle') || text.includes('pack'))) return 'Roaming bundles'
  if (text.includes('roaming')) return 'Roaming plans'
  if (text.includes('bundle')) return 'Bundles'
  if (text.includes('device') || text.includes('phone') || text.includes('iphone') || text.includes('samsung') || text.includes('router') || text.includes('tablet') || text.includes('accessor') || row.eventName === 'purchased_device') return 'Devices'
  return 'Plans'
}

export async function mainOverviewDashboard(settings, startDate = '28daysAgo', endDate = 'today', scope = 'all') {
  const common = { dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, _scope: scope }
  const requests = await Promise.allSettled([
    query(settings, 'runReport', {
      ...common,
      dimensions: ['dateHourMinute', 'eventName', 'unifiedPagePathScreen', 'unifiedScreenName'].map(name => ({ name })),
      metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
      dimensionFilter: inListDimension('eventName', journeyFailureEvents),
      orderBys: [{ desc: true, dimension: { dimensionName: 'dateHourMinute' } }], limit: 500
    }),
    query(settings, 'runReport', {
      ...common, dimensions: [{ name: 'eventName' }], metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
      dimensionFilter: inListDimension('eventName', overviewPurchaseEvents),
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }], limit: 100
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: ['eventName', 'itemName', 'itemId', 'itemBrand', 'itemVariant', 'itemCategory', 'itemCategory2', 'itemCategory3'].map(name => ({ name })),
      metrics: ['itemsPurchased', 'itemRevenue'].map(name => ({ name })),
      dimensionFilter: inListDimension('eventName', overviewPurchaseEvents),
      orderBys: [{ desc: true, metric: { metricName: 'itemsPurchased' } }], limit: 5000
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: ['eventName', 'itemName', 'itemId', 'itemBrand', 'itemVariant', 'itemCategory', 'itemCategory2', 'itemCategory3'].map(name => ({ name })),
      metrics: ['itemsPurchased', 'itemRevenue'].map(name => ({ name })),
      dimensionFilter: inListDimension('eventName', overviewPurchaseEvents),
      orderBys: [{ desc: false, metric: { metricName: 'itemsPurchased' } }], limit: 5000
    }),
    query(settings, 'runReport', {
      ...common, dimensions: ['platform', 'operatingSystem', 'eventName'].map(name => ({ name })),
      metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
      dimensionFilter: inListDimension('eventName', ['first_open', 'app_remove']), limit: 100
    }),
    query(settings, 'runReport', {
      ...common, dimensions: ['pagePath', 'pageTitle'].map(name => ({ name })),
      metrics: ['screenPageViews', 'activeUsers'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'screenPageViews' } }], limit: 20
    }),
    query(settings, 'runReport', {
      ...common, dimensions: ['country', 'region'].map(name => ({ name })),
      metrics: ['activeUsers', 'ecommercePurchases'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'activeUsers' } }], limit: 100
    }),
    query(settings, 'runReport', {
      ...common, dimensions: [{ name: 'userAgeBracket' }],
      metrics: ['activeUsers', 'ecommercePurchases'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'activeUsers' } }], limit: 20
    }),
    query(settings, 'runReport', {
      ...common, dimensions: ['searchTerm', 'country', 'region', 'platform'].map(name => ({ name })),
      metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
      dimensionFilter: exactDimension('eventName', 'view_search_results'),
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }], limit: 5000
    }),
    query(settings, 'runReport', {
      ...common, dimensions: ['sessionManualTerm', 'sessionSource', 'sessionMedium', 'country', 'region'].map(name => ({ name })),
      metrics: ['sessions', 'activeUsers', 'ecommercePurchases'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 5000
    }),
    query(settings, 'runReport', {
      ...common, dimensions: [{ name: 'eventName' }],
      metrics: ['eventCount', 'totalUsers'].map(name => ({ name })),
      dimensionFilter: inListDimension('eventName', ['joined_qitaf', 'earned_points', 'spend_points_activated']),
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }], limit: 20
    })
  ])
  const reportRows = index => requests[index].status === 'fulfilled' ? rows(requests[index].value) : []
  const unavailable = (index, label) => requests[index].status === 'rejected' ? `${label}: ${requests[index].reason.message}` : null
  const failures = reportRows(0).map(row => {
    const [step, issue] = journeyFailureDetails[row.eventName] || ['Journey', row.eventName]
    return { ...row, journey: overviewJourney(row.unifiedPagePathScreen, row.eventName), step, issue, pagePath: row.unifiedPagePathScreen && row.unifiedPagePathScreen !== '(not set)' ? row.unifiedPagePathScreen : null }
  })
  const purchaseEvents = reportRows(1)
  const rawPurchasedItems = [...reportRows(2), ...reportRows(3)].map(row => ({ ...row, productType: overviewProductType(row), journey: overviewJourney('', row.eventName) }))
  const purchasedItemMap = new Map()
  for (const row of rawPurchasedItems) {
    const key = [row.productType, row.itemName, row.itemVariant, row.itemId, row.itemBrand, row.itemCategory, row.itemCategory2, row.itemCategory3].join('\u0000')
    const current = purchasedItemMap.get(key) || { ...row, itemsPurchased: 0, itemRevenue: 0 }
    current.itemsPurchased += row.itemsPurchased || 0
    current.itemRevenue += row.itemRevenue || 0
    purchasedItemMap.set(key, current)
  }
  const qitafLabels = { joined_qitaf: 'Joined Qitaf', earned_points: 'Earned Qitaf points', spend_points_activated: 'Spent Qitaf points' }
  const qitafItems = reportRows(10).map(row => ({ ...row, productType: 'Qitaf', journey: 'Qitaf', itemName: qitafLabels[row.eventName] || row.eventName, itemId: row.eventName, itemBrand: 'Qitaf', itemCategory: 'Loyalty', itemVariant: null, itemsPurchased: row.eventCount || 0, itemRevenue: 0 }))
  const purchasedItems = [...purchasedItemMap.values(), ...qitafItems].sort((a, b) => (b.itemsPurchased || 0) - (a.itemsPurchased || 0))
  const purchaseTypeRows = purchasedItems.length ? purchasedItems : purchaseEvents.map(row => ({ ...row, itemsPurchased: row.eventCount, productType: overviewProductType(row) }))
  const purchaseTypes = purchaseTypeRows
    .reduce((map, row) => map.set(row.productType, (map.get(row.productType) || 0) + (row.itemsPurchased || 0)), new Map())
  const lifecycle = reportRows(4)
  const lifecycleCount = (os, eventName) => lifecycle.filter(row => row.eventName === eventName && (!os || `${row.operatingSystem} ${row.platform}`.toLowerCase().includes(os))).reduce((sum, row) => sum + (row.eventCount || 0), 0)
  const lifecycleUsers = (os, eventName) => lifecycle.filter(row => row.eventName === eventName && (!os || `${row.operatingSystem} ${row.platform}`.toLowerCase().includes(os))).reduce((sum, row) => sum + (row.totalUsers || 0), 0)
  return {
    generatedAt: new Date().toISOString(), period: { startDate, endDate },
    summary: {
      failureEvents: failures.reduce((sum, row) => sum + (row.eventCount || 0), 0),
      purchases: purchaseEvents.reduce((sum, row) => sum + (row.eventCount || 0), 0),
      installs: lifecycleCount('', 'first_open'), uninstalls: lifecycleCount('', 'app_remove')
    },
    failures,
    purchases: expectedPurchaseTypes.map(productType => ({ productType, count: purchaseTypes.get(productType) || 0 })),
    purchaseEvents,
    salesItems: purchasedItems,
    devices: purchasedItems.filter(row => row.productType === 'Devices').sort((a, b) => (b.itemsPurchased || 0) - (a.itemsPurchased || 0)),
    appActivity: {
      android: { installs: lifecycleCount('android', 'first_open'), installUsers: lifecycleUsers('android', 'first_open'), uninstalls: lifecycleCount('android', 'app_remove'), uninstallUsers: lifecycleUsers('android', 'app_remove') },
      ios: { installs: lifecycleCount('ios', 'first_open'), installUsers: lifecycleUsers('ios', 'first_open'), uninstalls: lifecycleCount('ios', 'app_remove'), uninstallUsers: lifecycleUsers('ios', 'app_remove') }
    },
    engagement: reportRows(5).filter(row => row.pagePath && !['(not set)', '(other)'].includes(row.pagePath)).map(row => ({ ...row, journey: overviewJourney(row.pagePath) })),
    customers: { locations: reportRows(6), ages: reportRows(7), nationality: [] },
    keywords: {
      siteSearch: reportRows(8).filter(row => row.searchTerm && !['(not set)', '(other)'].includes(row.searchTerm)),
      paidSearch: reportRows(9).filter(row => row.sessionManualTerm && !['(not set)', '(other)', '(not provided)'].includes(row.sessionManualTerm) && String(row.sessionMedium).toLowerCase() !== 'organic')
    },
    availability: {
      failures: unavailable(0, 'Failure detail'), purchases: unavailable(1, 'Purchase events'), devices: rawPurchasedItems.length ? null : (unavailable(2, 'Top purchased-item detail') || unavailable(3, 'Low purchased-item detail')),
      appActivity: unavailable(4, 'App lifecycle'), engagement: unavailable(5, 'Engagement'), locations: unavailable(6, 'Country and region'), ages: unavailable(7, 'Age group'),
      siteSearch: unavailable(8, 'On-site search terms'), paidSearch: unavailable(9, 'Paid campaign terms'),
      qitaf: unavailable(10, 'Qitaf completion events'),
      googleOrganicSearch: 'Google organic search queries require the Google Search Console Search Analytics API. GA4 does not expose organic query text.',
      nationality: 'Nationality is not a standard GA4 dimension. It will remain unavailable unless collected as a consented, registered custom dimension.'
    }
  }
}

export async function campaignMonitoringDashboard(settings, startDate = '28daysAgo', endDate = 'today', scope = 'all') {
  const common = { dateRanges: dateRange(startDate, endDate), keepEmptyRows: false, _scope: scope }
  const [campaigns, trend] = await Promise.all([
    query(settings, 'runReport', {
      ...common,
      dimensions: ['sessionCampaignId', 'sessionCampaignName', 'sessionSource', 'sessionMedium', 'sessionManualAdContent', 'sessionManualTerm', 'landingPagePlusQueryString'].map(name => ({ name })),
      metrics: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents', 'ecommercePurchases', 'totalRevenue'].map(name => ({ name })),
      orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 10000
    }),
    query(settings, 'runReport', {
      ...common,
      dimensions: ['date', 'sessionCampaignName'].map(name => ({ name })),
      metrics: ['sessions', 'activeUsers', 'ecommercePurchases'].map(name => ({ name })),
      orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 10000
    })
  ])
  const hasCampaignValue = value => value && !['(not set)', '(direct)', '(other)'].includes(String(value).toLowerCase())
  const campaignRows = rows(campaigns).filter(row => hasCampaignValue(row.sessionCampaignName) || hasCampaignValue(row.sessionCampaignId))
  return {
    generatedAt: new Date().toISOString(), period: { startDate, endDate },
    summary: {
      trackedRows: campaignRows.length,
      sessions: campaignRows.reduce((sum, row) => sum + (row.sessions || 0), 0),
      users: campaignRows.reduce((sum, row) => sum + (row.activeUsers || 0), 0),
      purchases: campaignRows.reduce((sum, row) => sum + (row.ecommercePurchases || 0), 0),
      revenue: campaignRows.reduce((sum, row) => sum + (row.totalRevenue || 0), 0)
    },
    campaigns: campaignRows,
    trend: rows(trend).filter(row => hasCampaignValue(row.sessionCampaignName)),
    definitions: {
      tracked: 'GA4 rows represent sessions attributed to reported campaign dimensions during the selected period.',
      registry: 'Registered production links remain listed even when GA4 has not yet reported traffic.'
    }
  }
}

export { applyUrlHistory, combineDimensionFilters, funnelDefinitions, isPublicPagePath, journeyFailureEvents, mergeCrashTrend, mergeItemDetails, normalizePropertyId, normalizeScope, normalizeTrackedPage, parseSitemap, platformDimension, previousDateRange, productType, validateServiceAccount }
