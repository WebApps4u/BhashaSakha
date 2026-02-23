import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
export const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey ? 'Missing Supabase env vars: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY' : null

export const isSupabaseConfigured = !supabaseConfigError

export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null

export const getSupabase = (): SupabaseClient => {
  if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase is not configured')
  return supabase
}
