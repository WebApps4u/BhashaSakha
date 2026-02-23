import { useEffect, useMemo, useState } from 'react'

const safeGetVoices = () => {
  if (typeof window === 'undefined') return []
  if (!('speechSynthesis' in window)) return []
  try {
    return window.speechSynthesis.getVoices() || []
  } catch {
    return []
  }
}

export function useSpeechVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => safeGetVoices())

  useEffect(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
    if (!synth) return

    const update = () => {
      setVoices(safeGetVoices())
    }

    update()
    synth.addEventListener('voiceschanged', update)
    const timer = window.setTimeout(update, 250)

    return () => {
      window.clearTimeout(timer)
      synth.removeEventListener('voiceschanged', update)
    }
  }, [])

  const groupedByLang = useMemo(() => {
    const map: Record<string, SpeechSynthesisVoice[]> = {}
    for (const v of voices) {
      const key = (v.lang || 'und').toLowerCase()
      map[key] = map[key] ? [...map[key], v] : [v]
    }
    return map
  }, [voices])

  return { voices, groupedByLang }
}

