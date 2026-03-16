import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export function useLanguageDetector() {
  const [isDetecting, setIsDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detectFromText = async (text: string): Promise<{ language: string | null; error: string | null }> => {
    const trimmed = (text ?? '').trim()
    if (!trimmed) return { language: null, error: 'Missing text' }

    setIsDetecting(true)
    setError(null)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        const msg = 'Unauthorized'
        setError(msg)
        setIsDetecting(false)
        return { language: null, error: msg }
      }

      const apiUrl = import.meta.env.PROD ? `${window.location.origin}/api/detect-text` : '/api/detect-text'
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ text: trimmed }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = (json as any)?.error ? String((json as any).error) : `Detection failed: ${res.status}`
        setError(msg)
        setIsDetecting(false)
        return { language: null, error: msg }
      }

      const language = (json as any)?.language ? String((json as any).language) : null
      if ((json as any)?.success && language && language !== 'und') {
        setIsDetecting(false)
        return { language, error: null }
      }

      const msg = (json as any)?.error ? String((json as any).error) : 'Could not identify language'
      setError(msg)
      setIsDetecting(false)
      return { language: null, error: msg }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Detection failed'
      setError(msg)
      setIsDetecting(false)
      return { language: null, error: msg }
    }
  }

  return { isDetecting, error, detectFromText }
}
