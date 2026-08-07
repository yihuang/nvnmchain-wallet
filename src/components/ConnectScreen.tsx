import { useState } from 'react'
import { registerPasskey, loginPasskey } from '../lib/passkey'
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
  const [label, setLabel] = useState('My Passkey')
  const existing = keystore.listCredentials()

  async function handleCreate() {
    setBusy('Creating passkey…')
    setError(null)
    try {
      const account = await registerPasskey(label.trim() || 'My Passkey')
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
            from its P-256 public key, on-chain — nothing is uploaded.
          </p>
          <input
            className="field"
            value={label}
            maxLength={32}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Passkey name (e.g. iPhone 15)"
            disabled={!!busy}
          />
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
                  <span className="existing-label">{c.label}</span>
                  <span className="existing-meta">{c.id.slice(0, 12)}…</span>
                </button>
              ))}
            </div>
          )}

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
    return 'A passkey with this name already exists — pick another name or use "Sign back in".'
  return msg
}
