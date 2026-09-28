import { useCallback, useEffect, useState } from 'react'
import { useOnlineStatus } from './useOnlineStatus'

export function useBackendReachability(): { browserOnline: boolean; backendReachable: boolean; retry: () => void } {
  const browserOnline = useOnlineStatus()
  const [backendReachable, setBackendReachable] = useState(true)
  const [tick, setTick] = useState(0)
  const probe = useCallback(async (signal: AbortSignal): Promise<void> => {
    if (!navigator.onLine) {
      setBackendReachable(false)
      return
    }
    try {
      const response = await fetch('/api/health', { signal, cache: 'no-store' })
      setBackendReachable(response.ok)
    } catch {
      if (!signal.aborted) setBackendReachable(false)
    }
  }, [])

  useEffect(() => {
    if (!browserOnline) {
      setBackendReachable(false)
      return
    }
    const controller = new AbortController()
    void probe(controller.signal)
    const timer = window.setInterval(() => {
      const nextController = new AbortController()
      void probe(nextController.signal)
      window.setTimeout(() => nextController.abort(), 5000)
    }, 30_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [browserOnline, probe, tick])

  return { browserOnline, backendReachable, retry: () => setTick((value) => value + 1) }
}
