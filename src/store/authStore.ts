import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabaseClient'

type AuthState = {
  isReady: boolean
  session: Session | null
  user: User | null
  isBlocked: boolean
  init: () => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isReady: false,
  session: null,
  user: null,
  isBlocked: false,
  init: async () => {
    if (get().isReady) return

    if (!isSupabaseConfigured) {
      set({ isReady: true, session: null, user: null, isBlocked: false })
      return
    }

    const supabase = getSupabase()

    const { data } = await supabase.auth.getSession()
    set({ session: data.session ?? null, user: data.session?.user ?? null, isBlocked: false })

    const checkBlocked = async (userId: string) => {
      const { data: prof } = await supabase.from('profiles').select('is_blocked').eq('id', userId).maybeSingle()
      const blocked = !!(prof as any)?.is_blocked
      if (blocked) {
        await supabase.auth.signOut()
        set({ session: null, user: null, isBlocked: true, isReady: true })
        return true
      }
      return false
    }

    if (data.session?.user?.id) {
      const blocked = await checkBlocked(data.session.user.id)
      if (blocked) return
    }

    supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        const nextUser = session?.user ?? null
        if (nextUser?.id) {
          const wasBlocked = await checkBlocked(nextUser.id)
          if (wasBlocked) return
        }
        set({ session: session ?? null, user: nextUser, isBlocked: false, isReady: true })
      })()
    })

    set({ isReady: true })
  },
  signOut: async () => {
    if (!isSupabaseConfigured) {
      set({ session: null, user: null, isBlocked: false, isReady: true })
      return
    }

    const supabase = getSupabase()
    await supabase.auth.signOut()
    set({ session: null, user: null, isBlocked: false })
  },
}))
