import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api, fmt, CAT_LABELS } from '../api/client'
import { useAutoRefresh } from '../hooks/useLiveSync'

function StatusBadge({ status }) {
  // PARTIAL shown as UNPAID (red); PAID green
  const display = status === 'PAID' ? 'PAID' : 'UNPAID'
  const cls = status === 'PAID' ? 'badge-paid' : 'badge-unpaid'
  return <span className={`badge ${cls}`}>{display}</span>
}

export default function Dashboard({ toast }) {
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState('daily')

  const load = useCallback(() => {
    api.report(period)
      .then(setData)
      .catch(e => toast(e.message, true))
  }, [period])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load)

  if (!data) return <div className="loading">Loading dashboard…</div>

  const r = data.revenue || {}

  return (
    <>
      <div className="stats-bar">
        <div className="stat-card"><div className="label">Bills</div><div className="value">{r.bill_count ?? 0}</div></div>
        <div className="stat-card"><div className="label">Sale</div><div className="value">{fmt(r.gross_total)}</div></div>
        <div className="stat-card green"><div className="label">Paid</div><div className="value">{fmt(r.total_paid)}</div></div>
        <div className="stat-card red"><div className="label">Unpaid</div><div className="value">{fmt(r.total_remaining)}</div></div>
        <div className="stat-card"><div className="label">Expenses</div><div className="value">{fmt(data.business_expenses)}</div></div>
        <div className="stat-card"><div className="label">Food Expenses</div><div className="value">{fmt(data.personal_expenses)}</div></div>
        <div className="stat-card green"><div className="label">Last Profit</div><div className="value">{fmt(data.profit)}</div></div>
      </div>

      <div className="container">
        <div className="page-title">
          <span>📊 Overview</span>
          <div className="btn-group">
            {['daily', 'weekly', 'monthly'].map(p => (
              <button key={p} className={`btn btn-ghost btn-sm period-button ${period === p ? 'active' : ''}`}
                onClick={() => setPeriod(p)}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
            <Link to="/new-bill" className="btn btn-primary">➕ New Bill</Link>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Recent Bills</h3></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>SR#</th><th>Client</th><th>Net Total</th><th>Status</th><th>Date</th><th></th></tr>
              </thead>
              <tbody>
                {(data.recent_bills || []).length === 0 && (
                  <tr><td colSpan={6} className="empty-state">No bills in this period</td></tr>
                )}
                {(data.recent_bills || []).map(b => (
                  <tr key={b.id}>
                    <td><strong>#{b.sr_no}</strong></td>
                    <td>{b.client_name}</td>
                    <td>{fmt(b.net_total)}</td>
                    <td><StatusBadge status={b.payment_status} /></td>
                    <td>{b.created_at?.slice(0, 16)}</td>
                    <td><Link to={`/bills/${b.id}`} className="btn btn-blue btn-sm">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-header"><h3>By Category</h3></div>
            <table>
              <thead><tr><th>Category</th><th>Items</th><th>Amount</th></tr></thead>
              <tbody>
                {(data.by_category || []).map((c, i) => (
                  <tr key={i}>
                    <td>{CAT_LABELS[c.bill_category] || c.bill_category}</td>
                    <td>{c.items}</td>
                    <td>{fmt(c.amount)}</td>
                  </tr>
                ))}
                {!(data.by_category || []).length && <tr><td colSpan={3}>No data</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-header"><h3>Material Usage</h3></div>
            <table>
              <thead><tr><th>Material</th><th>Gauge</th><th>Size</th><th>Area</th><th>Items</th></tr></thead>
              <tbody>
                {(data.material_usage || []).map((m, i) => (
                  <tr key={i}>
                    <td>{m.material}</td>
                    <td>{m.gauge}</td>
                    <td>{m.sheet_size}</td>
                    <td>{Number(m.total_area).toFixed(2)} sqft</td>
                    <td>{m.items}</td>
                  </tr>
                ))}
                {!(data.material_usage || []).length && <tr><td colSpan={5}>No data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
