import { useState } from 'react'
import { registerPasskey, loginPasskey, loginWithDiscoverablePasskey, normalizeEmail, isValidEmail } from '../lib/passkey'
import type { WalletAccount } from '../lib/passkey'
import * as keystore from '../lib/keystore'
import { CHAIN_ID } from '../chain'

export function ConnectScreen({
  onCreated,
}: {
  onCreated: (account: WalletAccount) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const existing = keystore.listCredentials()

  async function handleCreate() {
    setError(null)
    if (!isValidEmail(email)) {
      setError('Enter a valid email address — it will be your account name.')
      return
    }
    const normalized = normalizeEmail(email)
    setBusy(`Creating passkey for ${normalized}…`)
    try {
      const account = await registerPasskey(normalized)
      onCreated(account)
    } catch (e: any) {
      setError(prettyError(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleLogin(id: string) {
    setBusy('Authenticating…')
    setError(null)
    try {
      const account = await loginPasskey(id)
      onCreated(account)
    } catch (e: any) {
      setError(prettyError(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleDiscoverableLogin() {
    setBusy('Looking for passkeys on this device…')
    setError(null)
    try {
      const account = await loginWithDiscoverablePasskey()
      onCreated(account)
    } catch (e: any) {
      setError(prettyError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">NVNM Passkey Wallet</span>
        </div>
        <span className="network-pill">NVNM Canary · chain {CHAIN_ID}</span>
      </header>

      <main className="connect">
        <div className="hero">
          <h1>
            Your keys are your <em>face</em>.
          </h1>
          <p>
            A self-custodial wallet for <strong>NVNM Chain</strong> — a
            Tempo-compatible L1. Sign in with a passkey (Face ID, Touch ID,
            Windows Hello or a security key). No seed phrases, ever.
          </p>
        </div>

        <div className="card connect-card">
          <h2>Create a wallet</h2>
          <p className="muted">
            Your passkey lives on this device only. Your address is derived
            from its P-256 public key, on-chain — nothing is uploaded. Your
            email is used as the account name and stored locally.
          </p>
          <label className="lbl" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="you@example.com"
            disabled={!!busy}
          />
          {isValidEmail(email) && (
            <div className="normalized-hint">
              Account name:{' '}
              <code>{normalizeEmail(email)}</code>
            </div>
          )}
          <button className="btn primary" onClick={handleCreate} disabled={!!busy}>
            {busy ?? 'Create new passkey wallet'}
          </button>

          {existing.length > 0 && (
            <div className="existing">
              <h3>Sign back in</h3>
              {existing.map((c) => (
                <button
                  key={c.id}
                  className="btn ghost existing-row"
                  onClick={() => handleLogin(c.id)}
                  disabled={!!busy}
                >
                  <span className="existing-label">{c.email ?? c.label}</span>
                  <span className="existing-meta">{c.id.slice(0, 12)}…</span>
                </button>
              ))}
            </div>
          )}

          <div className="existing">
            <h3>On another device?</h3>
            <button
              className="btn ghost existing-row"
              onClick={handleDiscoverableLogin}
              disabled={!!busy}
            >
              <span className="existing-label">Sign in with a passkey on this device</span>
              <span className="existing-meta">↗</span>
            </button>
            <p className="muted small cross-device-hint">
              Works for passkeys synced to this device (e.g. iCloud Keychain).
              Your address is recovered from the passkey itself — no local data
              needed, nothing stored elsewhere. For a brand-new address you'll
              approve twice (that's how the wallet securely identifies the
              passkey). Passkeys only sync between devices signed into the same
              account (Apple ID / Google), and you must use the same URL on both
              devices.
            </p>
          </div>

          {error && <div className="error">{error}</div>}
        </div>

        <p className="footnote">
          WebAuthn · P-256 (secp256r1) · Tempo Transactions (EIP-2718 type{' '}
          <code>0x76</code>) · fees in pathUSD
        </p>
      </main>
    </div>
  )
}

function prettyError(e: any): string {
  const msg = e?.shortMessage ?? e?.message ?? String(e)
  if (/NotAllowedError|not allowed/i.test(msg))
    return 'Passkey prompt was cancelled or blocked. Try again.'
  if (/InvalidStateError|already exists/i.test(msg))
    return 'A passkey for this email already exists on this device — use "Sign back in".'
  return msg
}
