import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } })
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)))
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#email', 'xd@example.com')
await page.click('button:has-text("Create new passkey wallet")')
await page.waitForSelector('.balance-amount', { timeout: 20000 })
const addr = (await page.textContent('code.address'))?.trim()
console.log('registered:', addr)

// test the raw credentials.get with the virtual authenticator (no allowCredentials)
const rawGet = await page.evaluate(async () => {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const cred = await navigator.credentials.get({
      publicKey: { challenge, rpId: 'localhost', userVerification: 'required', timeout: 10000 },
    })
    if (!cred) return { ok: false, reason: 'null credential' }
    const resp = cred.response
    return {
      ok: true,
      id: cred.id,
      sigLen: new Uint8Array(resp.signature).length,
      authLen: new Uint8Array(resp.authenticatorData).length,
      hasUserHandle: !!resp.userHandle,
      userHandle: resp.userHandle ? new TextDecoder().decode(resp.userHandle) : null,
    }
  } catch (e) {
    return { ok: false, reason: String(e) }
  }
})
console.log('raw credentials.get:', JSON.stringify(rawGet))
await browser.close()
