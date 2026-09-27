import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const privateDir = path.resolve(process.env.EVENTSCOPE_DATA_DIR || path.join(root, '.private'))
const keyPath = path.join(privateDir, 'encryption.key')
const settingsPath = path.join(privateDir, 'ga4-settings.enc.json')
const urlHistoryPath = path.join(privateDir, 'url-inventory-history.json')
const campaignRegistryPath = path.join(privateDir, 'campaign-registry.json')

async function ensureKey() {
  await fs.mkdir(privateDir, { recursive: true })
  try {
    return await fs.readFile(keyPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const key = crypto.randomBytes(32)
    await fs.writeFile(keyPath, key, { mode: 0o600 })
    return key
  }
}

export async function saveSettings(settings) {
  const key = await ensureKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(settings), 'utf8'),
    cipher.final()
  ])
  const payload = {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  }
  await fs.writeFile(settingsPath, JSON.stringify(payload, null, 2), { mode: 0o600 })
}

export async function loadSettings() {
  try {
    const key = await ensureKey()
    const payload = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(payload.iv, 'base64')
    )
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')),
      decipher.final()
    ])
    return JSON.parse(decrypted.toString('utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error('Saved GA4 settings could not be decrypted.')
  }
}

export async function hasSettings() {
  try {
    await fs.access(settingsPath)
    return true
  } catch {
    return false
  }
}

export async function loadUrlHistory() {
  try { return JSON.parse(await fs.readFile(urlHistoryPath, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export async function saveUrlHistory(history) {
  await fs.mkdir(privateDir, { recursive: true })
  await fs.writeFile(urlHistoryPath, JSON.stringify(history), { mode: 0o600 })
}

export async function loadCampaignRegistry() {
  try { return JSON.parse(await fs.readFile(campaignRegistryPath, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

export async function saveCampaignRegistry(campaigns) {
  await fs.mkdir(privateDir, { recursive: true })
  await fs.writeFile(campaignRegistryPath, JSON.stringify(campaigns, null, 2), { mode: 0o600 })
}
