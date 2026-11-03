import { useEffect, useState } from 'react'
import { api, fmt } from '../api/client'
import ThermalPrint from './ThermalPrint'

export default function PrintSelector({ onClose, toast }) {
  const [bills, setBills] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [bill, setBill] = useState(null)
  const [showThermal, setShowThermal] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listBills({ limit: 100 })
      .then(d => {
        const list = d.data || []
        setBills(list)
        if (list.length) {
          setSelectedId(String(list[0].id))
        }
      })
      .catch(e => toast?.(e.message, true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedId) { setBill(null); return }
    api.getBill(selectedId)
      .then(d => setBill(d.data))
      .catch(e => toast?.(e.message, true))
  }, [selectedId])

  const printClient = () => {
    if (!bill) return
    // Navigate-style: open bill view print
    window.open(`/bills/${bill.id}?print=1`, '_blank')
  }

  return (
    <>
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 520 }}>
          <h2>🖨️ Select Bill to Print</h2>

          {loading && <p className="text-muted">Loading bills…</p>}

          {!loading && bills.length === 0 && (
            <p className="empty-state">No bills found</p>
          )}

          {bills.length > 0 && (
            <>
              <div className="form-group mb-2">
                <select
                  value={selectedId}
                  onChange={e => setSelectedId(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', fontSize: '0.9rem' }}
                >
                  {bills.map(b => (
                    <option key={b.id} value={b.id}>
                      #{b.sr_no} | {b.client_name} | {b.client_phone || '—'} | Net: {fmt(b.net_total)} | {b.payment_status}
                    </option>
                  ))}
                </select>
              </div>

              {bill && (
                <div style={{
                  background: 'var(--card-inner)', borderRadius: 8, padding: 14,
                  fontSize: '0.875rem', lineHeight: 1.7, marginBottom: 16,
                }}>
                  <div><strong>Client:</strong> {bill.client_name} (Phone: {bill.client_phone || '—'})</div>
                  <div><strong>Date:</strong> {bill.created_at?.slice(0, 16)}</div>
                  <div>
                    Grand: {fmt(bill.grand_total)} | Discount: {fmt(bill.discount)}
                  </div>
                  <div><strong>Net (Client):</strong> {fmt(bill.net_total)}</div>
                  <div>Paid: {fmt(bill.paid_amount)} | Due: {fmt(bill.remaining_balance)}</div>
                  <div>Status: <strong>{bill.payment_status}</strong></div>
                </div>
              )}

              <div className="btn-group" style={{ width: '100%' }}>
                <button className="btn btn-blue" style={{ flex: 1 }} onClick={printClient} disabled={!bill}>
                  🖨️ Print Client Bill
                </button>
                <button className="btn btn-orange" style={{ flex: 1 }} onClick={printClient} disabled={!bill}>
                  🔒 Print Internal
                </button>
                <button className="btn btn-purple" style={{ flex: 1 }}
                  onClick={() => setShowThermal(true)} disabled={!bill}>
                  🧾 Thermal Print
                </button>
              </div>
            </>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {showThermal && bill && (
        <ThermalPrint bill={bill} onClose={() => setShowThermal(false)} />
      )}
    </>
  )
}
