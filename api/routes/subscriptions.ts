import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'

const router = Router()

const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const jsonError = (res: Response, status: number, message: string) => {
  res.status(status).json({ success: false, error: message })
}

const parseBearer = (req: Request) => {
  const auth = req.header('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
}

const requireAnonEnv = () => {
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_ANON_KEY = getSupabaseAnonKey()
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL')
  if (!SUPABASE_ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY')
}

const anonClient = () => {
  requireAnonEnv()
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const userClient = (token: string) => {
  requireAnonEnv()
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

const adminClient = () => {
  requireAnonEnv()
  const key = getSupabaseServiceRoleKey()
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  return createClient(getSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const verifyUser = async (req: Request) => {
  requireAnonEnv()
  const token = parseBearer(req)
  if (!token) return { ok: false as const, status: 401, error: 'Unauthorized' }
  const supabase = anonClient()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return { ok: false as const, status: 401, error: 'Unauthorized' }
  return { ok: true as const, userId: data.user.id, token }
}

const monthKeyUtc = (d = new Date()) => {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

const nextMonthStartUtcIso = (d = new Date()) => {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const next = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0))
  return next.toISOString()
}

router.get('/plans', async (_req: Request, res: Response): Promise<void> => {
  try {
    const supabase = anonClient()
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('code,name,monthly_request_limit,monthly_char_limit,is_active')
      .eq('is_active', true)
      .order('monthly_request_limit', { ascending: true })
    if (error) {
      jsonError(res, 500, error.message)
      return
    }
    res.status(200).json({ success: true, plans: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }

    const month = monthKeyUtc()
    const supabase = getSupabaseServiceRoleKey() ? adminClient() : userClient(v.token)

    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('plan_code,effective_from,override_monthly_request_limit,override_monthly_char_limit,created_at')
      .eq('user_id', v.userId)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const planCode = (sub as any)?.plan_code ?? 'free'

    const { data: planRow } = await supabase
      .from('subscription_plans')
      .select('code,name,monthly_request_limit,monthly_char_limit,is_active')
      .eq('code', planCode)
      .maybeSingle()

    const plan = {
      code: (planRow as any)?.code ?? planCode,
      name: (planRow as any)?.name ?? planCode,
      monthly_request_limit: (sub as any)?.override_monthly_request_limit ?? (planRow as any)?.monthly_request_limit ?? 0,
      monthly_char_limit: (sub as any)?.override_monthly_char_limit ?? (planRow as any)?.monthly_char_limit ?? 0,
      effective_from: (sub as any)?.effective_from ?? null,
    }

    const { data: usageRow } = await supabase
      .from('usage_months')
      .select('month,requests_used,chars_used,updated_at')
      .eq('user_id', v.userId)
      .eq('month', month)
      .maybeSingle()

    const requestsUsed = Number((usageRow as any)?.requests_used ?? 0)
    const charsUsed = Number((usageRow as any)?.chars_used ?? 0)
    const reqLimit = Number(plan.monthly_request_limit ?? 0)
    const charLimit = Number(plan.monthly_char_limit ?? 0)

    const remainingRequests = reqLimit === 0 ? null : Math.max(0, reqLimit - requestsUsed)
    const remainingChars = charLimit === 0 ? null : Math.max(0, charLimit - charsUsed)

    res.status(200).json({
      success: true,
      user_id: v.userId,
      month,
      plan,
      usage: { requests_used: requestsUsed, chars_used: charsUsed, updated_at: (usageRow as any)?.updated_at ?? null },
      remaining: { requests_remaining: remainingRequests, chars_remaining: remainingChars },
      reset_at: nextMonthStartUtcIso(),
    })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

export default router

