import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

type AuthState = {
  isReady: boolean
  session: Session | null
  user: User | null
  init: () => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isReady: false,
  session: null,
  user: null,
  init: async () => {
    if (get().isReady) return

    const { data } = await supabase.auth.getSession()
    set({ session: data.session ?? null, user: data.session?.user ?? null })

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session: session ?? null, user: session?.user ?? null, isReady: true })
    })

    set({ isReady: true })
  },
  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, user: null })
  },
}))

