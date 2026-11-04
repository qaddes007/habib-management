import { useState, useEffect, useRef, useCallback } from 'react'

const POLL_INTERVAL = 3000       // Poll every 3 seconds
const SYNC_EVENT   = 'habib-sync' // Global window event name

/**
 * useLiveSync — polls /api/sync.php every 3s.
 * When the DB change-token changes, dispatches window event 'habib-sync'
 * and increments syncTick so pages can re-fetch.
 *
 * Returns: { syncTick, online, lastSync }
 */
export function useLiveSync() {
  const [syncTick,  setSyncTick]  = useState(0)
  const [online,    setOnline]    = useState(true)
  const [lastSync,  setLastSync]  = useState(null)
  const lastToken = useRef(null)
  const timerRef  = useRef(null)

  const poll = useCallback(async () => {
    try {
      const appToken = window.appSecurity?.apiToken
      const res  = await fetch('/api/sync.php', {
        cache: 'no-store',
        headers: appToken ? { 'X-App-Token': appToken } : {},
      })
      if (!res.ok) throw new Error('Server error')
      const data = await res.json()
      if (!data.ok) throw new Error('Sync failed')

      setOnline(true)
      setLastSync(new Date())

      if (lastToken.current !== null && lastToken.current !== data.token) {
        // Data changed on another machine — notify all pages
        window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { token: data.token } }))
        setSyncTick(t => t + 1)
      }

      lastToken.current = data.token
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => {
    poll() // Run once immediately
    timerRef.current = setInterval(poll, POLL_INTERVAL)
    return () => clearInterval(timerRef.current)
  }, [poll])

  return { syncTick, online, lastSync }
}

/**
 * useAutoRefresh — call inside any page component.
 * When 'habib-sync' fires (another machine saved data), calls refreshFn().
 * refreshFn should be your data-fetch function wrapped in useCallback.
 *
 * Usage:
 *   const load = useCallback(() => api.listBills().then(setData), [])
 *   useAutoRefresh(load)
 */
export function useAutoRefresh(refreshFn) {
  useEffect(() => {
    const handler = () => refreshFn()
    window.addEventListener(SYNC_EVENT, handler)
    return () => window.removeEventListener(SYNC_EVENT, handler)
  }, [refreshFn])
}
