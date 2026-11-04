import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api, fmt, shareWhatsApp, formatBillWhatsApp, shareAsImage } from '../api/client'
import PrintSelector from '../components/PrintSelector'
import ThermalPrint from '../components/ThermalPrint'
import { useAutoRefresh } from '../hooks/useLiveSync'

function StatusBadge({ status }) {
  const display = status === 'PAID' ? 'PAID' : 'UNPAID'
  const cls = status === 'PAID' ? 'badge-paid' : 'badge-unpaid'
  return <span className={`badge ${cls}`}>{display}</span>
}

export default function Bills({ toast }) {
  const [bills, setBills] = useState([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [showPrintSel, setShowPrintSel] = useState(false)
  const [thermalBill, setThermalBill] = useState(null)
  const thermalRequest = useRef(0)

  const load = useCallback(() => {
    setLoading(true)
    api.listBills({ search, status })
      .then(d => setBills(d.data || []))
      .catch(e => toast(e.message, true))
      .finally(() => setLoading(false))
  }, [search, status])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load)

  const del = async (id, sr) => {
    if (!confirm(`Delete Bill #${sr}? This cannot be undone.`)) return
    try {
      await api.deleteBill(id)
      toast('Bill deleted')
      load()
    } catch (e) {
      toast(e.message, true)
    }
  }

  const openThermal = async (id) => {
    const requestId = ++thermalRequest.current
    setThermalBill(null)
    try {
      const d = await api.getBill(id)
      if (requestId === thermalRequest.current) setThermalBill(d.data)
    } catch (e) {
      if (requestId === thermalRequest.current) toast(e.message, true)
    }
  }

  const shareBillWA = async (id) => {
    try {
      const d = await api.getBill(id)
      const text = formatBillWhatsApp(d.data)
      const sr = d.data?.sr_no || id
      await shareAsImage('Bill #' + sr, text.split('\n'), 'habib-bill-' + sr + '.png')
    } catch (e) {
      try {
        const d = await api.getBill(id)
        shareWhatsApp(formatBillWhatsApp(d.data))
      } catch (e2) {
        toast(e.message || e2.message, true)
      }
    }
  }

  return (
    <div className="container">
      <div className="page-title">
        <span>📋 All Bills</span>
        <div className="btn-group">
          <button className="btn btn-orange" onClick={() => setShowPrintSel(true)}>🖨️ Print Bill</button>
          <Link to="/new-bill" className="btn btn-primary">➕ New Bill</Link>
        </div>
      </div>

      <div className="card mb-2">
        <div className="form-grid" style={{ alignItems: 'end' }}>
          <div className="form-group">
            <label>Search</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, phone, SR#..." />
          </div>
          <div className="form-group">
            <label>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="PAID">Paid</option>
              <option value="PARTIAL">Partial</option>
              <option value="UNPAID">Unpaid</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SR#</th><th>Client</th><th>Phone</th><th>Net Total</th>
                <th>Paid</th><th>Remaining</th><th>Status</th><th>Date</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="loading">Loading…</td></tr>}
              {!loading && bills.length === 0 && (
                <tr><td colSpan={9} className="empty-state">No bills found</td></tr>
              )}
              {bills.map(b => (
                <tr key={b.id}>
                  <td>
                    <strong>{b.pending ? 'PENDING' : `#${b.sr_no}`}</strong>
                    {b.pending_changes && <span className="badge badge-unpaid" style={{ marginLeft: 8 }}>Pending sync</span>}
                  </td>
                  <td>{b.client_name}</td>
                  <td>{b.client_phone || '—'}</td>
                  <td>{fmt(b.net_total)}</td>
                  <td>{fmt(b.paid_amount)}</td>
                  <td>{fmt(b.remaining_balance)}</td>
                  <td><StatusBadge status={b.payment_status} /></td>
                  <td>{b.created_at?.slice(0, 16)}</td>
                  <td className="btn-group">
                    <Link to={`/bills/${b.id}`} className="btn btn-blue btn-sm">View</Link>
                    {!b.pending && !b.pending_changes && <Link to={`/edit-bill/${b.id}`} className="btn btn-orange btn-sm">Edit</Link>}
                    <button className="btn btn-purple btn-sm"
                      onClick={() => openThermal(b.id)}>80mm</button>
                    <button className="btn btn-wa btn-sm"
                      onClick={() => shareBillWA(b.id)} title="Share on WhatsApp">WA Biz</button>
                    <button className="btn btn-red btn-sm" onClick={() => del(b.id, b.sr_no)} disabled={b.pending || b.pending_changes}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showPrintSel && (
        <PrintSelector onClose={() => setShowPrintSel(false)} toast={toast} />
      )}
      {thermalBill && (
        <ThermalPrint bill={thermalBill} onClose={() => setThermalBill(null)} />
      )}
    </div>
  )
}
