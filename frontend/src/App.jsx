import { Routes, Route, NavLink } from 'react-router-dom'
import { useState, useCallback, useEffect } from 'react'
import Dashboard from './pages/Dashboard'
import NewBill from './pages/NewBill'
import Bills from './pages/Bills'
import BillView from './pages/BillView'
import Stock from './pages/Stock'
import Expenses from './pages/Expenses'
import Reports from './pages/Reports'
import { useLiveSync } from './hooks/useLiveSync'

function Toast({ message, error, onClose }) {
  if (!message) return null
  return (
    <div className={'toast' + (error ? ' error' : '')} onClick={onClose}>
      {message}
    </div>
  )
}

/** Live Sync Status Dot shown in the header */
function LiveSyncBadge({ online, lastSync }) {
  const timeStr = lastSync
    ? lastSync.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'

  return (
    <div
      title={online ? `Live Sync Active — Last check: ${timeStr}` : 'Offline — reconnecting…'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '0.72rem',
        fontWeight: 700,
        color: online ? '#2dd4bf' : '#f87171',
        background: online ? 'rgba(45, 212, 191, 0.1)' : 'rgba(248, 113, 113, 0.1)',
        border: `1px solid ${online ? 'rgba(45,212,191,0.35)' : 'rgba(248,113,113,0.35)'}`,
        borderRadius: '20px',
        padding: '4px 10px',
        letterSpacing: '0.4px',
        transition: 'all 0.4s ease',
        cursor: 'default',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <span style={{
        width: 8, height: 8,
        borderRadius: '50%',
        background: online ? '#2dd4bf' : '#f87171',
        display: 'inline-block',
        animation: online ? 'livePulse 2s ease-in-out infinite' : 'none',
        flexShrink: 0,
      }} />
      {online ? 'LIVE' : 'OFFLINE'}
    </div>
  )
}

export default function App() {
  const [toast, setToast] = useState({ msg: '', error: false })
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') === 'light' ? 'light' : 'dark')
  const { online, lastSync } = useLiveSync()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  const showToast = useCallback((msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast({ msg: '', error: false }), 3200)
  }, [])

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <img
            src="/logo.png.jpeg"
            alt="SH"
            style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'contain', background: '#fff', filter: 'grayscale(1) contrast(1.1)' }}
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
          />
          <div className="brand-logo" style={{ display: 'none' }}>SH</div>
          <div>
            <h1>S. HABIB STEEL &amp; LASER CRAFT</h1>
            <div className="tagline">
              <span>HRC · CRC · GP · GI · Stainless Steel · Laser Cutting</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span className="app-version">v{__APP_VERSION__}</span>
          <LiveSyncBadge online={online} lastSync={lastSync} />
          <button
            type="button"
            className="btn btn-ghost theme-toggle"
            onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
          </button>
          <nav className="nav-links">
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/new-bill">+ New Bill</NavLink>
            <NavLink to="/bills">Bills</NavLink>
            <NavLink to="/stock">Stock</NavLink>
            <NavLink to="/expenses">Expenses</NavLink>
            <NavLink to="/reports">Reports</NavLink>
          </nav>
        </div>
      </header>

      {!online && (
        <div className="offline-notice" role="status">
          Offline — is laptop par pehle load hua saved data hi dikh sakta hai. Changes connection wapas aane tak band hain.
        </div>
      )}

      <Routes>
        <Route path="/"          element={<Dashboard toast={showToast} />} />
        <Route path="/new-bill"  element={<NewBill   toast={showToast} />} />
        <Route path="/edit-bill/:id" element={<NewBill toast={showToast} />} />
        <Route path="/bills"     element={<Bills     toast={showToast} />} />
        <Route path="/bills/:id" element={<BillView  toast={showToast} />} />
        <Route path="/stock"     element={<Stock     toast={showToast} />} />
        <Route path="/expenses"  element={<Expenses  toast={showToast} />} />
        <Route path="/reports"   element={<Reports   toast={showToast} />} />
      </Routes>

      <Toast message={toast.msg} error={toast.error} onClose={() => setToast({ msg: '', error: false })} />
    </>
  )
}
