import { useEffect, useState } from 'react'
import { adminApi } from '@/lib/adminApi'

/** Loads the provider's model list once; used by tests and the route editor. */
export function useProviderModels(providerId: string | null) {
  const [state, setState] = useState<{ loading: boolean; models: string[]; message: string | null }>({ loading: false, models: [], message: null })
  useEffect(() => {
    if (!providerId) return
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    void adminApi<{ ok: boolean; models: string[]; message: string | null }>(`/ai/providers/${providerId}/models`)
      .then((r) => alive && setState({ loading: false, models: r.models, message: r.ok ? null : r.message }))
      .catch((e) => alive && setState({ loading: false, models: [], message: e instanceof Error ? e.message : 'Could not list models' }))
    return () => {
      alive = false
    }
  }, [providerId])
  return state
}
