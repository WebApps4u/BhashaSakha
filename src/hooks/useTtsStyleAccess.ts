import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type StyleFlag = {
  key: string
  is_enabled: boolean
  config: any
}

const normalizeTier = (planCode: string) => (String(planCode ?? '').toLowerCase() === 'free' ? 'free' : 'pro')

export function useTtsStyleAccess() {
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        setLoading(true)
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData.session?.access_token ?? ''
        if (!token) {
          if (mounted) {
            setAllowed(false)
            setLoading(false)
          }
          return
        }

        const [flagRes, planRes] = await Promise.all([
          supabase.from('feature_flags').select('key,is_enabled,config').eq('key', 'tts_style_prompting').maybeSingle(),
          fetch('/api/subscriptions/me', { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }),
        ])

        const flag = (flagRes.data ?? null) as StyleFlag | null
        const enabled = !!flag?.is_enabled
        const allowedPlansRaw = flag?.config?.allowed_plans
        const allowedPlans = Array.isArray(allowedPlansRaw) ? allowedPlansRaw.map((x: any) => String(x).toLowerCase()) : ['free', 'pro']

        const planJson = (await planRes.json().catch(() => ({}))) as any
        const tier = normalizeTier(planJson?.plan?.code ?? 'free')

        if (mounted) {
          setAllowed(enabled && allowedPlans.includes(tier))
          setLoading(false)
        }
      } catch {
        if (mounted) {
          setAllowed(false)
          setLoading(false)
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  return useMemo(() => ({ loading, allowed }), [loading, allowed])
}

