import { useEffect, useState, useCallback } from 'react'
import { api, fmt } from '../api/client'
import { useAutoRefresh } from '../hooks/useLiveSync'

const today = () => new Date().toISOString().slice(0, 10)

function ExpensePanel({ type, title, toast }) {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [cat, setCat] = useState('General')
  const [editId, setEditId] = useState(null)

  const load = useCallback(() => {
    api.listExpenses(type, from, to)
      .then(d => { setRows(d.data || []); setTotal(d.total || 0) })
      .catch(e => toast(e.message, true))
  }, [type, from, to])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load)

  const resetForm = () => {
    setDesc('')
    setAmount('')
    setDate(today())
    setCat('General')
    setEditId(null)
  }

  const startEdit = (e) => {
    setEditId(e.id)
    setDesc(e.description || '')
    setAmount(String(e.amount ?? ''))
    setDate(e.expense_date || today())
    setCat(e.category || 'General')
  }

  const save = async () => {
    if (!desc.trim() || !(parseFloat(amount) > 0)) {
      toast('Description and amount required', true)
      return
    }
    try {
      const body = {
        description: desc.trim(),
        amount: parseFloat(amount),
        expense_date: date,
        category: cat,
      }
      if (editId) {
        const result = await api.updateExpense(type, { ...body, id: editId })
        toast(result.pending ? 'Expense update saved on this laptop; it will sync later.' : 'Expense updated')
      } else {
        const result = await api.addExpense(type, body)
        toast(result.pending ? 'Expense saved on this laptop; it will sync later.' : 'Expense added')
      }
      resetForm()
      load()
    } catch (e) {
      toast(e.message, true)
    }
  }

  const del = async (id) => {
    if (!confirm('Delete this expense?')) return
    try {
      const result = await api.deleteExpense(type, id)
      toast(result.pending ? 'Expense deletion saved on this laptop; it will sync later.' : 'Deleted')
      if (editId === id) resetForm()
      load()
    } catch (e) {
      toast(e.message, true)
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>{title}</h3>
        <span className="text-gold">{fmt(total)}</span>
      </div>
      <div className="form-grid mb-2">
        <div className="form-group">
          <label>Description</label>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Electricity" />
        </div>
        <div className="form-group">
          <label>Amount</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min="0" step="0.01" />
        </div>
        {type === 'business' && (
          <div className="form-group">
            <label>Category</label>
            <select value={cat} onChange={e => setCat(e.target.value)}>
              <option>General</option><option>Utilities</option><option>Transport</option>
              <option>Salaries</option><option>Materials</option><option>Other</option>
            </select>
          </div>
        )}
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div className="btn-group mb-2" style={{ justifyContent: 'space-between' }}>
        <div className="btn-group">
          <button className="btn btn-orange btn-sm" onClick={save}>
            {editId ? '💾 Update' : '+ Add'}
          </button>
          {editId && (
            <button className="btn btn-ghost btn-sm" onClick={resetForm}>Cancel</button>
          )}
        </div>
        <div className="btn-group">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ background: 'var(--entry-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 7 }} />
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ background: 'var(--entry-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 7 }} />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Desc</th>{type === 'business' && <th>Cat</th>}<th>Amount</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="empty-state">No expenses</td></tr>}
            {rows.map(e => (
              <tr key={e.id} style={editId === e.id ? { background: 'rgba(249,115,22,0.12)' } : undefined}>
                <td>{e.expense_date}</td>
                <td>{e.description}{e.pending && <span className="badge badge-unpaid" style={{ marginLeft: 8 }}>Pending sync</span>}</td>
                {type === 'business' && <td>{e.category || '—'}</td>}
                <td>{fmt(e.amount)}</td>
                <td className="btn-group">
                  <button className="btn btn-blue btn-sm" onClick={() => startEdit(e)}>Edit</button>
                  <button className="btn btn-red btn-sm" onClick={() => del(e.id)}>Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Expenses({ toast }) {
  return (
    <div className="container">
      <div className="page-title"><span>💸 Expenses</span></div>
      <div className="grid-2">
        <ExpensePanel type="business" title="Business Expenses" toast={toast} />
        <ExpensePanel type="personal" title="Food Expenses" toast={toast} />
      </div>
    </div>
  )
}
