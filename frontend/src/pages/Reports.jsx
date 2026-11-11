import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api, fmt, CAT_LABELS, shareWhatsApp, shareAsImage, getBusinessWaNumber, setBusinessWaNumber } from '../api/client'
import { useAutoRefresh } from '../hooks/useLiveSync'

function StatusBadge({ status }) {
  const display = status === 'PAID' ? 'PAID' : 'UNPAID'
  const cls = status === 'PAID' ? 'badge-paid' : 'badge-unpaid'
  return <span className={`badge ${cls}`}>{display}</span>
}

function availableYears() {
  const y = new Date().getFullYear()
  const out = []
  for (let i = 0; i < 8; i++) out.push(y - i)
  return out
}

function monthsForYear(year) {
  const now = new Date()
  const out = []
  for (let m = 1; m <= 12; m++) {
    // don't list future months of current year
    if (year === now.getFullYear() && m > now.getMonth() + 1) break
    const d = new Date(year, m - 1, 1)
    out.push({
      value: `${year}-${String(m).padStart(2, '0')}`,
      label: d.toLocaleString('en', { month: 'long' }),
    })
  }
  return out
}

const ALL_CAT_KEYS = ['cnc_only', 'cnc_pipe', 'fancy', 'sheet_sale', 'only_cutting', 'pipe_grill', 'bending_sheet', 'bending_only']

export default function Reports({ toast }) {
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState('daily')
  const [selectedYear, setSelectedYear] = useState('')
  // empty set = show all categories
  const [selectedCats, setSelectedCats] = useState([])
  const [waBiz, setWaBiz] = useState(() => getBusinessWaNumber())

  const load = useCallback(() => {
    api.report(period)
      .then(setData)
      .catch(e => toast(e.message, true))
  }, [period])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load)

  const toggleCat = (key) => {
    setSelectedCats(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key)
      return [...prev, key]
    })
  }

  const selectAllCats = () => setSelectedCats([])
  const hasCatFilter = selectedCats.length > 0

  if (!data) return <div className="loading">Loading reports…</div>
  const r = data.revenue || {}

  const byCatAll = data.by_category || []
  const byCat = hasCatFilter
    ? byCatAll.filter(c => selectedCats.includes(c.bill_category))
    : byCatAll
  const matAll = data.material_usage || []
  const matFiltered = hasCatFilter
    ? matAll.filter(m => selectedCats.includes(m.bill_category))
    : matAll

  const catItemsSum = byCat.reduce((s, c) => s + (parseInt(c.items) || 0), 0)
  const catAmountSum = byCat.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)
  const matItemsSum = matFiltered.reduce((s, m) => s + (parseInt(m.items) || 0), 0)
  const matAreaSum = matFiltered.reduce((s, m) => s + (parseFloat(m.total_area) || 0), 0)
  const matAmountSum = matFiltered.reduce((s, m) => s + (parseFloat(m.total_amount) || 0), 0)

  const shareSummaryWA = () => {
    const periodLabel = /^\d{4}-\d{2}$/.test(period)
      ? period
      : period.startsWith('year:')
        ? 'Year ' + period.slice(5)
        : period === 'all' ? 'All Time'
        : period === 'weekly' ? 'Weekly'
        : period
    const lines = [
      '*S. HABIB — REPORTS SUMMARY*',
      `Period: ${periodLabel}` + (data.from && data.to ? ` (${data.from} → ${data.to})` : ''),
      '------------------------',
      `Bills: ${r.bill_count ?? 0}`,
      `Sale: PKR ${Number(r.gross_total || 0).toLocaleString('en-PK')}`,
      `Paid: PKR ${Number(r.total_paid || 0).toLocaleString('en-PK')}`,
      `Unpaid: PKR ${Number(r.total_remaining || 0).toLocaleString('en-PK')}`,
      `Expenses: PKR ${Number(data.business_expenses || 0).toLocaleString('en-PK')}`,
      `Food Exp: PKR ${Number(data.personal_expenses || 0).toLocaleString('en-PK')}`,
      `Last Profit: *PKR ${Number(data.profit || 0).toLocaleString('en-PK')}*`,
      '------------------------',
      '*By Category:*',
    ]
    byCat.forEach(c => {
      lines.push(`• ${CAT_LABELS[c.bill_category] || c.bill_category}: ${c.items} items — PKR ${Number(c.amount || 0).toLocaleString('en-PK')}`)
    })
    if (byCat.length) {
      lines.push(`TOTAL: ${catItemsSum} items — *PKR ${Number(catAmountSum).toLocaleString('en-PK')}*`)
    }
    lines.push('------------------------')
    lines.push('*Material list:*')
    matFiltered.forEach((m, i) => {
      lines.push(`${i + 1}. [${CAT_LABELS[m.bill_category] || m.bill_category || 'Other'}] ${m.material} ${m.gauge || ''} ${m.sheet_size || ''}`)
      lines.push(`   Items:${m.items} · ${Number(m.total_area || 0).toFixed(1)} sqft · PKR ${Number(m.total_amount || 0).toLocaleString('en-PK')}`)
    })
    if (matFiltered.length) {
      lines.push(`Material TOTAL: ${matItemsSum} items · ${matAreaSum.toFixed(1)} sqft · *PKR ${Number(matAmountSum).toLocaleString('en-PK')}*`)
    }
    // Client list in image
    lines.push('------------------------')
    lines.push('*Clients:*')
    const clients = data.by_client || []
    if (!clients.length) lines.push('No clients in this period')
    clients.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.client_name}`)
      lines.push(`   Bills:${c.bills} · Net:${Number(c.net_total || 0).toLocaleString('en-PK')} · Paid:${Number(c.paid || 0).toLocaleString('en-PK')} · Due:${Number(c.remaining || 0).toLocaleString('en-PK')}`)
    })
    shareAsImage('S. HABIB — REPORTS SUMMARY', lines, 'habib-report-summary.png').catch(() => {
      shareWhatsApp(lines.join("\n"))
    })
  }

  return (
    <div className="container">
      <div className="page-title">
        <span>📈 Reports & Summary</span>
        <div className="btn-group" style={{ flexWrap: 'wrap' }}>
          {['daily', 'weekly', 'monthly', 'all'].map(p => (
            <button key={p} className={`btn btn-ghost btn-sm period-button ${period === p ? 'active' : ''}`}
              onClick={() => { setSelectedYear(''); setPeriod(p) }}>
              {p === 'all' ? 'All Time' : p === 'weekly' ? 'Weekly (Sat–Thu)' : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
          <select
            value={selectedYear}
            onChange={e => {
              const y = e.target.value
              setSelectedYear(y)
              if (y) setPeriod('year:' + y)
            }}
            style={{
              background: selectedYear ? 'var(--text-orange)' : 'var(--entry-bg)',
              color: selectedYear ? '#0a0e17' : 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '6px 10px',
              fontWeight: 600,
              fontSize: '0.8rem',
            }}
          >
            <option value="">Select Year…</option>
            {availableYears().map(y => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
          {selectedYear && (
            <select
              value={/^\d{4}-\d{2}$/.test(period) ? period : ''}
              onChange={e => { if (e.target.value) setPeriod(e.target.value) }}
              style={{
                background: /^\d{4}-\d{2}$/.test(period) ? 'var(--text-orange)' : 'var(--entry-bg)',
                color: /^\d{4}-\d{2}$/.test(period) ? '#0a0e17' : 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '6px 10px',
                fontWeight: 600,
                fontSize: '0.8rem',
              }}
            >
              <option value="">All months ({selectedYear})</option>
              {monthsForYear(parseInt(selectedYear, 10)).map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          )}
          <button className="btn btn-wa" style={{ fontWeight: 700, padding: '8px 16px' }}
            onClick={() => { setBusinessWaNumber(waBiz); shareSummaryWA() }}>📲 WhatsApp Business Share</button>
          <input
            value={waBiz}
            onChange={e => setWaBiz(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => setBusinessWaNumber(waBiz)}
            placeholder="Business WA # 92xxxxxxxxxx"
            title="WhatsApp Business number with country code (e.g. 923037888350). Empty = pick chat in Business app."
            style={{
              background: 'var(--entry-bg)', border: '1px solid #25D366', color: 'var(--text)',
              borderRadius: 8, padding: '6px 10px', fontSize: '0.8rem', minWidth: 180,
            }}
          />
          <button className="btn btn-blue btn-sm" onClick={() => window.print()}>🖨️ Print</button>
        </div>
      </div>

      <p className="text-muted mb-1" style={{ fontSize: '0.85rem' }}>
        Showing: <strong className="text-orange">
          {/^\d{4}-\d{2}$/.test(period)
            ? new Date(period + '-01').toLocaleString('en', { month: 'long', year: 'numeric' })
            : period.startsWith('year:')
              ? 'Year ' + period.slice(5)
              : period === 'all' ? 'All Time'
              : period === 'weekly' ? 'Weekly (Sat–Thu)'
              : period.charAt(0).toUpperCase() + period.slice(1)}
        </strong>
        {data.from && data.to ? ` (${data.from} → ${data.to})` : ''}
      </p>

      <div className="stats-bar" style={{ borderRadius: 10, marginBottom: 16 }}>
        <div className="stat-card"><div className="label">Bills</div><div className="value">{r.bill_count ?? 0}</div></div>
        <div className="stat-card"><div className="label">Sale</div><div className="value">{fmt(r.gross_total)}</div></div>
        <div className="stat-card green"><div className="label">Paid</div><div className="value">{fmt(r.total_paid)}</div></div>
        <div className="stat-card red"><div className="label">Unpaid</div><div className="value">{fmt(r.total_remaining)}</div></div>
        <div className="stat-card"><div className="label">Expenses</div><div className="value">{fmt(data.business_expenses)}</div></div>
        <div className="stat-card"><div className="label">Food Expenses</div><div className="value">{fmt(data.personal_expenses)}</div></div>
        <div className="stat-card green"><div className="label">Last Profit</div><div className="value">{fmt(data.profit)}</div></div>
      </div>

      {/* Category filter — specific categories or all combined */}
      <div className="card mb-2" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <strong style={{ color: 'var(--text-orange)', fontSize: '0.9rem', marginRight: 4 }}>Filter Category:</strong>
          <label style={{
            display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', userSelect: 'none',
            fontSize: '0.85rem', padding: '4px 10px', borderRadius: 6,
            background: !hasCatFilter ? 'var(--text-orange)' : 'var(--entry-bg)',
            color: !hasCatFilter ? '#0a0e17' : 'var(--text)',
            border: '1px solid var(--border)', fontWeight: 600,
          }}>
            <input type="checkbox" checked={!hasCatFilter} onChange={selectAllCats}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--text-orange)' }} />
            All (Total)
          </label>
          {ALL_CAT_KEYS.map(key => {
            const on = selectedCats.includes(key)
            return (
              <label key={key} style={{
                display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', userSelect: 'none',
                fontSize: '0.85rem', padding: '4px 10px', borderRadius: 6,
                background: on ? 'rgba(249,115,22,0.25)' : 'var(--entry-bg)',
                color: 'var(--text)', border: on ? '1px solid var(--text-orange)' : '1px solid var(--border)',
              }}>
                <input type="checkbox" checked={on} onChange={() => toggleCat(key)}
                  style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--text-orange)' }} />
                {CAT_LABELS[key] || key}
              </label>
            )
          })}
        </div>
        {hasCatFilter && (
          <p className="text-muted mt-1" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
            Showing only: <strong className="text-orange">{selectedCats.map(k => CAT_LABELS[k] || k).join(', ')}</strong>
            {' '}— Sale (selected): <strong>{fmt(catAmountSum)}</strong>
          </p>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Clients (this period)</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>Client</th><th>Bills</th><th>Net Total</th><th>Paid</th><th>Due</th>
              </tr>
            </thead>
            <tbody>
              {(data.by_client || []).map((c, i) => (
                <tr key={i}>
                  <td><strong>{c.client_name || '—'}</strong></td>
                  <td>{c.bills}</td>
                  <td>{fmt(c.net_total)}</td>
                  <td className="text-green" style={{ color: 'var(--btn-green)' }}>{fmt(c.paid)}</td>
                  <td style={{ color: Number(c.remaining) > 0 ? 'var(--btn-delete)' : undefined }}>{fmt(c.remaining)}</td>
                </tr>
              ))}
              {!(data.by_client || []).length && (
                <tr><td colSpan={5} className="empty-state">No clients in this period</td></tr>
              )}
              {(data.by_client || []).length > 0 && (
                <tr style={{ fontWeight: 700 }}>
                  <td>TOTAL</td>
                  <td>{(data.by_client || []).reduce((s, c) => s + (parseInt(c.bills) || 0), 0)}</td>
                  <td>{fmt((data.by_client || []).reduce((s, c) => s + (parseFloat(c.net_total) || 0), 0))}</td>
                  <td>{fmt((data.by_client || []).reduce((s, c) => s + (parseFloat(c.paid) || 0), 0))}</td>
                  <td>{fmt((data.by_client || []).reduce((s, c) => s + (parseFloat(c.remaining) || 0), 0))}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="text-muted mt-1" style={{ fontSize: '0.8rem' }}>
            Sirf client name + unka data (bills, net, paid, due) — selected period ke mutabiq.
          </p>
        </div>
        <div className="card">
          <div className="card-header">
            <h3>Material by Category{hasCatFilter ? ' (filtered)' : ''}</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>Category</th><th>Material</th><th>Gauge</th><th>Size</th>
                <th>Qty/Items</th><th>Area</th><th>Total Price</th><th>Clients</th>
              </tr>
            </thead>
            <tbody>
              {matFiltered.map((m, i) => (
                <tr key={i}>
                  <td>{CAT_LABELS[m.bill_category] || m.bill_category || 'Other'}</td>
                  <td>{m.material}</td>
                  <td>{m.gauge || '—'}</td>
                  <td>{m.sheet_size || '—'}</td>
                  <td>{m.items}</td>
                  <td>{Number(m.total_area || 0).toFixed(2)} sqft</td>
                  <td>{fmt(m.total_amount)}</td>
                  <td style={{ fontSize: '0.8rem' }}>{m.clients || '—'}</td>
                </tr>
              ))}
              {!matFiltered.length && (
                <tr><td colSpan={8} className="empty-state">No material usage for selected categories</td></tr>
              )}
              {matFiltered.length > 0 && (
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={4}>{hasCatFilter ? 'TOTAL (Selected)' : 'TOTAL'}</td>
                  <td>{matItemsSum}</td>
                  <td>{matAreaSum.toFixed(2)} sqft</td>
                  <td>{fmt(matAmountSum)}</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-2">
        <div className="card-header"><h3>Bills in Period</h3></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>SR#</th><th>Client</th><th>Net Total</th><th>Status</th><th>Date</th><th></th></tr>
            </thead>
            <tbody>
              {(data.recent_bills || []).map(b => (
                <tr key={b.id}>
                  <td>#{b.sr_no}</td>
                  <td>{b.client_name}</td>
                  <td>{fmt(b.net_total)}</td>
                  <td><StatusBadge status={b.payment_status} /></td>
                  <td>{b.created_at?.slice(0, 16)}</td>
                  <td><Link to={`/bills/${b.id}`} className="btn btn-blue btn-sm">View</Link></td>
                </tr>
              ))}
              {!(data.recent_bills || []).length && <tr><td colSpan={6}>No bills</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-muted mt-2" style={{ fontSize: '0.85rem' }}>
        Note: Last Profit = Money collected from clients − Personal expenses − Business expenses.
      </p>
    </div>
  )
}
