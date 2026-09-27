# GA4 Event Monitor

A standalone GA4 dashboard for realtime and historical website events. It does not modify or depend on the QRLy application.

## Included views

- Property overview with realtime activity, historical trends, events, devices, traffic sources, countries, and CSV export.
- URL Journey Analyzer for any HTTPS page on `stc.com.kw`, with the prepaid English and Arabic pages as the default example.
- mySTC app lifecycle dashboard using GA4/Firebase `first_open` and Android `app_remove` events.
- Dashboard-wide 7-day, 28-day, 90-day, and custom From-To reporting periods.
- CSV export for the active Property Overview, URL Journey Analyzer, or mySTC App Lifecycle dashboard.
- Automatic realtime polling is paused to protect the GA4 hourly property-token quota; use the dashboard Refresh button when needed.
- Adjust Report Service connection with attributed installs, reattributions, clicks, impressions, apps/platforms, networks, campaigns, date filtering, and CSV export.
- GA4 vs Adjust comparison dashboard with daily and platform install variance plus combined CSV export.
- Private analytics assistant for natural-language questions across the loaded GA4, journey, lifecycle, Adjust, and comparison reports, with transcript export.
- Closed 30-minute purchase-completion and failure/cancellation funnels.
- Page-level source/medium, campaign, browser-language, event, session, user, and realtime metrics.

Funnel reports use the Google Analytics Data API v1alpha and can be sampled on high-volume properties. The dashboard shows the current sampling rate beside the affected funnels. Page-event counts are displayed separately because they are not equivalent to ordered funnel completions.

## Run locally

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start
```

Open `http://127.0.0.1:4777`.

## Connect Google Analytics

1. Enable **Google Analytics Data API v1** in the service account's Google Cloud project.
2. In GA4, add the service account email to the property with **Viewer** access.
3. Open Settings in the dashboard.
4. Enter the numeric GA4 Property ID and service-account JSON.
5. Test, then save the connection.

Credentials are encrypted with AES-256-GCM under `.private/`. That directory is ignored by Git. Keep the entire `.private/` directory private and back it up together; the encrypted settings cannot be read without its generated key.

## Hostinger production

Build command: `npm ci && npm run build`

Start command: `npm start`

Required environment variables:

```text
NODE_ENV=production
HOST=0.0.0.0
INITIAL_ADMIN_PASSWORD=<set in Hostinger; never commit it>
EVENTSCOPE_DATA_DIR=<persistent private directory outside the release>
```

The public health check is `/api/health`. All analytics APIs require an authenticated user and dashboard permission. TLS makes the login cookie `Secure`; user passwords use salted `scrypt` hashes and are never returned by the API.
