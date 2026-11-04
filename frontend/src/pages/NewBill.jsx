import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api, fmt,
  STANDARD_MATERIALS, CNC_PIPE_MATERIALS, CNC_GAUGES, PIPE_GAUGES
} from '../api/client'

let nextId = 1

function emptyFrame(cat = 'cnc_only') {
  return {
    _id: nextId++,
    bill_category: cat,
    material: cat === 'pipe_grill' ? 'MS-PIPE' : cat === 'cnc_pipe' ? 'MS(Pipe)-MS-CNC' : cat === 'bending_sheet' ? 'GP' : 'MS-CNC',
    gauge: '12 Gauge',
    pipe_gauge: '12 Gauge',
    cnc_gauge: '12 Gauge',
    width: '',
    length: '',
    rate: '',
    pcs: 1,
    direct_price: '',
    extra_item_name: '',
    extra_item_price: '',
    sheet_size: '4x8',
    item_name: '',
    // CNC+Pipe tags
    tag_frame_pipe: false,
    tag_gola: false,
    tag_master: false,
    color_yes: false,
    color_no: true,
    fitting_yes: true,
    fitting_no: false,
    // Expand fields when tags checked
    pipe_tag_gauge: '12 Gauge',
    pipe_tag_size: '',
    gola_tag_gauge: '12 Gauge',
    gola_tag_size: '',
    master_tag_gauge: '12 Gauge',
    master_tag_size: '',
    bend_rate: '',
    bend_count: '',
    custom_material: '',
  }
}

function calcFrameTotal(f) {
  const pcs = Math.max(1, parseInt(f.pcs) || 1)
  const extra = parseFloat(f.extra_item_price) || 0
  const bendRate = parseFloat(f.bend_rate) || 0
  const bendCount = parseFloat(f.bend_count) || 0
  const bendTotal = bendRate * bendCount

  if (f.bill_category === 'fancy') {
    return pcs * (parseFloat(f.direct_price) || 0) + extra
  }
  if (f.bill_category === 'bending_only') {
    return bendTotal + extra
  }
  if (f.bill_category === 'bending_sheet') {
    const w = parseFloat(f.width) || 0
    const l = parseFloat(f.length) || 0
    const r = parseFloat(f.rate) || 0
    return w * l * pcs * r + bendTotal + extra
  }
  const w = parseFloat(f.width) || 0
  const l = parseFloat(f.length) || 0
  const r = parseFloat(f.rate) || 0
  return w * l * pcs * r + extra
}

const SHEET_OPTIONS = ['4x8', '5x8', '4x10', '5x10']
const MAT_LIST = ['MS-CNC', 'SS-CNC', 'SG-CNC', 'GP']

function isPresetGauge(value, list) {
  if (!value) return true
  return list.some(g => value === g + ' Gauge' || value === String(g))
}

function GaugeSelect({ value, list, onChange }) {
  const preset = isPresetGauge(value, list)
  const selectVal = preset ? (value || (list[0] + ' Gauge')) : '+ Write Own'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <select value={selectVal} onChange={e => {
        if (e.target.value === '+ Write Own') onChange('')
        else onChange(e.target.value)
      }}>
        {list.map(g => (
          <option key={g} value={g + ' Gauge'}>{g} Gauge</option>
        ))}
        <option value="+ Write Own">+ Write Own</option>
      </select>
      {!preset && (
        <input
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder="Type gauge e.g. 11 Gauge"
        />
      )}
    </div>
  )
}

function SheetSelect({ value, onChange }) {
  const preset = SHEET_OPTIONS.includes(value)
  const selectVal = preset ? (value || '4x8') : '+ Write Own'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <select value={selectVal} onChange={e => {
        if (e.target.value === '+ Write Own') onChange('')
        else onChange(e.target.value)
      }}>
        <option value="4x8">4x8 (32 sqft)</option>
        <option value="5x8">5x8 (40 sqft)</option>
        <option value="4x10">4x10 (40 sqft)</option>
        <option value="5x10">5x10 (50 sqft)</option>
        <option value="+ Write Own">+ Write Own</option>
      </select>
      {!preset && (
        <input
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder="Type size e.g. 3x6"
        />
      )}
    </div>
  )
}

function MaterialSelect({ value, onChange, customValue, onCustomChange, extraOptions = [] }) {
  const all = [...MAT_LIST, ...extraOptions]
  const preset = all.includes(value)
  const selectVal = preset ? value : '+ Write Own'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <select value={selectVal} onChange={e => onChange(e.target.value)}>
        {all.map(m => <option key={m} value={m}>{m}</option>)}
        <option value="+ Write Own">+ Write Own</option>
      </select>
      {selectVal === '+ Write Own' && (
        <input
          value={customValue || ''}
          onChange={e => onCustomChange(e.target.value)}
          placeholder="Type material name"
        />
      )}
    </div>
  )
}

function FrameCard({ frame, index, onChange, onRemove, canRemove }) {
  const set = (key, val) => onChange({ ...frame, [key]: val })
  const setCat = (cat) => {
    onChange({
      ...emptyFrame(cat),
      _id: frame._id,
    })
  }
  const total = calcFrameTotal(frame)
  const cat = frame.bill_category

  return (
    <div className="frame-card">
      <span className="frame-num">#{index + 1}</span>
      <div className="cat-tabs">
        {[
          ['cnc_only', 'CNC Only'],
          ['cnc_pipe', 'CNC + Pipe'],
          ['fancy', 'Fancy / Others'],
          ['pipe_grill', 'Pipe Grill'],
          ['bending_sheet', 'Bending + Sheet'],
          ['bending_only', 'Only Bending'],
        ].map(([c, label]) => (
          <button key={c} type="button" className={'cat-tab' + (cat === c ? ' active' : '')}
            onClick={() => setCat(c)}>
            {label}
          </button>
        ))}
      </div>

      <div className="form-grid">
        {/* ===== FANCY ===== */}
        {cat === 'fancy' && (
          <>
            <div className="form-group">
              <label>Sheet Size Used</label>
              <SheetSelect value={frame.sheet_size} onChange={v => set('sheet_size', v)} />
            </div>
            <div className="form-group">
              <label>Material</label>
              <MaterialSelect
                value={frame.material}
                onChange={v => set('material', v)}
                customValue={frame.custom_material}
                onCustomChange={v => set('custom_material', v)}
              />
            </div>
            <div className="form-group">
              <label>Gauge</label>
              <GaugeSelect value={frame.gauge} list={CNC_GAUGES} onChange={v => set('gauge', v)} />
            </div>
            <div className="form-group">
              <label>Item Name</label>
              <input value={frame.item_name || frame.extra_item_name} onChange={e => { set('item_name', e.target.value); set('extra_item_name', e.target.value) }} placeholder="e.g. Design work" />
            </div>
            <div className="form-group">
              <label>Pcs</label>
              <input type="number" value={frame.pcs} onChange={e => set('pcs', e.target.value)} min="1" />
            </div>
            <div className="form-group">
              <label>Direct Price (PKR)</label>
              <input type="number" value={frame.direct_price} onChange={e => set('direct_price', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Extra Item</label>
              <input value={frame.extra_item_name} onChange={e => set('extra_item_name', e.target.value)} placeholder="optional" />
            </div>
            <div className="form-group">
              <label>Price (PKR)</label>
              <input type="number" value={frame.extra_item_price} onChange={e => set('extra_item_price', e.target.value)} min="0" step="0.01" />
            </div>
          </>
        )}

        {/* ===== PIPE GRILL ===== */}
        {cat === 'pipe_grill' && (
          <>
            <div className="form-group">
              <label>Material</label>
              <select value={frame.material} onChange={e => set('material', e.target.value)}>
                <option value="MS-PIPE">MS-PIPE</option>
                <option value="SS-PIPE">SS-PIPE</option>
                <option value="+ Write Own">+ Write Own</option>
              </select>
            </div>
            <div className="form-group">
              <label>Pipe Gauge</label>
              <GaugeSelect value={frame.pipe_gauge} list={PIPE_GAUGES} onChange={v => set('pipe_gauge', v)} />
            </div>
            <div className="form-group">
              <label>Pcs</label>
              <input type="number" value={frame.pcs} onChange={e => set('pcs', e.target.value)} min="1" />
            </div>
            <div className="form-group">
              <label>W (ft)</label>
              <input type="number" value={frame.width} onChange={e => set('width', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>L (ft)</label>
              <input type="number" value={frame.length} onChange={e => set('length', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Rate</label>
              <input type="number" value={frame.rate} onChange={e => set('rate', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Extra Item</label>
              <input value={frame.extra_item_name} onChange={e => set('extra_item_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Price (PKR)</label>
              <input type="number" value={frame.extra_item_price} onChange={e => set('extra_item_price', e.target.value)} min="0" step="0.01" />
            </div>
          </>
        )}

        {/* ===== CNC ONLY ===== */}
        {cat === 'cnc_only' && (
          <>
            <div className="form-group">
              <label>Material</label>
              <MaterialSelect
                value={frame.material}
                onChange={v => set('material', v)}
                customValue={frame.custom_material}
                onCustomChange={v => set('custom_material', v)}
              />
            </div>
            <div className="form-group">
              <label>Gauge</label>
              <GaugeSelect value={frame.gauge} list={CNC_GAUGES} onChange={v => set('gauge', v)} />
            </div>
            <div className="form-group">
              <label>Sheet Size</label>
              <SheetSelect value={frame.sheet_size} onChange={v => set('sheet_size', v)} />
            </div>
            <div className="form-group">
              <label>W (ft)</label>
              <input type="number" value={frame.width} onChange={e => set('width', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>L (ft)</label>
              <input type="number" value={frame.length} onChange={e => set('length', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Rate (per sq ft)</label>
              <input type="number" value={frame.rate} onChange={e => set('rate', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Pcs</label>
              <input type="number" value={frame.pcs} onChange={e => set('pcs', e.target.value)} min="1" />
            </div>
            <div className="form-group">
              <label>Extra Item</label>
              <input value={frame.extra_item_name} onChange={e => set('extra_item_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Price (PKR)</label>
              <input type="number" value={frame.extra_item_price} onChange={e => set('extra_item_price', e.target.value)} min="0" step="0.01" />
            </div>
          </>
        )}

        {/* ===== CNC + PIPE ===== */}
        {cat === 'cnc_pipe' && (
          <>
            {/* Tag checkboxes — Frame Pipe / Gola / Master + Color / Fitting same row */}
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Tags / Options</label>
              <div style={{
                display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 8, alignItems: 'center',
                background: 'var(--entry-bg)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)',
              }}>
                <label style={{ fontSize: '0.88rem', color: 'var(--text)', display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={!!frame.tag_frame_pipe}
                    onChange={e => set('tag_frame_pipe', e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--text-orange)' }} />
                  Frame Pipe
                </label>
                <label style={{ fontSize: '0.88rem', color: 'var(--text)', display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={!!frame.tag_gola}
                    onChange={e => set('tag_gola', e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--text-orange)' }} />
                  Gola
                </label>
                <label style={{ fontSize: '0.88rem', color: 'var(--text)', display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={!!frame.tag_master}
                    onChange={e => set('tag_master', e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--text-orange)' }} />
                  Master
                </label>
                <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Color:</span>
                <label style={{ fontSize: '0.88rem', color: 'var(--text)', display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={!!frame.color_yes}
                    onChange={e => {
                      const on = e.target.checked
                      onChange({ ...frame, color_yes: on, color_no: on ? false : frame.color_no })
                    }}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--text-orange)' }} />
                  Yes
                </label>
                <label style={{ fontSize: '0.88rem', color: 'var(--text)', display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={!!frame.color_no}
                    onChange={e => {
                      const on = e.target.checked
                      onChange({ ...frame, color_no: on, color_yes: on ? false : frame.color_yes })
                    }}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--text-orange)' }} />
                  No
                </label>
                <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Fitting:</span>
                <label style={{ fontSize: '0.88rem', color: 'var(--text)', display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={!!frame.fitting_yes}
                    onChange={e => {
                      const on = e.target.checked
                      onChange({ ...frame, fitting_yes: on, fitting_no: on ? false : frame.fitting_no })
                    }}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--text-orange)' }} />
                  Yes
                </label>
                <label style={{ fontSize: '0.88rem', color: 'var(--text)', display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={!!frame.fitting_no}
                    onChange={e => {
                      const on = e.target.checked
                      onChange({ ...frame, fitting_no: on, fitting_yes: on ? false : frame.fitting_yes })
                    }}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--text-orange)' }} />
                  No
                </label>
              </div>
            </div>

            <div className="form-group">
              <label>Material</label>
              <MaterialSelect
                value={frame.material}
                onChange={v => set('material', v)}
                customValue={frame.custom_material}
                onCustomChange={v => set('custom_material', v)}
                extraOptions={CNC_PIPE_MATERIALS}
              />
            </div>
            <div className="form-group">
              <label>Pipe Gauge</label>
              <GaugeSelect value={frame.pipe_gauge} list={PIPE_GAUGES} onChange={v => set('pipe_gauge', v)} />
            </div>
            <div className="form-group">
              <label>CNC Gauge</label>
              <GaugeSelect value={frame.cnc_gauge || frame.gauge} list={CNC_GAUGES} onChange={v => { set('cnc_gauge', v); set('gauge', v) }} />
            </div>
            <div className="form-group">
              <label>Sheet Size Used</label>
              <SheetSelect value={frame.sheet_size} onChange={v => set('sheet_size', v)} />
            </div>
            <div className="form-group">
              <label>Pcs</label>
              <input type="number" value={frame.pcs} onChange={e => set('pcs', e.target.value)} min="1" />
            </div>
            <div className="form-group">
              <label>W (ft)</label>
              <input type="number" value={frame.width} onChange={e => set('width', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>L (ft)</label>
              <input type="number" value={frame.length} onChange={e => set('length', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Rate</label>
              <input type="number" value={frame.rate} onChange={e => set('rate', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Extra Item</label>
              <input value={frame.extra_item_name} onChange={e => set('extra_item_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Price (PKR)</label>
              <input type="number" value={frame.extra_item_price} onChange={e => set('extra_item_price', e.target.value)} min="0" step="0.01" />
            </div>

            {/* Frame Pipe / Gola / Master details — same row */}
            {(frame.tag_frame_pipe || frame.tag_gola || frame.tag_master) && (
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 10,
                }}>
                  {frame.tag_frame_pipe && (
                    <div style={{ background: 'var(--entry-bg)', padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
                      <label style={{ color: 'var(--text-orange)', marginBottom: 6, display: 'block' }}>▸ Frame Pipe</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div className="form-group">
                          <label>Pipe Gauge</label>
                          <GaugeSelect value={frame.pipe_tag_gauge} list={PIPE_GAUGES} onChange={v => set('pipe_tag_gauge', v)} />
                        </div>
                        <div className="form-group">
                          <label>Pipe Size (in)</label>
                          <input value={frame.pipe_tag_size} onChange={e => set('pipe_tag_size', e.target.value)} placeholder="e.g. 1.5" />
                        </div>
                      </div>
                    </div>
                  )}
                  {frame.tag_gola && (
                    <div style={{ background: 'var(--entry-bg)', padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
                      <label style={{ color: 'var(--text-orange)', marginBottom: 6, display: 'block' }}>▸ Gola</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div className="form-group">
                          <label>Gola Gauge</label>
                          <GaugeSelect value={frame.gola_tag_gauge} list={PIPE_GAUGES} onChange={v => set('gola_tag_gauge', v)} />
                        </div>
                        <div className="form-group">
                          <label>Gola Size (in)</label>
                          <input value={frame.gola_tag_size} onChange={e => set('gola_tag_size', e.target.value)} placeholder="e.g. 1" />
                        </div>
                      </div>
                    </div>
                  )}
                  {frame.tag_master && (
                    <div style={{ background: 'var(--entry-bg)', padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
                      <label style={{ color: 'var(--text-orange)', marginBottom: 6, display: 'block' }}>▸ Master</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div className="form-group">
                          <label>Master Gauge</label>
                          <GaugeSelect value={frame.master_tag_gauge} list={PIPE_GAUGES} onChange={v => set('master_tag_gauge', v)} />
                        </div>
                        <div className="form-group">
                          <label>Master Size (in)</label>
                          <input value={frame.master_tag_size} onChange={e => set('master_tag_size', e.target.value)} placeholder="e.g. 2" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== BENDING + SHEET ===== */}
        {cat === 'bending_sheet' && (
          <>
            <div className="form-group">
              <label>Material</label>
              <MaterialSelect
                value={frame.material}
                onChange={v => set('material', v)}
                customValue={frame.custom_material}
                onCustomChange={v => set('custom_material', v)}
              />
            </div>
            <div className="form-group">
              <label>Gauge</label>
              <GaugeSelect value={frame.gauge} list={CNC_GAUGES} onChange={v => { set('gauge', v); set('cnc_gauge', v) }} />
            </div>
            <div className="form-group">
              <label>Sheet Size</label>
              <SheetSelect value={frame.sheet_size} onChange={v => set('sheet_size', v)} />
            </div>
            <div className="form-group">
              <label>Pcs</label>
              <input type="number" value={frame.pcs} onChange={e => set('pcs', e.target.value)} min="1" />
            </div>
            <div className="form-group">
              <label>W (ft)</label>
              <input type="number" value={frame.width} onChange={e => set('width', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>L (ft)</label>
              <input type="number" value={frame.length} onChange={e => set('length', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Rate (per sq ft)</label>
              <input type="number" value={frame.rate} onChange={e => set('rate', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Total Sq Ft</label>
              <input type="text" readOnly
                value={((parseFloat(frame.width)||0)*(parseFloat(frame.length)||0)*Math.max(1,parseInt(frame.pcs)||1)).toFixed(2)}
                style={{ opacity: 0.85 }} />
            </div>
            <div className="form-group">
              <label>Rate per Bend</label>
              <input type="number" value={frame.bend_rate} onChange={e => set('bend_rate', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Total Bends</label>
              <input type="number" value={frame.bend_count} onChange={e => set('bend_count', e.target.value)} min="0" step="1" />
            </div>
            <div className="form-group">
              <label>Bending Total</label>
              <input type="text" readOnly
                value={((parseFloat(frame.bend_rate)||0)*(parseFloat(frame.bend_count)||0)).toFixed(2)}
                style={{ opacity: 0.85 }} />
            </div>
            <div className="form-group">
              <label>Extra Item</label>
              <input value={frame.extra_item_name} onChange={e => set('extra_item_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Price (PKR)</label>
              <input type="number" value={frame.extra_item_price} onChange={e => set('extra_item_price', e.target.value)} min="0" step="0.01" />
            </div>
          </>
        )}

        {/* ===== ONLY BENDING ===== */}
        {cat === 'bending_only' && (
          <>
            <div className="form-group">
              <label>Rate per Bend</label>
              <input type="number" value={frame.bend_rate} onChange={e => set('bend_rate', e.target.value)} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label>Total Bends</label>
              <input type="number" value={frame.bend_count} onChange={e => set('bend_count', e.target.value)} min="0" step="1" />
            </div>
            <div className="form-group">
              <label>Bending Total</label>
              <input type="text" readOnly
                value={((parseFloat(frame.bend_rate)||0)*(parseFloat(frame.bend_count)||0)).toFixed(2)}
                style={{ opacity: 0.85 }} />
            </div>
            <div className="form-group">
              <label>Notes / Description</label>
              <input value={frame.extra_item_name} onChange={e => set('extra_item_name', e.target.value)} placeholder="Optional" />
            </div>
            <div className="form-group">
              <label>Extra (PKR)</label>
              <input type="number" value={frame.extra_item_price} onChange={e => set('extra_item_price', e.target.value)} min="0" step="0.01" />
            </div>
          </>
        )}
      </div>

      <div className="frame-total">{fmt(total)}</div>
      {canRemove && (
        <div className="mt-1">
          <button type="button" className="btn btn-red btn-sm" onClick={onRemove}>Delete</button>
        </div>
      )}
    </div>
  )
}

function isLocked(bill) {
  if (!bill || bill.payment_status !== 'PAID') return false
  const created = new Date(bill.created_at.replace(' ', 'T'))
  const ageMs = Date.now() - created.getTime()
  return ageMs > 30 * 24 * 60 * 60 * 1000 // 30 days
}

function frameFromApi(f) {
  const tags = typeof f.tags === 'string' ? JSON.parse(f.tags || '[]') : (f.tags || [])
  return {
    _id: nextId++,
    bill_category: f.bill_category || 'cnc_only',
    material: f.material || f.cnc_material || 'MS-CNC',
    gauge: f.gauge || f.cnc_gauge || '12 Gauge',
    pipe_gauge: f.pipe_gauge || '12 Gauge',
    cnc_gauge: f.cnc_gauge || f.gauge || '12 Gauge',
    width: f.width ?? '',
    length: f.length ?? '',
    rate: f.rate ?? '',
    pcs: f.pcs || 1,
    direct_price: f.direct_price ?? '',
    extra_item_name: f.extra_item_name || '',
    extra_item_price: f.extra_item_price ?? '',
    sheet_size: f.sheet_size || '4x8',
    item_name: f.extra_item_name || '',
    tag_frame_pipe: tags.includes('Frame Pipe'),
    tag_gola: tags.includes('Gola'),
    tag_master: tags.includes('Master'),
    color_yes: !!f.color_yes,
    color_no: !!f.color_no,
    fitting_yes: !!f.fitting_yes,
    fitting_no: !!f.fitting_no,
    pipe_tag_gauge: f.pipe_tag_gauge || '12 Gauge',
    pipe_tag_size: f.pipe_tag_size || '',
    gola_tag_gauge: f.gola_tag_gauge || '12 Gauge',
    gola_tag_size: f.gola_tag_size || '',
    master_tag_gauge: f.master_tag_gauge || '12 Gauge',
    master_tag_size: f.master_tag_size || '',
    bend_rate: f.bend_rate ?? '',
    bend_count: f.bend_count ?? '',
  }
}

export default function NewBill({ toast }) {
  const navigate = useNavigate()
  const { id: editId } = useParams()
  const isEdit = !!editId
  const [srNo, setSrNo] = useState('…')
  const [billId, setBillId] = useState(null)
  const [locked, setLocked] = useState(false)
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [discount, setDiscount] = useState(0)
  const [paid, setPaid] = useState(0)
  const [notes, setNotes] = useState('')
  const [frames, setFrames] = useState([emptyFrame()])
  const [saving, setSaving] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(!!editId)

  useEffect(() => {
    if (!isEdit) {
      api.nextSr().then(d => setSrNo(d.next_sr)).catch(() => {})
      return
    }
    setLoadingEdit(true)
    api.getBill(editId)
      .then(d => {
        const b = d.data
        if (!b) { toast('Bill not found', true); navigate('/bills'); return }
        if (b.pending) {
          toast('Offline pending bill cannot be edited yet. It will receive its final bill number after sync.', true)
          navigate('/bills')
          return
        }
        if (isLocked(b)) {
          setLocked(true)
          toast('This bill is PAID and older than 30 days — locked (print only)', true)
        }
        setBillId(b.id)
        setSrNo(b.sr_no)
        setClientName(b.client_name || '')
        setClientPhone(b.client_phone || '')
        setDiscount(b.discount || 0)
        setPaid(b.paid_amount || 0)
        setNotes(b.notes || '')
        const fl = (b.frames || []).map(frameFromApi)
        setFrames(fl.length ? fl : [emptyFrame()])
      })
      .catch(e => { toast(e.message, true); navigate('/bills') })
      .finally(() => setLoadingEdit(false))
  }, [editId])

  const updateFrame = useCallback((idx, f) => {
    setFrames(prev => prev.map((x, i) => i === idx ? f : x))
  }, [])

  const removeFrame = (idx) => {
    if (frames.length <= 1) { toast('At least one frame required', true); return }
    setFrames(prev => prev.filter((_, i) => i !== idx))
  }

  const grand = frames.reduce((s, f) => s + calcFrameTotal(f), 0)
  const net = Math.max(0, grand - (parseFloat(discount) || 0))
  const remaining = Math.max(0, net - (parseFloat(paid) || 0))

  const save = async () => {
    if (!clientName.trim()) { toast('Client name is required', true); return }
    setSaving(true)
    try {
      const payload = {
        client_name: clientName.trim(),
        client_phone: clientPhone.trim(),
        discount: parseFloat(discount) || 0,
        paid_amount: parseFloat(paid) || 0,
        notes,
        frames: frames.map(f => {
          const tags = []
          if (f.tag_frame_pipe) tags.push('Frame Pipe')
          if (f.tag_gola) tags.push('Gola')
          if (f.tag_master) tags.push('Master')
          return {
            bill_category: f.bill_category,
            material: f.material === '+ Write Own' ? (f.custom_material || 'CUSTOM') : f.material,
            cnc_material: f.material,
            gauge: f.gauge,
            cnc_gauge: f.cnc_gauge || f.gauge,
            pipe_gauge: f.pipe_gauge,
            width: parseFloat(f.width) || 0,
            length: parseFloat(f.length) || 0,
            rate: parseFloat(f.rate) || 0,
            pcs: Math.max(1, parseInt(f.pcs) || 1),
            direct_price: parseFloat(f.direct_price) || 0,
            extra_item_name: f.extra_item_name || f.item_name || '',
            extra_item_price: parseFloat(f.extra_item_price) || 0,
            sheet_size: f.sheet_size || '4x8',
            tags,
            color_yes: !!f.color_yes,
            color_no: !!f.color_no,
            fitting_yes: !!f.fitting_yes,
            fitting_no: !!f.fitting_no,
            pipe_tag_gauge: f.pipe_tag_gauge || '',
            pipe_tag_size: f.pipe_tag_size || '',
            gola_tag_gauge: f.gola_tag_gauge || '',
            gola_tag_size: f.gola_tag_size || '',
            master_tag_gauge: f.master_tag_gauge || '',
            master_tag_size: f.master_tag_size || '',
            bend_rate: parseFloat(f.bend_rate) || 0,
            bend_count: parseFloat(f.bend_count) || 0,
          }
        }),
        personal_expenses: [],
      }
      if (locked) { toast('Bill is locked — cannot edit', true); return }
      if (isEdit && billId) {
        payload.id = billId
        const res = await api.updateBill(payload)
        toast('Bill #' + srNo + ' updated!')
        setTimeout(() => navigate('/bills/' + billId), 600)
      } else {
        const res = await api.createBill(payload)
        toast(res.pending
          ? 'Bill saved on this laptop. Final bill number will be assigned after sync.'
          : 'Bill #' + res.sr_no + ' saved!')
        setTimeout(() => navigate('/bills/' + res.bill_id), 600)
      }
    } catch (e) {
      toast(e.message, true)
    } finally {
      setSaving(false)
    }
  }

  if (loadingEdit) return <div className="loading">Loading bill…</div>

  return (
    <div className="container">
      <div className="page-title">
        <span>{isEdit ? 'Edit Bill' : 'Create New Bill'} — SR# <span className="text-gold">{srNo}</span>
          {locked && <span style={{marginLeft:12,fontSize:'0.85rem',color:'#dc2626'}}>🔒 Locked (PAID + 30 days)</span>}
        </span>
      </div>

      <div className="card">
        <div className="form-grid">
          <div className="form-group">
            <label>Client Name *</label>
            <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Customer name" />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
          </div>
          <div className="form-group">
            <label>Discount (PKR)</label>
            <input type="number" value={discount} onChange={e => setDiscount(e.target.value)} min="0" step="0.01" />
          </div>
          <div className="form-group">
            <label>Paid Amount (PKR)</label>
            <input type="number" value={paid} onChange={e => setPaid(e.target.value)} min="0" step="0.01" />
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
          </div>
        </div>
      </div>

      <div className="page-title" style={{ marginTop: 8 }}>
        <span>Frames / Items</span>
        <button type="button" className="btn btn-green btn-sm"
          onClick={() => setFrames(p => [...p, emptyFrame()])}>
          + Add Frame
        </button>
      </div>

      {frames.map((f, i) => (
        <FrameCard
          key={f._id}
          frame={f}
          index={i}
          onChange={nf => updateFrame(i, nf)}
          onRemove={() => removeFrame(i)}
          canRemove={frames.length > 1}
        />
      ))}

      <div className="grand-bar">
        <div className="gt-item"><div className="gt-label">Grand Total</div><div className="gt-value">{fmt(grand)}</div></div>
        {(() => {
          const bendSum = frames.reduce((s, f) => {
            const br = parseFloat(f.bend_rate) || 0
            const bc = parseFloat(f.bend_count) || 0
            return s + br * bc
          }, 0)
          return bendSum > 0 ? (
            <div className="gt-item">
              <div className="gt-label">Bending Total</div>
              <div className="gt-value" style={{ color: 'var(--text-orange)' }}>{fmt(bendSum)}</div>
            </div>
          ) : null
        })()}
        <div className="gt-item"><div className="gt-label">Net Total</div><div className="gt-value">{fmt(net)}</div></div>
        <div className="gt-item"><div className="gt-label">Paid</div><div className="gt-value green">{fmt(paid)}</div></div>
        <div className="gt-item"><div className="gt-label">Remaining</div><div className="gt-value red">{fmt(remaining)}</div></div>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving || locked}
          style={{ fontSize: '1rem', padding: '12px 28px' }}>
          {saving ? 'Saving…' : (isEdit ? 'Update Bill' : 'Save Bill')}
        </button>
      </div>
    </div>
  )
}
