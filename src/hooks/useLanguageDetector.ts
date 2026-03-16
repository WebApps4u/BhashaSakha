import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export function useLanguageDetector() {
  const [isDetecting, setIsDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detect = async (): Promise<{ language: string | null; error: string | null }> => {
    setIsDetecting(true)
    setError(null)
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Use standard mime types that are widely supported
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      const chunks: Blob[] = []

      return new Promise((resolve) => {
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data)
        }

        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop())
            
            const blob = new Blob(chunks, { type: mimeType })
            
            const { data: { session } } = await supabase.auth.getSession()
            if (!session) {
                const msg = 'Unauthorized'
                setError(msg)
                setIsDetecting(false)
                resolve({ language: null, error: msg })
                return
            }

            const formData = new FormData()
            formData.append('audio', blob)

            try {
                // In production, we need to use the full Vercel URL or rely on relative path correctly
                const apiUrl = import.meta.env.PROD ? `${window.location.origin}/api/detect` : '/api/detect'
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${session.access_token}`
                    },
                    body: formData
                })
                
                if (!res.ok) {
                    throw new Error(`Detection failed: ${res.status}`)
                }
                
                const json = await res.json()
                setIsDetecting(false)
                if (json.success && json.language && json.language !== 'und') {
                    resolve({ language: json.language, error: null })
                } else {
                    const msg = 'Could not identify language'
                    setError(msg)
                    resolve({ language: null, error: msg })
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Detection failed'
                setError(msg)
                setIsDetecting(false)
                resolve({ language: null, error: msg })
            }
        }

        mediaRecorder.start()
        // Record for 3.5 seconds
        setTimeout(() => {
            if (mediaRecorder.state === 'recording') {
                mediaRecorder.stop()
            }
        }, 3500)
      })

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone access failed'
      setError(msg)
      setIsDetecting(false)
      return { language: null, error: msg }
    }
  }

  return { isDetecting, error, detect }
}
