import { shortAddress, explorerTxUrl } from '../chain'
import type { HistoryItem } from '../lib/client'

export function ActivityList({
  items,
  address,
}: {
  items: HistoryItem[]
  address: string
}) {
  return (
    <section className="card activity-card">
      <h2>Activity</h2>
      {items.length === 0 ? (
        <p className="muted">
          No transactions yet. Once you receive pathUSD they'll appear here.
        </p>
      ) : (
        <ul className="activity">
          {items.map((t) => {
            const incoming = t.from.toLowerCase() !== address.toLowerCase()
            return (
              <li key={t.hash}>
                <span
                  className={`dir ${incoming ? 'in' : 'out'}`}
                  title={incoming ? 'Received' : 'Sent'}
                />
                <div className="row-main">
                  <a
                    href={explorerTxUrl(t.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="mono"
                  >
                    {shortAddress(t.hash)}
                  </a>
                  <span className="muted small">
                    {incoming ? 'from' : 'to'}{' '}
                    <span className="mono">{shortAddress(t.from === address ? t.to : t.from)}</span>
                  </span>
                </div>
                <div className="row-side">
                  <span className={`status ${t.status}`}>{t.status}</span>
                  <span className="muted small">{fmtTime(t.timestamp)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function fmtTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
