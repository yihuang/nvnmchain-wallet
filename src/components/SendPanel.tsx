import { useEffect, useRef, useState } from 'react'
import { isAddress, parseUnits } from 'viem'
import type { StoredCredential } from '../lib/keystore'
import { estimateTransferFee, sendPathUsd, type FeeEstimate } from '../lib/client'
import { formatUnits, explorerTxUrl, shortAddress } from '../chain'

type Phase =
  | 'idle'
  | 'estimating'
  | 'signing'
  | 'broadcasting'
  | 'submitted'
  | 'ok'
  | 'reverted'
  | 'timeout'

export function SendPanel({
  credential,
  address,
  balance,
  onSent,
}: {
  credential: StoredCredential
  address: string
  balance: bigint | null
  onSent: () => void
}) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [fee, setFee] = useState<FeeEstimate | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const toTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // (Re)estimate the fee whenever the recipient changes (debounced).
  useEffect(() => {
    setFee(null)
    if (!isAddress(to)) return
    setPhase('estimating')
    if (toTimer.current) clearTimeout(toTimer.current)
    toTimer.current = setTimeout(async () => {
      try {
        const est = await estimateTransferFee(address, to)
        setFee(est)
      } catch {
        setFee(null)
      } finally {
        setPhase((p) => (p === 'estimating' ? 'idle' : p))
      }
    }, 350)
    return () => {
      if (toTimer.current) clearTimeout(toTimer.current)
    }
  }, [to, address])

  const busy = phase === 'signing' || phase === 'broadcasting' || phase === 'submitted'

  function handleMax() {
    if (balance === null || fee === null) return
    const maxSendable = balance - fee.fee
    if (maxSendable <= 0n) {
      setAmount('')
      setError('Balance is too low to cover the estimated fee — top up first.')
      return
    }
    setAmount(formatUnits(maxSendable))
    setError(null)
  }

  async function handleSend() {
    setError(null)
    setTxHash(null)

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
    if (balance === null) {
      setError('Balance is still loading — try again in a second.')
      return
    }
    if (fee === null) {
      setError('Fee estimate unavailable — check the recipient and try again.')
      return
    }
    const total = value + fee.fee
    if (total > balance) {
      setError(
        `Insufficient pathUSD. Amount + estimated fee (${formatUnits(fee.fee)} pathUSD) is ${formatUnits(total)}, but you have ${formatUnits(balance)}.`,
      )
      return
    }

    setPhase('signing')
    try {
      const result = await sendPathUsd(
        credential,
        to,
        value,
        fee,
        () => setPhase('submitted'),
      )
      setTxHash(result.hash)
      setPhase(result.status === 'ok' ? 'ok' : result.status)
      if (result.status === 'ok') {
        setTo('')
        setAmount('')
        setFee(null)
        onSent()
      }
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? String(e)
      const details = e?.details ?? e?.cause?.details ?? ''
      if (/insufficient funds/i.test(details)) {
        setError(
          'Insufficient pathUSD for the amount + fee. Top up this address, then try again.',
        )
      } else if (/gas limit/i.test(details)) {
        setError(`Gas limit exceeded — please try again. (${details})`)
      } else if (/user rejected|rejected/i.test(msg)) {
        setError('Passkey prompt was cancelled — nothing was sent.')
      } else {
        setError(`${msg}${details ? ` — ${details}` : ''}`)
      }
    } finally {
      setPhase((p) => (p === 'signing' || p === 'broadcasting' ? 'idle' : p))
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
        disabled={busy}
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
            disabled={busy}
          />
        </div>
        <div className="amount-meta">
          <span className="muted small">Available: {max}</span>
          <button
            className="btn ghost tiny"
            onClick={handleMax}
            disabled={balance === null || fee === null || busy}
            title={fee ? 'Fills in the max amount, keeping pathUSD aside for the fee' : 'Enter a recipient first'}
          >
            Max
          </button>
        </div>
      </div>

      <div className="fee-line">
        {phase === 'estimating' ? (
          <span className="muted small">Estimating fee…</span>
        ) : fee ? (
          <>
            <span className="muted small">
              Estimated fee: <strong className="fee-amt">{formatUnits(fee.fee)} pathUSD</strong>
              {balance !== null && balance <= fee.fee && (
                <span className="fee-warn"> — balance can't cover fees yet</span>
              )}
            </span>
            <span className="muted small fee-detail">
              gas {fee.gasLimit.toString()} · cap {formatUnits(fee.maxFeePerGas * fee.gasLimit / 10n ** 12n, 6)} pathUSD
            </span>
          </>
        ) : (
          <span className="muted small">
            {isAddress(to) ? 'Fee estimate unavailable' : 'Enter a recipient to estimate the fee'}
          </span>
        )}
      </div>

      <button className="btn primary send-btn" onClick={handleSend} disabled={busy}>
        {phase === 'signing'
          ? 'Awaiting passkey approval…'
          : phase === 'broadcasting'
            ? 'Broadcasting…'
            : phase === 'submitted'
              ? 'Awaiting confirmation…'
              : 'Send'}
      </button>

      {phase === 'ok' && txHash && (
        <div className="success">
          ✓ Transaction confirmed!{' '}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            {shortAddress(txHash)} ↗
          </a>
        </div>
      )}
      {phase === 'reverted' && txHash && (
        <div className="error">
          Transaction was mined but <strong>reverted on-chain</strong> — nothing
          was sent.{' '}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            View {shortAddress(txHash)} ↗
          </a>
        </div>
      )}
      {phase === 'timeout' && txHash && (
        <div className="success">
          Submitted! Confirmation is taking a while —{' '}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            check the explorer for {shortAddress(txHash)} ↗
          </a>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </section>
  )
}
