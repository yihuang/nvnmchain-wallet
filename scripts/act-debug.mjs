import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#email', 'debug@example.com')
await page.click('button:has-text("Create new passkey wallet")')
await page.waitForSelector('.activity-card', { timeout: 20000 })
await page.waitForTimeout(3000) // let refresh run

console.log('activity text:', (await page.textContent('.activity-card'))?.replace(/\s+/g, ' ').trim())
console.log('console errors:', errors.length ? errors : 'none')

// Now reproduce getHistory's exact fetch from the browser for a funded address
const funded = '0xE3BEa934276C4e8B7864Bc9f27EdDa99E28ce0d2'
const result = await page.evaluate(async (addr) => {
  try {
    const url = `https://blockscout.nvnm.canary.mantrachain.dev/api/v2/addresses/${addr}/transactions`
    const res = await fetch(url)
    const data = await res.json()
    return { ok: res.ok, status: res.status, itemCount: data?.items?.length ?? 0 }
  } catch (e) {
    return { error: String(e) }
  }
}, funded)
console.log('browser fetch to blockscout:', JSON.stringify(result))
await browser.close()
