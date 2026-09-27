import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const DASHBOARDS = ['overview','journey','plans-items','journey-monitoring','funnels','lifecycle','adjust','comparison','quality','campaigns','urls','assistant']
const sessions = new Map()

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  if (String(password).length < 5) throw new Error('Password must contain at least 5 characters.')
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`
}

export function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':')
  if (!salt || !expected) return false
  const actual = crypto.scryptSync(String(password), salt, 64)
  const target = Buffer.from(expected, 'hex')
  return target.length === actual.length && crypto.timingSafeEqual(target, actual)
}

const publicUser = user => ({ id: user.id, username: user.username, displayName: user.displayName, role: user.role, active: user.active, dashboards: user.role === 'super_admin' ? DASHBOARDS : user.dashboards, createdAt: user.createdAt })
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(value => value.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2))

export function createAuth(privateDir) {
  const usersPath = path.join(privateDir, 'users.json')
  const requestsPath = path.join(privateDir, 'access-requests.json')
  const read = async (file, fallback) => { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error } }
  const write = async (file, value) => { await fs.mkdir(privateDir, { recursive: true }); await fs.writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 }) }
  const ensureAdmin = async () => {
    const users = await read(usersPath, [])
    if (!users.some(user => user.username === 'arjun.sajimon')) {
      const initialPassword = process.env.INITIAL_ADMIN_PASSWORD
      if (!initialPassword) throw new Error('INITIAL_ADMIN_PASSWORD is required to create the first Super Admin.')
      users.push({ id: crypto.randomUUID(), username: 'arjun.sajimon', displayName: 'Arjun Sajimon', passwordHash: hashPassword(initialPassword), role: 'super_admin', active: true, dashboards: DASHBOARDS, createdAt: new Date().toISOString() })
      await write(usersPath, users)
    }
    return users
  }
  const current = async req => {
    const id = sessions.get(cookies(req).eventscope_session)
    if (!id) return null
    return (await ensureAdmin()).find(user => user.id === id && user.active) || null
  }
  const requireUser = async (req, res, next) => { const user = await current(req); if (!user) return res.status(401).json({ error: 'Sign in is required.' }); req.user = user; next() }
  const requireAdmin = (req, res, next) => req.user?.role === 'super_admin' ? next() : res.status(403).json({ error: 'Super Admin access is required.' })
  const canAccess = (user, dashboard) => user.role === 'super_admin' || user.dashboards?.includes(dashboard)
  const dashboardsForPath = pathName => ({
    '/dashboard':['overview'],'/main-overview':['overview'],'/realtime':['overview'],'/page-journey':['journey'],'/products-items':['plans-items'],
    '/journey-monitoring':['journey-monitoring'],'/prepaid-gnl-funnel':['funnels'],'/funnels':['funnels'],'/app-lifecycle':['lifecycle','comparison'],
    '/adjust-installs':['adjust','comparison'],'/quality':['quality'],'/campaigns':['campaigns'],'/url-inventory':['urls']
  })[pathName]

  const routes = app => {
    app.get('/api/auth/session', async (req, res) => { const user = await current(req); res.json({ authenticated: Boolean(user), user: user ? publicUser(user) : null }) })
    app.post('/api/auth/login', async (req, res) => {
      const user = (await ensureAdmin()).find(item => item.username.toLowerCase() === String(req.body.username || '').trim().toLowerCase())
      if (!user || !user.active || !verifyPassword(req.body.password, user.passwordHash)) return res.status(401).json({ error: 'Username or password is incorrect.' })
      const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, user.id)
      res.setHeader('Set-Cookie', `eventscope_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`)
      res.json({ authenticated: true, user: publicUser(user) })
    })
    app.post('/api/auth/logout', async (req, res) => { sessions.delete(cookies(req).eventscope_session); res.setHeader('Set-Cookie', 'eventscope_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ ok: true }) })
    app.post('/api/auth/access-requests', async (req, res) => {
      const username = String(req.body.username || '').trim().toLowerCase(); const displayName = String(req.body.displayName || '').trim(); const note = String(req.body.note || '').trim()
      if (!/^[a-z0-9._-]{3,64}$/.test(username) || !displayName) return res.status(400).json({ error: 'Enter a valid name and requested username.' })
      const requests = await read(requestsPath, [])
      requests.unshift({ id: crypto.randomUUID(), username, displayName, note: note.slice(0, 500), status: 'pending', createdAt: new Date().toISOString() })
      await write(requestsPath, requests); res.status(201).json({ ok: true })
    })
    app.use('/api', requireUser)
    app.use('/api', (req, res, next) => {
      if ((req.path.startsWith('/settings') || req.path === '/adjust-settings' || (req.path === '/campaigns' && req.method !== 'GET')) && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Super Admin access is required.' })
      const dashboards = dashboardsForPath(req.path)
      return !dashboards || dashboards.some(dashboard => canAccess(req.user, dashboard)) ? next() : res.status(403).json({ error: 'You do not have access to this dashboard.' })
    })
    app.get('/api/admin/users', requireAdmin, async (req, res) => res.json({ users: (await ensureAdmin()).map(publicUser), requests: await read(requestsPath, []) }))
    app.post('/api/admin/requests/:id/approve', requireAdmin, async (req, res) => {
      const requests = await read(requestsPath, []); const accessRequest = requests.find(item => item.id === req.params.id && item.status === 'pending')
      if (!accessRequest) return res.status(404).json({ error: 'Pending access request was not found.' })
      const users = await ensureAdmin(); if (users.some(user => user.username === accessRequest.username)) return res.status(409).json({ error: 'That username already exists.' })
      const dashboards = DASHBOARDS.filter(item => req.body.dashboards?.includes(item))
      users.push({ id: crypto.randomUUID(), username: accessRequest.username, displayName: accessRequest.displayName, passwordHash: hashPassword(req.body.password), role: 'viewer', active: true, dashboards, createdAt: new Date().toISOString() })
      accessRequest.status = 'approved'; accessRequest.decidedAt = new Date().toISOString(); accessRequest.decidedBy = req.user.username
      await Promise.all([write(usersPath, users), write(requestsPath, requests)]); res.json({ ok: true })
    })
    app.post('/api/admin/requests/:id/reject', requireAdmin, async (req, res) => {
      const requests = await read(requestsPath, []); const accessRequest = requests.find(item => item.id === req.params.id && item.status === 'pending')
      if (!accessRequest) return res.status(404).json({ error: 'Pending access request was not found.' })
      accessRequest.status = 'rejected'; accessRequest.decidedAt = new Date().toISOString(); accessRequest.decidedBy = req.user.username; await write(requestsPath, requests); res.json({ ok: true })
    })
    app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
      const users = await ensureAdmin(); const user = users.find(item => item.id === req.params.id)
      if (!user) return res.status(404).json({ error: 'User was not found.' }); if (user.role === 'super_admin') return res.status(400).json({ error: 'The Super Admin account cannot be restricted.' })
      user.active = req.body.active !== false; user.dashboards = DASHBOARDS.filter(item => req.body.dashboards?.includes(item)); await write(usersPath, users); res.json({ user: publicUser(user) })
    })
    app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
      const users = await ensureAdmin(); const user = users.find(item => item.id === req.params.id)
      if (!user) return res.status(404).json({ error: 'User was not found.' }); user.passwordHash = hashPassword(req.body.password); await write(usersPath, users); res.json({ ok: true })
    })
  }
  return { routes, DASHBOARDS }
}
