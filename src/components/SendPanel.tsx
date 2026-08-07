import { useState } from 'react'
import { isAddress } from 'viem'
import { parseUnits } from 'viem'
import type { StoredCredential } from '../lib/keystore'
import { sendPathUsd } from '../lib/client'
import { formatUnits, explorerTxUrl, PATHUSD } from '../chain'

export function SendPanel({
  credential,
  balance,
  onSent,
}: {
  credential: StoredCredential
  balance: bigint | null
  onSent: () => void
}) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentHash, setSentHash] = useState<string | null>(null)

  async function handleSend() {
    setError(null)
    setSentHash(null)

    if (!isAddress(to)) {
      setError('Enter a valid recipient address (0x…).')
      return
    }
    let value: bigint
    try {
      value = parseUnits(amount || '0', 6)
    } catch {
      setError('Enter a valid amount in pathUSD.')
      return
    }
    if (value <= 0n) {
      setError('Amount must be greater than zero.')
      return
    }
    if (balance !== null && value > balance) {
      setError(`Insufficient balance (have ${formatUnits(balance)} pathUSD).`)
      return
    }

    setBusy(true)
    try {
      const { hash } = await sendPathUsd(credential, to, value)
      setSentHash(hash)
      setTo('')
      setAmount('')
      onSent()
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? String(e)
      const details = e?.details ?? e?.cause?.details ?? ''
      if (/insufficient funds/i.test(details))
        setError(
          'Insufficient pathUSD for fees. Top up this address, then try again.',
        )
      else setError(`${msg}${details ? ` — ${details}` : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const max = balance !== null ? formatUnits(balance) : '—'

  return (
    <section className="card send-card">
      <h2>Send pathUSD</h2>
      <p className="muted small">
        Signed by your passkey in a Tempo Transaction (type <code>0x76</code>).
        Fees are charged in pathUSD.
      </p>

      <label className="lbl" htmlFor="to">
        Recipient
      </label>
      <input
        id="to"
        className="field mono"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="0x…"
        spellCheck={false}
      />

      <div className="amount-row">
        <div className="amount-col">
          <label className="lbl" htmlFor="amount">
            Amount
          </label>
          <input
            id="amount"
            className="field mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
          />
        </div>
        <div className="amount-meta">
          <span className="muted small">Available: {max}</span>
          <button
            className="btn ghost tiny"
            onClick={() =>
              balance !== null && setAmount(formatUnits(balance))
            }
            disabled={balance === null}
          >
            Max
          </button>
        </div>
      </div>

      <button
        className="btn primary send-btn"
        onClick={handleSend}
        disabled={busy}
      >
        {busy ? 'Awaiting passkey approval…' : 'Send'}
      </button>

      {error && <div className="error">{error}</div>}
      {sentHash && (
        <div className="success">
          Sent!{' '}
          <a href={explorerTxUrl(sentHash)} target="_blank" rel="noreferrer">
            View on explorer ↗
          </a>
        </div>
      )}
    </section>
  )
}
