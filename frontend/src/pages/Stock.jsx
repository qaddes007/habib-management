import { useEffect, useState, useCallback } from 'react'
import { api, fmtNum, shareWhatsApp, shareAsImage, CNC_GAUGES } from '../api/client'
import { useAutoRefresh } from '../hooks/useLiveSync'

const SHEET_AREAS = { '4x8': 32, '5x8': 40, '4x10': 40, '5x10': 50 }
const MATERIALS = ['MS-CNC', 'SS-CNC', 'SG-CNC', 'GP']
const SIZES = ['4x8', '5x8', '4x10', '5x10']

const emptyForm = {
  material: 'MS-CNC',
  sheet_size: '4x8',
  gauge: '12 Gauge',
  quantity: 1,
  kg_per_sheet: '',
}

export default function Stock({ toast }) {
  const [tab, setTab] = useState('stock')
  const [rows, setRows] = useState([])
  const [usagePeriod, setUsagePeriod] = useState('all')
  const [report, setReport] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [filterMat, setFilterMat] = useState('')
  const [filterGauge, setFilterGauge] = useState('')
  const [loading, setLoading] = useState(true)

  const loadStock = useCallback(() => {
    setLoading(true)
    api.listStock()
      .then(d => setRows(d.data || []))
      .catch(e => toast(e.message, true))
      .finally(() => setLoading(false))
  }, [])

  const loadUsage = useCallback((period = usagePeriod) => {
    api.report(period)
      .then(d => {
        setReport(d)
      })
      .catch(e => toast(e.message, true))
  }, [usagePeriod])

  useEffect(() => { loadStock() }, [loadStock])
  useAutoRefresh(loadStock)

  useEffect(() => {
    if (tab === 'usage') {
      loadStock()
      loadUsage(usagePeriod)
    }
  }, [tab, usagePeriod])

  const saveStock = async () => {
    const qty = parseFloat(form.quantity) || 0
    if (qty <= 0) { toast('Quantity required', true); return }
    try {
      const result = await api.saveStock({
        material: form.material,
        gauge: form.gauge.includes('Gauge') ? form.gauge : form.gauge + ' Gauge',
        sheet_size: form.sheet_size,
        quantity: qty,
        kg_per_sheet: parseFloat(form.kg_per_sheet) || 0,
      })
      toast(result.pending ? 'Stock saved on this laptop; it will sync later.' : 'Stock saved')
      setForm(emptyForm)
      loadStock()
    } catch (e) { toast(e.message, true) }
  }

  const adjust = async (id) => {
    const delta = prompt('Quantity change (+ add / - remove):')
    if (delta === null || delta === '') return
    try {
      const result = await api.adjustStock({ id, delta: parseFloat(delta), reason: 'Manual adjust' })
      toast(result.pending ? 'Stock adjustment saved on this laptop; it will sync later.' : 'Stock adjusted')
      loadStock()
    } catch (e) { toast(e.message, true) }
  }

  const deleteStock = async (id, label) => {
    if (!confirm('Delete this stock entry?\n' + label + '\n\nThis cannot be undone.')) return
    try {
      const result = await api.deleteStock(id)
      toast(result.pending ? 'Stock deletion saved on this laptop; it will sync later.' : 'Stock deleted')
      loadStock()
    } catch (e) { toast(e.message, true) }
  }

  const filtered = rows.filter(r => {
    if (filterMat && r.material !== filterMat) return false
    if (filterGauge && !String(r.gauge).includes(filterGauge)) return false
    return true
  })

  const materialUsage = report?.material_usage || []
  const stockList = rows.length ? rows : (report?.stock || [])
  const gaugeOptions = [...new Set([
    ...CNC_GAUGES.map(g => `${g} Gauge`),
    ...stockList.map(s => String(s.gauge || '').trim()).filter(Boolean),
    ...materialUsage.map(m => String(m.gauge || '').trim()).filter(Boolean),
  ])].sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))
  const customGauge = !gaugeOptions.includes(form.gauge)
  const gaugeFilterOptions = [...new Set([
    ...CNC_GAUGES.map(String),
    ...stockList.map(s => String(s.gauge || '').replace(/[^0-9]/g, '')).filter(Boolean),
    ...materialUsage.map(m => String(m.gauge || '').replace(/[^0-9]/g, '')).filter(Boolean),
  ])].sort((a, b) => Number(a) - Number(b))

  const matchGauge = (gaugeStr, filterG) => {
    if (!filterG) return true
    const a = String(gaugeStr || '').replace(/[^0-9]/g, '')
    const b = String(filterG || '').replace(/[^0-9]/g, '')
    return a && b && a === b
  }

  const findKgPerSheet = (material, gauge, size) => {
    const gNum = String(gauge || '').replace(/[^0-9]/g, '')
    // 1) exact material + gauge + size
    let m = stockList.find(s =>
      s.material === material && matchGauge(s.gauge, gNum) && (!size || s.sheet_size === size)
    )
    // 2) material + gauge any size
    if (!m) {
      m = stockList.find(s => s.material === material && matchGauge(s.gauge, gNum))
    }
    // 3) material only (fallback avg kg)
    if (!m) {
      m = stockList.find(s => s.material === material && parseFloat(s.kg_per_sheet) > 0)
    }
    return m ? parseFloat(m.kg_per_sheet) || 0 : 0
  }

  const findStockQty = (material, gauge, size) => {
    const gNum = String(gauge || '').replace(/[^0-9]/g, '')
    const matches = stockList.filter(s => {
      if (material && s.material !== material) return false
      if (gNum && !matchGauge(s.gauge, gNum)) return false
      if (size && s.sheet_size !== size) return false
      return true
    })
    return matches.reduce((sum, s) => sum + (parseFloat(s.quantity) || 0), 0)
  }

  // Apply UI filters to usage + stock for cards
  const filteredUsage = materialUsage.filter(m => {
    if (filterMat && m.material !== filterMat) return false
    if (filterGauge && !matchGauge(m.gauge, filterGauge)) return false
    return true
  })

  const filteredStock = stockList.filter(s => {
    if (filterMat && s.material !== filterMat) return false
    if (filterGauge && !matchGauge(s.gauge, filterGauge)) return false
    return true
  })

  let totalUsedSqft = 0
  filteredUsage.forEach(m => { totalUsedSqft += parseFloat(m.total_area) || 0 })

  let currentStockSheets = 0
  let currentStockKg = 0
  filteredStock.forEach(s => {
    const qty = parseFloat(s.quantity) || 0
    const kg = parseFloat(s.kg_per_sheet) || 0
    currentStockSheets += qty
    currentStockKg += qty * kg
  })

  let estKgUsed = 0
  filteredUsage.forEach(m => {
    const area = parseFloat(m.total_area) || 0
    const sheetArea = SHEET_AREAS[m.sheet_size] || 32
    const sheets = area / sheetArea
    const kgPer = findKgPerSheet(m.material, m.gauge, m.sheet_size)
    estKgUsed += sheets * kgPer
  })

  const usageRows = filteredUsage.map(m => {
    const area = parseFloat(m.total_area) || 0
    const sheetArea = SHEET_AREAS[m.sheet_size] || 32
    const estSheets = area / sheetArea
    const kgPer = findKgPerSheet(m.material, m.gauge, m.sheet_size)
    const stockRemainSheets = findStockQty(m.material, m.gauge, m.sheet_size)
    return {
      material: m.material,
      gauge: m.gauge,
      sheet_size: m.sheet_size,
      items: m.items,
      used_sqft: area,
      est_sheets: estSheets,
      kg_used: estSheets * kgPer,
      kg_per_sheet: kgPer,
      stock_remain_sqft: stockRemainSheets * sheetArea,
    }
  })

  const shareStockWA = () => {
    const list = filtered.length ? filtered : rows
    const lines = [
      '*S. HABIB — TOTAL STOCK*',
      `Date: ${new Date().toLocaleString('en-PK')}`,
      '------------------------',
    ]
    if (!list.length) lines.push('No stock entries.')
    list.forEach(s => {
      lines.push(`${s.material} | ${s.gauge} | ${s.sheet_size} → Qty: ${s.quantity}${s.kg_per_sheet ? ` (${s.kg_per_sheet} kg/sheet)` : ''}`)
    })
    const totalQty = list.reduce((a, s) => a + (parseFloat(s.quantity) || 0), 0)
    lines.push('------------------------')
    lines.push(`Total sheets: *${totalQty}*`)
    shareAsImage('S. HABIB — TOTAL STOCK', lines, 'habib-stock.png').catch(() => shareWhatsApp(lines.join('\n')))
  }

  const shareUsageWA = () => {
    const lines = [
      '*S. HABIB — STOCK USAGE SUMMARY*',
      `Period: ${usagePeriod}`,
      `Date: ${new Date().toLocaleString('en-PK')}`,
      '------------------------',
      `Total Used: *${totalUsedSqft.toFixed(2)} Sq Ft*`,
      `Current Stock: *${currentStockSheets.toFixed(2)} sheets*`,
      `Stock KG: *${currentStockKg.toFixed(2)} Kg*`,
      `Est. KG Used: *${estKgUsed.toFixed(2)} Kg*`,
      '------------------------',
      '*Detail list:*',
    ]
    if (!usageRows.length) lines.push('No usage rows in this period.')
    usageRows.forEach((u, i) => {
      lines.push(`${i + 1}. ${u.material} | ${u.gauge} | ${u.sheet_size}`)
      lines.push(`   Used ${Number(u.used_sqft).toFixed(1)} sqft · ~${Number(u.est_sheets).toFixed(2)} sheets · Items: ${u.items} · Kg: ${Number(u.kg_used || 0).toFixed(1)}`)
    })
    lines.push('------------------------')
    lines.push(`Rows: ${usageRows.length}`)
    shareAsImage('S. HABIB — STOCK USAGE', lines, 'habib-usage.png').catch(() => shareWhatsApp(lines.join('\n')))
  }

  return (
    <div className="container">
      <div className="page-title">
        <span>CNC Sheet Stock &amp; Usage Tracker</span>
        <div className="btn-group">
          <button className="btn btn-wa btn-sm"
            onClick={() => tab === 'usage' ? shareUsageWA() : shareStockWA()}>
            📲 WA Business
          </button>
        </div>
      </div>
      <p className="text-muted" style={{ marginTop: -10, marginBottom: 16, fontSize: '0.85rem' }}>
        MS-CNC / SS-CNC / SG-CNC / GP: 4x8(32), 5x8(40), 4x10(40), 5x10(50) sq ft — stock name bill ke material se match hona chahiye
      </p>

      <div className="btn-group mb-2" style={{ width: '100%' }}>
        <button
          className="btn"
          style={{
            flex: 1, padding: '14px', fontSize: '1rem',
            background: tab === 'stock' ? '#22c55e' : '#2c3347',
            color: tab === 'stock' ? '#fff' : '#e8ecf4',
            border: '1px solid #3d4660',
          }}
          onClick={() => setTab('stock')}
        >
          + ADD STOCK
        </button>
        <button
          className="btn"
          style={{
            flex: 1, padding: '14px', fontSize: '1rem',
            background: tab === 'usage' ? '#3b82f6' : '#2c3347',
            color: tab === 'usage' ? '#fff' : '#e8ecf4',
            border: '1px solid #3d4660',
          }}
          onClick={() => setTab('usage')}
        >
          VIEW USAGE (Daily / Weekly / Monthly)
        </button>
      </div>

      <div className="btn-group mb-2" style={{ width: '100%' }}>
        <button
          type="button"
          className="btn btn-wa"
          style={{
            flex: 1, padding: '12px', fontSize: '0.95rem', fontWeight: 700,
            border: 'none',
          }}
          onClick={() => tab === 'usage' ? shareUsageWA() : shareStockWA()}
        >
          📲 WhatsApp Share {tab === 'usage' ? 'Usage Summary' : 'Total Stock'}
        </button>
      </div>

      {tab === 'stock' && (
        <>
          <div className="card">
            <div className="card-header">
              <h3 style={{ color: '#ea580c' }}>+ Add New Sheets to Stock</h3>
            </div>
            <div className="form-grid" style={{ alignItems: 'end' }}>
              <div className="form-group">
                <label>Material</label>
                <select value={form.material} onChange={e => setForm({ ...form, material: e.target.value })}>
                  {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Size</label>
                <select value={form.sheet_size} onChange={e => setForm({ ...form, sheet_size: e.target.value })}>
                  {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Gauge</label>
                <select value={customGauge ? '+ Write Own' : form.gauge} onChange={e => setForm({
                  ...form,
                  gauge: e.target.value === '+ Write Own' ? '' : e.target.value,
                })}>
                  {gaugeOptions.map(g => <option key={g} value={g}>{g}</option>)}
                  <option value="+ Write Own">+ Write Own</option>
                </select>
                {customGauge && (
                  <input value={form.gauge} onChange={e => setForm({ ...form, gauge: e.target.value })}
                    placeholder="Type gauge (e.g. 11 Gauge)" />
                )}
              </div>
              <div className="form-group">
                <label>Qty</label>
                <input type="number" value={form.quantity} min="0" step="0.01"
                  onChange={e => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Kg / Sheet</label>
                <input type="number" value={form.kg_per_sheet} min="0" step="0.01"
                  onChange={e => setForm({ ...form, kg_per_sheet: e.target.value })} />
              </div>
              <button className="btn btn-green" onClick={saveStock}>Save Stock</button>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Current Stock (newest first)</h3></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Material</th><th>Size</th><th>Gauge</th><th>Qty</th>
                    <th>Kg/Sheet</th><th>Total Kg</th><th>Total SqFt</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={8} className="loading">Loading…</td></tr>}
                  {!loading && filtered.length === 0 && (
                    <tr><td colSpan={8} className="empty-state">No stock entries — add sheets above</td></tr>
                  )}
                  {filtered.map(s => {
                    const area = SHEET_AREAS[s.sheet_size] || 32
                    const qty = parseFloat(s.quantity) || 0
                    const kg = parseFloat(s.kg_per_sheet) || 0
                    return (
                      <tr key={s.id}>
                        <td>{s.material}{(s.pending || s.pending_changes) && <span className="badge badge-unpaid" style={{ marginLeft: 8 }}>Pending sync</span>}</td>
                        <td>{s.sheet_size}</td>
                        <td>{s.gauge}</td>
                        <td><strong>{fmtNum(qty)}</strong></td>
                        <td>{fmtNum(kg)}</td>
                        <td>{fmtNum(qty * kg)}</td>
                        <td>{fmtNum(qty * area)}</td>
                        <td className="btn-group">
                          <button className="btn btn-orange btn-sm" onClick={() => adjust(s.id)} disabled={s.pending}>± Adjust</button>
                          <button className="btn btn-red btn-sm" onClick={() => deleteStock(s.id, s.material + ' ' + s.gauge + ' ' + s.sheet_size)}>Delete</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'usage' && (
        <>
          <div className="card mb-2">
            <div className="form-grid" style={{ alignItems: 'end' }}>
              <div className="form-group">
                <label>Filter Material</label>
                <select value={filterMat} onChange={e => setFilterMat(e.target.value)}>
                  <option value="">All Materials</option>
                  {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Filter Gauge</label>
                <select value={filterGauge} onChange={e => setFilterGauge(e.target.value)}>
                  <option value="">All Gauges</option>
                  {gaugeFilterOptions.map(g => <option key={g} value={g}>{g} Gauge</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="stats-bar" style={{ borderRadius: 10, marginBottom: 16, padding: 12 }}>
            <div className="stat-card">
              <div className="label">TOTAL USED</div>
              <div className="value" style={{ color: '#2563eb' }}>{fmtNum(totalUsedSqft)} Sq Ft</div>
            </div>
            <div className="stat-card green">
              <div className="label">CURRENT STOCK</div>
              <div className="value">{fmtNum(currentStockSheets)} sheets</div>
            </div>
            <div className="stat-card">
              <div className="label">STOCK KG</div>
              <div className="value" style={{ color: '#7c3aed' }}>{fmtNum(currentStockKg)} Kg</div>
            </div>
            <div className="stat-card">
              <div className="label">EST. KG USED</div>
              <div className="value" style={{ color: '#ea580c' }}>{fmtNum(estKgUsed)} Kg</div>
            </div>
          </div>

          <div className="btn-group mb-2">
            {['daily', 'weekly', 'monthly', 'all'].map(p => (
              <button
                key={p}
                className="btn btn-sm"
                style={{
                  background: usagePeriod === p ? '#f97316' : '#2c3347',
                  color: usagePeriod === p ? '#fff' : '#e8ecf4',
                  border: '1px solid #3d4660',
                }}
                onClick={() => setUsagePeriod(p)}
              >
                {p === 'all' ? 'All Time + Stock' : p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          {report && (
            <p className="text-muted mb-1" style={{ fontSize: '0.8rem' }}>
              Period: {report.from} → {report.to} · Rows: {usageRows.length}
            </p>
          )}

          <div className="card">
            <div className="card-header"><h3>Usage Summary by Material</h3></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Material</th><th>Gauge</th><th>Size Used</th><th>Used Pcs</th>
                    <th>Used SqFt</th><th>Est Sheets</th><th>Kg Used</th>
                    <th>Kg/Sheet</th><th>Stock Remain SqFt</th>
                  </tr>
                </thead>
                <tbody>
                  {usageRows.length === 0 && (
                    <tr><td colSpan={9} className="empty-state">
                      No matching records. Create a CNC Only / CNC+Pipe bill first.
                    </td></tr>
                  )}
                  {usageRows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.material}</td>
                        <td>{r.gauge}</td>
                        <td>{r.sheet_size}</td>
                        <td>{r.items}</td>
                        <td>{fmtNum(r.used_sqft)}</td>
                        <td>{fmtNum(r.est_sheets)}</td>
                        <td>{fmtNum(r.kg_used)}</td>
                        <td>{fmtNum(r.kg_per_sheet)}</td>
                        <td>{fmtNum(r.stock_remain_sqft)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Usage History (who / when)</h3></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Bill #</th><th>Client</th>
                    <th>Material</th><th>Gauge</th><th>Size</th>
                    <th>Pcs</th><th>SqFt Used</th>
                  </tr>
                </thead>
                <tbody>
                  {(report?.usage_detail || []).length === 0 && (
                    <tr><td colSpan={8} className="empty-state">No usage history yet</td></tr>
                  )}
                  {(report?.usage_detail || [])
                    .filter(r => {
                      if (filterMat && r.material !== filterMat) return false
                      if (filterGauge && !matchGauge(r.gauge, filterGauge)) return false
                      return true
                    })
                    .map((r, i) => (
                      <tr key={i}>
                        <td>{String(r.used_at || '').slice(0, 16)}</td>
                        <td>#{r.sr_no}</td>
                        <td>{r.client_name}</td>
                        <td>{r.material}</td>
                        <td>{r.gauge}</td>
                        <td>{r.sheet_size}</td>
                        <td>{r.pcs}</td>
                        <td>{fmtNum(r.area)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
