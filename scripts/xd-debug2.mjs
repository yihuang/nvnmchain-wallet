import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)))

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#email', 'xd@example.com')
await page.click('button:has-text("Create new passkey wallet")')
await page.waitForSelector('.balance-amount', { timeout: 20000 })
const addr = (await page.textContent('code.address'))?.trim()
console.log('registered:', addr)

// Now do the recovery logic manually in the page to see where it fails
const result = await page.evaluate(async () => {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const cred = await navigator.credentials.get({ publicKey: { challenge, rpId: 'localhost', userVerification: 'required', timeout: 10000 } })
    const resp = cred.response
    const sigBytes = new Uint8Array(resp.signature)
    console.log('sig len:', sigBytes.length, 'first bytes:', Array.from(sigBytes.slice(0, 8)))

    // DER parse
    let r, s
    if (sigBytes.length === 64) { r = sigBytes.slice(0, 32); s = sigBytes.slice(32) }
    else {
      let off = 2
      const rLen = sigBytes[off + 1]; r = sigBytes.slice(off + 2, off + 2 + rLen)
      off += 2 + rLen
      const sLen = sigBytes[off + 1]; s = sigBytes.slice(off + 2, off + 2 + sLen)
    }
    console.log('parsed r len:', r.length, 's len:', s.length)
    return { rlen: r.length, slen: s.length, rFirst: Array.from(r.slice(0, 4)), sFirst: Array.from(s.slice(0, 4)) }
  } catch (e) {
    return { error: String(e) }
  }
})
console.log('manual parse:', JSON.stringify(result))
await browser.close()
