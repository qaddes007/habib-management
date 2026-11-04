import { useEffect, useState } from 'react'
import { api, fmt } from '../api/client'
import ThermalPrint from './ThermalPrint'

export default function PrintSelector({ onClose, toast }) {
  const [bills, setBills] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [bill, setBill] = useState(null)
  const [billLoading, setBillLoading] = useState(false)
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
    let active = true
    setBill(null)
    if (!selectedId) {
      setBillLoading(false)
      return () => { active = false }
    }
    setBillLoading(true)
    api.getBill(selectedId)
      .then(d => { if (active) setBill(d.data) })
      .catch(e => { if (active) toast?.(e.message, true) })
      .finally(() => { if (active) setBillLoading(false) })
    return () => { active = false }
  }, [selectedId])

  const selectedBill = bill && String(bill.id) === selectedId ? bill : null

  const printClient = () => {
    if (!selectedBill) return
    // Navigate-style: open bill view print
    window.open(`/bills/${selectedBill.id}?print=1`, '_blank')
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

              {billLoading && <p className="text-muted">Loading selected bill…</p>}

              {selectedBill && (
                <div style={{
                  background: 'var(--card-inner)', borderRadius: 8, padding: 14,
                  fontSize: '0.875rem', lineHeight: 1.7, marginBottom: 16,
                }}>
                  <div><strong>Client:</strong> {selectedBill.client_name} (Phone: {selectedBill.client_phone || '—'})</div>
                  <div><strong>Date:</strong> {selectedBill.created_at?.slice(0, 16)}</div>
                  <div>
                    Grand: {fmt(selectedBill.grand_total)} | Discount: {fmt(selectedBill.discount)}
                  </div>
                  <div><strong>Net (Client):</strong> {fmt(selectedBill.net_total)}</div>
                  <div>Paid: {fmt(selectedBill.paid_amount)} | Due: {fmt(selectedBill.remaining_balance)}</div>
                  <div>Status: <strong>{selectedBill.payment_status}</strong></div>
                </div>
              )}

              <div className="btn-group" style={{ width: '100%' }}>
                <button className="btn btn-blue" style={{ flex: 1 }} onClick={printClient} disabled={!selectedBill || billLoading}>
                  🖨️ Print Client Bill
                </button>
                <button className="btn btn-orange" style={{ flex: 1 }} onClick={printClient} disabled={!selectedBill || billLoading}>
                  🔒 Print Internal
                </button>
                <button className="btn btn-purple" style={{ flex: 1 }}
                  onClick={() => setShowThermal(true)} disabled={!selectedBill || billLoading}>
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

      {showThermal && selectedBill && !billLoading && (
        <ThermalPrint bill={selectedBill} onClose={() => setShowThermal(false)} />
      )}
    </>
  )
}
