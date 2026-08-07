/**
 * End-to-end test: registers a passkey (virtual authenticator), derives the
 * address, reads the balance, verifies the fee estimate + fee-aware Max
 * button, then attempts a transfer — expecting the node to reject only on
 * funds (proving the browser WebAuthn signing pipeline produces a valid
 * Tempo type-0x76 transaction) and the UI to surface clear feedback.
 *
 * Run: `npm run e2e`
 */
import { chromium } from '@playwright/test'

const BASE = process.env.WALLET_URL ?? 'http://localhost:5173'

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext()
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

  console.log('→ visiting', BASE)
  await page.goto(BASE, { waitUntil: 'networkidle' })

  // 1. Register a passkey
  console.log('→ registering passkey…')
  await page.fill('input[placeholder*="Passkey name"]', 'E2E Test Passkey')
  await page.click('button:has-text("Create new passkey wallet")')
  await page.waitForSelector('text=Balance', { timeout: 20_000 })
  console.log('✔ registered & dashboard loaded')

  const address = (await page.textContent('code.address'))?.trim()
  console.log('→ address:', address)

  // 2. Enter a recipient → fee estimate should appear
  await page.fill('#to', '0x1234567890abcdef1234567890abcdef12345678')
  await page.waitForSelector('.fee-line .fee-amt', { timeout: 20_000 })
  const feeText = (await page.textContent('.fee-line'))?.trim()
  console.log('→ fee estimate shown:', feeText?.replace(/\s+/g, ' '))
  if (!/Estimated fee/.test(feeText ?? '')) {
    console.log('✘ fee estimate missing')
    await browser.close()
    process.exit(1)
  }

  // 3. Balance is zero → Max should warn, not silently under-fill
  const balanceText = (await page.textContent('.balance-amount')) ?? ''
  console.log('→ balance:', balanceText.trim())
  await page.click('button:has-text("Max")')
  const maxNotice = (await page.textContent('.error'))?.trim()
  console.log('→ Max notice:', maxNotice)
  if (!/too low|cover/i.test(maxNotice ?? '')) {
    console.log('✘ expected a low-balance notice from Max')
    await browser.close()
    process.exit(1)
  }

  // 4. Attempt a transfer (expect graceful insufficient-funds error)
  console.log('→ attempting transfer…')
  await page.fill('#amount', '1.00')
  await page.click('.send-btn')
  await page.waitForSelector('.error', { timeout: 30_000 })
  const err = (await page.textContent('.error'))?.trim()
  console.log('→ send feedback:', err)
  if (!/Insufficient pathUSD/i.test(err ?? '')) {
    console.log('✘ expected an insufficient-funds error, got:', err)
    await browser.close()
    process.exit(1)
  }

  // 5. Sign back in
  console.log('→ signing back in…')
  await page.click('button:has-text("Disconnect")')
  await page.waitForSelector('.existing', { timeout: 10_000 })
  await page.click('.existing-row')
  await page.waitForSelector('.balance-amount', { timeout: 20_000 })
  const addr2 = (await page.textContent('code.address'))?.trim()
  if (addr2 !== address) {
    console.log('✘ address mismatch after re-login:', addr2, 'vs', address)
    await browser.close()
    process.exit(1)
  }
  console.log('✔ re-login restored the same address')

  console.log('\n✔ E2E PASS — registration, derivation, fee estimate, Max,')
  console.log('  send feedback and re-login all work in the browser.')
  await browser.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('E2E failed:', e)
  process.exit(1)
})
