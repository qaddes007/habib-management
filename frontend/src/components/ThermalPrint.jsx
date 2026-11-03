import { CAT_LABELS } from '../api/client'

/**
 * 80mm thermal bill — clean columns + logo/QR side by side
 */
export default function ThermalPrint({ bill, onClose }) {
  if (!bill) return null

  const frames = bill.frames || []
  const company = bill.company || {}
  const billBend = frames.reduce(
    (s, f) => s + (parseFloat(f.bend_rate) || 0) * (parseFloat(f.bend_count) || 0),
    0
  )

  const printThermal = () => {
    const el = document.getElementById('thermal-print-area')
    if (!el) return
    const w = window.open('', '_blank', 'width=320,height=700')
    w.document.write(`<!DOCTYPE html><html><head><title>Thermal Bill #${bill.sr_no}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 11px; width: 76mm; color: #000; background: #fff; padding: 4px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 3px 2px; vertical-align: top; }
  th { border-bottom: 1px solid #000; font-size: 8px; text-transform: uppercase; }
  td { font-size: 9px; border-bottom: 1px dotted #ccc; }
  @media print { body { width: 76mm; } .no-print { display: none !important; } }
</style></head><body>${el.innerHTML}
<script>window.onload=function(){window.print();}</script></body></html>`)
    w.document.close()
  }

  const copyText = () => {
    const text = document.getElementById('thermal-text')?.innerText || ''
    navigator.clipboard?.writeText(text).then(() => alert('Copied!')).catch(() => {})
  }

  const money = (n) =>
    Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 360 }}>
        <h2 style={{ fontSize: '0.95rem' }}>80mm PRINT — Preview</h2>

        <div
          id="thermal-print-area"
          style={{
            background: '#fff',
            color: '#000',
            padding: 10,
            borderRadius: 6,
            fontFamily: "'Courier New', monospace",
            fontSize: 11,
            width: '100%',
            maxWidth: 280,
            margin: '0 auto',
            overflow: 'hidden',
          }}
        >
          <div id="thermal-text">
            {/* ===== Logo + QR side by side ===== */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
              }}
            >
              <div style={{ flex: '0 0 42%', textAlign: 'center' }}>
                <img
                  src="/logo.png.jpeg"
                  alt="logo"
                  style={{
                    maxWidth: 72,
                    maxHeight: 72,
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    display: 'block',
                    margin: '0 auto',
                    filter: 'grayscale(1) contrast(1.1)',
                  }}
                  onError={e => { e.target.style.display = 'none' }}
                />
              </div>
              <div style={{ flex: '0 0 52%', textAlign: 'center' }}>
                <img
                  src="/qrcode.png"
                  alt="qr"
                  style={{
                    maxWidth: 58,
                    maxHeight: 58,
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    display: 'block',
                    margin: '0 auto',
                  }}
                  onError={e => { e.target.style.display = 'none' }}
                />
                <div style={{ fontSize: 7, marginTop: 2 }}>SCAN TO OPEN TIKTOK</div>
              </div>
            </div>

            <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 11, lineHeight: 1.2 }}>
              S. HABIB STEEL &amp; LASER CRAFT
            </div>
            <div style={{ textAlign: 'center', fontSize: 8, lineHeight: 1.35, marginTop: 2 }}>
              {company.tagline || ''}
              {company.phones && <><br />{company.phones}</>}
            </div>

            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
              <span>Bill #{bill.sr_no}</span>
              <span>{bill.created_at?.slice(0, 16)}</span>
            </div>
            <div style={{ textAlign: 'center', fontSize: 10, marginTop: 2 }}>
              {bill.client_name}
              {bill.client_phone ? ` | ${bill.client_phone}` : ''}
            </div>

            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

            {/* ===== Items table — each header in its own column ===== */}
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
              }}
            >
              <thead>
                <tr>
                  <th style={{ width: '7%', textAlign: 'left', fontSize: 8, borderBottom: '1px solid #000', padding: '3px 1px' }}>#</th>
                  <th style={{ width: '26%', textAlign: 'left', fontSize: 8, borderBottom: '1px solid #000', padding: '3px 1px' }}>MAT</th>
                  <th style={{ width: '10%', textAlign: 'center', fontSize: 8, borderBottom: '1px solid #000', padding: '3px 1px' }}>G</th>
                  <th style={{ width: '14%', textAlign: 'center', fontSize: 8, borderBottom: '1px solid #000', padding: '3px 1px' }}>SIZE</th>
                  <th style={{ width: '12%', textAlign: 'center', fontSize: 8, borderBottom: '1px solid #000', padding: '3px 1px' }}>SQFT</th>
                  <th style={{ width: '13%', textAlign: 'center', fontSize: 8, borderBottom: '1px solid #000', padding: '3px 1px' }}>RATE</th>
                  <th style={{ width: '18%', textAlign: 'right', fontSize: 8, borderBottom: '1px solid #000', padding: '3px 1px' }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {frames.map((f, i) => {
                  const gauge = (f.cnc_gauge || f.gauge || '').replace(/ Gauge/gi, '')
                  const mat = (f.material || f.cnc_material || '—').slice(0, 14)
                  const catLabel = CAT_LABELS[f.bill_category] || ''
                  const w = Number(f.width) || 0
                  const l = Number(f.length) || 0
                  const isFancy = f.bill_category === 'fancy'
                  const isBendOnly = f.bill_category === 'bending_only'
                  const sizeStr = isFancy || isBendOnly ? '—' : `${w}x${l}`
                  const colorFit = []
                  if (f.bill_category === 'cnc_pipe') {
                    if (f.color_yes) colorFit.push('Color:Y')
                    else if (f.color_no) colorFit.push('Color:N')
                    if (f.fitting_yes) colorFit.push('Fit:Y')
                    else if (f.fitting_no) colorFit.push('Fit:N')
                  }
                  const tags = typeof f.tags === 'string' ? JSON.parse(f.tags || '[]') : (f.tags || [])

                  return (
                    <tr key={i}>
                      <td style={{ fontSize: 9, padding: '4px 1px', verticalAlign: 'top', borderBottom: '1px dotted #bbb' }}>
                        {i + 1}
                      </td>
                      <td style={{ fontSize: 8, padding: '4px 1px', verticalAlign: 'top', borderBottom: '1px dotted #bbb', lineHeight: 1.25 }}>
                        <div style={{ fontWeight: 'bold' }}>{mat}</div>
                        {catLabel ? <div style={{ fontSize: 7 }}>{catLabel}</div> : null}
                        {tags.length > 0 ? <div style={{ fontSize: 7 }}>{tags.join(', ')}</div> : null}
                        {colorFit.length > 0 ? <div style={{ fontSize: 7 }}>{colorFit.join(' ')}</div> : null}
                      </td>
                      <td style={{ fontSize: 9, textAlign: 'center', padding: '4px 1px', verticalAlign: 'top', borderBottom: '1px dotted #bbb' }}>
                        {gauge || '—'}
                      </td>
                      <td style={{ fontSize: 8, textAlign: 'center', padding: '4px 1px', verticalAlign: 'top', borderBottom: '1px dotted #bbb' }}>
                        {sizeStr}
                      </td>
                      <td style={{ fontSize: 9, textAlign: 'center', padding: '4px 1px', verticalAlign: 'top', borderBottom: '1px dotted #bbb' }}>
                        {isBendOnly || isFancy ? '—' : Number(f.area || 0).toFixed(0)}
                      </td>
                      <td style={{ fontSize: 9, textAlign: 'center', padding: '4px 1px', verticalAlign: 'top', borderBottom: '1px dotted #bbb' }}>
                        {isBendOnly ? '—' : money(f.rate || f.direct_price || 0)}
                      </td>
                      <td style={{ fontSize: 9, textAlign: 'right', padding: '4px 1px', verticalAlign: 'top', borderBottom: '1px dotted #bbb', fontWeight: 'bold' }}>
                        {money(f.total)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

            {billBend > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                <span>Bending Total</span>
                <span>PKR {money(billBend)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
              <span>Grand Total</span>
              <span>PKR {money(bill.grand_total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
              <span>Discount</span>
              <span>PKR {money(bill.discount)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
              <span>Paid</span>
              <span>PKR {money(bill.paid_amount)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 11 }}>
              <span>Due</span>
              <span>PKR {money(bill.remaining_balance)}</span>
            </div>

            <div style={{ borderTop: '1px double #000', margin: '6px 0' }} />

            <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 9 }}>
              QUALITY • ACCURACY • RELIABILITY
            </div>
            <div style={{ textAlign: 'center', fontSize: 8, marginTop: 2 }}>
              Developed by : ENGR.UsamaRehman :<br />
              03158323077
            </div>
            <div style={{ textAlign: 'center', fontWeight: 'bold', margin: '4px 0', fontSize: 10 }}>
              *** Thank You ***
            </div>

            <div style={{ textAlign: 'center', marginTop: 6 }}>
              <div style={{ fontSize: 8 }}>Shop Location</div>
              <img
                src="/address.png"
                alt="location"
                style={{ maxWidth: '100%', marginTop: 3 }}
                onError={e => { e.target.style.display = 'none' }}
              />
            </div>
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-green btn-sm" onClick={copyText}>Copy Text</button>
          <button className="btn btn-blue btn-sm" onClick={printThermal}>Print 80mm Bill</button>
          <button className="btn btn-red btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
