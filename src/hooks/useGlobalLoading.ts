import { useCallback } from 'react'
import { useLoadingStore } from '@/store/loadingStore'

export function useGlobalLoading() {
  const begin = useLoadingStore((s) => s.begin)
  const end = useLoadingStore((s) => s.end)

  const wrap = useCallback(
    async <T,>(work: Promise<T>): Promise<T> => {
      begin()
      try {
        return await work
      } finally {
        end()
      }
    },
    [begin, end],
  )

  const wrapFn = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      begin()
      try {
        return await fn()
      } finally {
        end()
      }
    },
    [begin, end],
  )

  return { wrap, wrapFn }
}

