/**
 * Verifies the deployed GitHub Pages site: renders the app, registers a
 * passkey with a virtual authenticator, and confirms no console errors.
 *
 * Usage: node scripts/gh-pages-check.mjs
 * URL override: WALLET_URL=https://yihuang.github.io/nvnmchain-wallet/
 */
import { chromium } from '@playwright/test'

const BASE = process.env.WALLET_URL ?? 'https://yihuang.github.io/nvnmchain-wallet/'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1000, height: 900 } })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
  },
})

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

console.log('→ visiting', BASE)
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 })
await page.waitForSelector('.hero h1', { timeout: 15_000 })
console.log('✔ page rendered')

await page.fill('input[placeholder*="Passkey name"]', 'GH Pages Check')
await page.click('button:has-text("Create new passkey wallet")')
await page.waitForSelector('.balance-amount', { timeout: 20_000 })
const address = (await page.textContent('code.address'))?.trim()
console.log('✔ passkey registered on', new URL(BASE).hostname, '→', address)

if (errors.length) {
  console.log('✘ console/page errors:', errors.slice(0, 5))
  await browser.close()
  process.exit(1)
}
console.log('✔ no console errors')
await browser.close()
process.exit(0)
