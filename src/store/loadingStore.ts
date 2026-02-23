import { create } from 'zustand'

type LoadingState = {
  pending: number
  begin: () => void
  end: () => void
  reset: () => void
}

export const useLoadingStore = create<LoadingState>((set) => ({
  pending: 0,
  begin: () => set((s) => ({ pending: s.pending + 1 })),
  end: () => set((s) => ({ pending: Math.max(0, s.pending - 1) })),
  reset: () => set({ pending: 0 }),
}))

