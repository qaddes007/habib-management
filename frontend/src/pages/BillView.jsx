import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api, fmt, CAT_LABELS, shareWhatsApp, formatBillWhatsApp, shareAsImage } from '../api/client'
import ThermalPrint from '../components/ThermalPrint'
import { useAutoRefresh } from '../hooks/useLiveSync'

function StatusBadge({ status }) {
  const display = status === 'PAID' ? 'PAID' : 'UNPAID'
  const cls = status === 'PAID' ? 'badge-paid' : 'badge-unpaid'
  return <span className={`badge ${cls}`}>{display}</span>
}

function isBillLocked(bill) {
  if (!bill || bill.payment_status !== 'PAID') return false
  const created = new Date(String(bill.created_at).replace(' ', 'T'))
  return (Date.now() - created.getTime()) > 30 * 24 * 60 * 60 * 1000
}

export default function BillView({ toast }) {
  const navigate = useNavigate()

  const { id } = useParams()
  const billRequest = useRef(0)
  const [bill, setBill] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showPay, setShowPay] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('Payment')
  const [showThermal, setShowThermal] = useState(false)

  const load = useCallback(() => {
    const requestId = ++billRequest.current
    setLoading(true)
    api.getBill(id)
      .then(d => {
        if (requestId !== billRequest.current) return
        setBill(d.data)
        setPayAmount(d.data?.remaining_balance || '')
      })
      .catch(e => { if (requestId === billRequest.current) toast(e.message, true) })
      .finally(() => { if (requestId === billRequest.current) setLoading(false) })
  }, [id])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load)

  const submitPayment = async () => {
    const amount = parseFloat(payAmount) || 0
    if (amount <= 0) { toast('Enter a valid amount', true); return }
    try {
      const result = await api.addPayment({ bill_id: Number(bill.id), amount, note: payNote })
      toast(result.pending ? 'Payment saved on this laptop; it will sync later.' : 'Payment recorded')
      setShowPay(false)
      load()
    } catch (e) {
      toast(e.message, true)
    }
  }

  if (loading) return <div className="loading">Loading bill…</div>
  if (!bill) return (
    <div className="container">
      <div className="card empty-state">
        <p>Bill not found.</p>
        <Link to="/bills" className="btn btn-primary mt-2">Back to Bills</Link>
      </div>
    </div>
  )

  const frames = bill.frames || []
  const payments = bill.payment_history || []
  const company = bill.company || {}

  return (
    <div className="container">
      <div className="page-title no-print">
        <span>Bill #{bill.sr_no} — {bill.client_name}</span>
        <div className="btn-group">
          <button className="btn btn-blue" onClick={() => window.print()}>🖨️ Print</button>
          {!isBillLocked(bill) ? (
            <button className="btn btn-orange" onClick={() => navigate('/edit-bill/' + bill.id)}>✏️ Edit</button>
          ) : (
            <span className="badge badge-unpaid" title="PAID bills older than 30 days cannot be edited">🔒 Locked</span>
          )}
          <button className="btn btn-purple" onClick={() => setShowThermal(true)}>🧾 80mm Print</button>
          <button className="btn btn-wa"
            onClick={() => {
              const text = formatBillWhatsApp(bill)
              shareAsImage('Bill #' + bill.sr_no + ' — ' + (bill.client_name || ''), text.split('\n'), 'habib-bill-' + bill.sr_no + '.png')
                .catch(() => shareWhatsApp(text))
            }}>📲 WA Business</button>
          <button className="btn btn-green" onClick={() => setShowPay(true)}>💰 Add Payment</button>
          <Link to="/bills" className="btn btn-ghost">← Back</Link>
        </div>
      </div>

      {(bill.pending || bill.pending_changes) && (
        <div className="offline-notice" role="status">
          {bill.pending
            ? 'This bill is saved only on this laptop. Its final bill number will be assigned after syncing.'
            : 'Changes to this bill are saved on this laptop and are waiting to sync.'}
        </div>
      )}

      <div className="card" id="printArea">
        <div style={{ textAlign: 'center', borderBottom: '2px solid var(--text-orange)', paddingBottom: 12, marginBottom: 16 }}>
          <h2 style={{ color: 'var(--text-orange)', margin: 0 }}>{company.name || 'S. HABIB STEEL & LASER CRAFT'}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0' }}>
            {company.tagline || ''}
          </p>
          <p style={{ fontSize: '0.8rem' }}>
            {[company.address, company.phones].filter(Boolean).join(' · ')}
          </p>
        </div>

        <div className="form-grid" style={{ marginBottom: 16 }}>
          <div><strong>Bill No:</strong> #{bill.sr_no}</div>
          <div><strong>Date:</strong> {bill.created_at?.slice(0, 16)}</div>
          <div><strong>Client:</strong> {bill.client_name}</div>
          <div><strong>Phone:</strong> {bill.client_phone || '—'}</div>
          <div><strong>Status:</strong> <StatusBadge status={bill.payment_status} /></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th><th>Category</th><th>Material / Gauge</th><th>Size (W×L)</th>
              <th>Pcs</th><th>Rate</th><th>Area</th><th>Bending</th><th>Total</th>
            </tr>
          </thead>
          <tbody>
            {frames.map((f, i) => {
              const tags = typeof f.tags === 'string' ? JSON.parse(f.tags || '[]') : (f.tags || [])
              const bendRate = parseFloat(f.bend_rate) || 0
              const bendCount = parseFloat(f.bend_count) || 0
              const bendTotal = bendRate * bendCount
              const isFancy = f.bill_category === 'fancy'
              const isBendOnly = f.bill_category === 'bending_only'
              return (
                <tr key={f.id || i}>
                  <td>{i + 1}</td>
                  <td>{CAT_LABELS[f.bill_category] || f.bill_category || '—'}</td>
                  <td>
                    {isBendOnly
                      ? 'Bending only'
                      : (f.material || f.cnc_material || '—')}
                    {!isBendOnly && (f.gauge || f.cnc_gauge) ? ` / ${f.gauge || f.cnc_gauge}` : ''}
                    {tags.length > 0 && <><br /><small className="text-muted">{tags.join(', ')}</small></>}
                    {f.bill_category === 'cnc_pipe' && (f.color_yes || f.color_no || f.fitting_yes || f.fitting_no) && (
                      <><br /><small className="text-muted">
                        Color: {f.color_yes ? 'Yes ✓' : f.color_no ? 'No' : '—'}
                        {' · '}
                        Fitting: {f.fitting_yes ? 'Yes ✓' : f.fitting_no ? 'No' : '—'}
                      </small></>
                    )}
                    {f.extra_item_name && <><br /><small>+ {f.extra_item_name}{f.extra_item_price ? ` (${Number(f.extra_item_price).toFixed(2)})` : ''}</small></>}
                  </td>
                  <td>
                    {isFancy
                      ? 'Direct'
                      : isBendOnly
                        ? '—'
                        : `${Number(f.width || 0).toFixed(2)} × ${Number(f.length || 0).toFixed(2)} ft`}
                  </td>
                  <td>{f.pcs}</td>
                  <td>{isFancy ? Number(f.direct_price || 0).toFixed(2) : isBendOnly ? '—' : Number(f.rate || 0).toFixed(2)}</td>
                  <td>{isBendOnly || isFancy ? '—' : Number(f.area || 0).toFixed(2)}</td>
                  <td>
                    {bendTotal > 0
                      ? <span title={`${bendCount} × ${bendRate}`}>{Number(bendTotal).toFixed(2)}</span>
                      : '—'}
                  </td>
                  <td><strong>{Number(f.total).toFixed(2)}</strong></td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {(() => {
          const billBendTotal = frames.reduce((s, f) => {
            const br = parseFloat(f.bend_rate) || 0
            const bc = parseFloat(f.bend_count) || 0
            return s + br * bc
          }, 0)
          return (
            <div className="grand-bar" style={{ marginTop: 20 }}>
              <div className="gt-item"><div className="gt-label">Grand Total</div><div className="gt-value">{fmt(bill.grand_total)}</div></div>
              {billBendTotal > 0 && (
                <div className="gt-item">
                  <div className="gt-label">Bending Total</div>
                  <div className="gt-value" style={{ color: 'var(--text-orange)' }}>{fmt(billBendTotal)}</div>
                </div>
              )}
              <div className="gt-item"><div className="gt-label">Discount</div><div className="gt-value">{fmt(bill.discount)}</div></div>
              <div className="gt-item"><div className="gt-label">Net Total</div><div className="gt-value">{fmt(bill.net_total)}</div></div>
              <div className="gt-item"><div className="gt-label">Paid</div><div className="gt-value green">{fmt(bill.paid_amount)}</div></div>
              <div className="gt-item"><div className="gt-label">Remaining</div><div className="gt-value red">{fmt(bill.remaining_balance)}</div></div>
            </div>
          )
        })()}

        {(company.pay_bank || company.pay_account_name || company.pay_account_1_display) && (
          <div style={{ marginTop: 18, padding: 12, background: 'var(--card-inner)', borderRadius: 8, fontSize: '0.85rem' }}>
            {company.pay_label && <><strong>{company.pay_label}:</strong>{' '}</>}
            {company.pay_bank && <>{company.pay_bank}<br /></>}
            {company.pay_account_name && <>Account: {company.pay_account_name}<br /></>}
            {company.pay_account_1_display && <>Account / IBAN: {company.pay_account_1_display}</>}
          </div>
        )}
        {company.developed_by && (
          <p style={{ textAlign: 'center', marginTop: 16, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {company.developed_by}
          </p>
        )}
      </div>

      <div className="card no-print mt-2">
        <div className="card-header"><h3>Payment History</h3></div>
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Note</th></tr></thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={3} className="text-muted">No payments yet</td></tr>}
            {payments.map(p => (
              <tr key={p.id}>
                <td>{p.paid_at}</td>
                <td>{fmt(p.amount)}</td>
                <td>{p.note || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showThermal && (
        <ThermalPrint bill={bill} onClose={() => setShowThermal(false)} />
      )}

      {showPay && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPay(false)}>
          <div className="modal">
            <h2>Add Payment — Bill #{bill.sr_no}</h2>
            <div className="form-group mb-1">
              <label>Amount (PKR)</label>
              <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} min="0.01" step="0.01" />
            </div>
            <div className="form-group mb-1">
              <label>Note</label>
              <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="e.g. Cash, Bank transfer" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowPay(false)}>Cancel</button>
              <button className="btn btn-green" onClick={submitPayment}>Save Payment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
