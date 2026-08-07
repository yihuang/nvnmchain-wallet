import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } })

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#email', 'xd@example.com')
await page.click('button:has-text("Create new passkey wallet")')
await page.waitForSelector('.balance-amount', { timeout: 20000 })
const orig = await page.evaluate(() => {
  const creds = JSON.parse(localStorage.getItem('nvnmchain:credentials:v1'))
  return { address: document.querySelector('code.address').textContent.trim(), pubkey: creds[0].publicKey }
})
console.log('registered pubkey:', orig.pubkey)

// Recover manually and compare
const rec = await page.evaluate(async () => {
  // load the ox P256 from the page's module graph? Not exposed. Instead replicate recovery using crypto.subtle
  // We'll do the assertion and dump the needed pieces for offline recovery
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const cred = await navigator.credentials.get({ publicKey: { challenge, rpId: 'localhost', userVerification: 'required', timeout: 10000 } })
  const resp = cred.response
  const authData = new Uint8Array(resp.authenticatorData)
  const clientData = new Uint8Array(resp.clientDataJSON)
  const sig = new Uint8Array(resp.signature)
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData))
  const combined = new Uint8Array(authData.length + clientHash.length)
  combined.set(authData); combined.set(clientHash, authData.length)
  const messageHash = new Uint8Array(await crypto.subtle.digest('SHA-256', combined))
  return {
    sigHex: Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join(''),
    msgHash: Array.from(messageHash).map(b => b.toString(16).padStart(2, '0')).join(''),
    authData: Array.from(authData).map(b => b.toString(16).padStart(2, '0')).join(''),
    clientData: new TextDecoder().decode(clientData),
  }
})
console.log('sig:', rec.sigHex)
console.log('msgHash:', rec.msgHash)
console.log('clientData:', rec.clientData)
await browser.close()
