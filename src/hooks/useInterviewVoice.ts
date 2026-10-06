import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { Panelist } from '@/lib/interview/types'

// A tiny silent WAV, played inside the "Join" click so later programmatic playback is allowed.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

const readingMs = (text: string) => Math.min(12_000, 900 + text.split(/\s+/).length * 330)

/**
 * Plays interviewer lines in each panelist's own voice and resolves when the line has finished.
 * Server TTS (per-panelist Gemini voice) first; the browser's speech synthesis as fallback.
 */
export function useInterviewVoice() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cacheRef = useRef(new Map<string, Promise<string | null>>())
  const cancelRef = useRef<(() => void) | null>(null)
  const mutedRef = useRef(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [preparingId, setPreparingId] = useState<string | null>(null)
  const [muted, setMutedState] = useState(false)

  useEffect(() => {
    const cache = cacheRef.current
    return () => {
      cancelRef.current?.()
      audioRef.current?.pause()
      window.speechSynthesis?.cancel()
      for (const p of cache.values()) void p.then((url) => url && URL.revokeObjectURL(url))
    }
  }, [])

  const unlock = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio()
    const a = audioRef.current
    a.src = SILENT_WAV
    void a.play().catch(() => undefined)
  }, [])

  const fetchClip = useCallback((text: string, panelist: Panelist) => {
    const key = `${panelist.voice}|${text}`
    const cached = cacheRef.current.get(key)
    if (cached) return cached
    const p = (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token ?? ''
        if (!token) return null
        const resp = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text, lang: 'en-IN', voice: panelist.voice, gender: panelist.gender === 'female' ? 'FEMALE' : 'MALE' }),
        })
        if (!resp.ok) return null
        return URL.createObjectURL(await resp.blob())
      } catch {
        return null
      }
    })()
    cacheRef.current.set(key, p)
    void p.then((url) => {
      if (!url) cacheRef.current.delete(key)
    })
    return p
  }, [])

  const speakWithBrowser = (text: string, panelist: Panelist, onDone: () => void) => {
    const synth = window.speechSynthesis
    if (!synth) {
      const t = window.setTimeout(onDone, readingMs(text))
      return () => window.clearTimeout(t)
    }
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'en-IN'
    const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
    const wantFemale = panelist.gender === 'female'
    const byGender = voices.find((v) => (wantFemale ? /female|woman|samantha|veena|zira/i : /male|man|daniel|rishi|david/i).test(v.name))
    if (byGender ?? voices[0]) utter.voice = (byGender ?? voices[0])!
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      onDone()
    }
    utter.onend = finish
    utter.onerror = finish
    // Some browsers never fire onend; never leave the interview hanging.
    const guard = window.setTimeout(finish, readingMs(text) * 2.5)
    synth.cancel()
    synth.speak(utter)
    return () => {
      window.clearTimeout(guard)
      synth.cancel()
      finish()
    }
  }

  /**
   * Speaks a line and resolves when it has finished (or after a reading delay when muted).
   * clipOnly: skip silently unless the panelist's own voice clip is available — used for short
   * acknowledgements, so a robotic browser voice never interrupts a panelist's real voice.
   */
  const speak = useCallback(
    (text: string, panelist: Panelist, { clipOnly = false }: { clipOnly?: boolean } = {}) =>
      new Promise<void>((resolve) => {
        cancelRef.current?.()
        let done = false
        const finish = () => {
          if (done) return
          done = true
          cancelRef.current = null
          setSpeakingId(null)
          setPreparingId(null)
          resolve()
        }

        if (mutedRef.current) {
          if (clipOnly) {
            finish()
            return
          }
          setSpeakingId(panelist.id)
          const t = window.setTimeout(finish, readingMs(text))
          cancelRef.current = () => {
            window.clearTimeout(t)
            finish()
          }
          return
        }

        let stopBrowser: (() => void) | null = null
        cancelRef.current = () => {
          audioRef.current?.pause()
          stopBrowser?.()
          finish()
        }

        const viaBrowser = () => {
          if (clipOnly) {
            finish()
            return
          }
          setPreparingId(null)
          setSpeakingId(panelist.id)
          stopBrowser = speakWithBrowser(text, panelist, finish)
        }

        setPreparingId(panelist.id)
        void fetchClip(text, panelist).then((url) => {
          if (done) return
          if (!url) {
            viaBrowser()
            return
          }
          if (!audioRef.current) audioRef.current = new Audio()
          const a = audioRef.current
          a.onended = finish
          a.onerror = viaBrowser
          a.onplaying = () => {
            setPreparingId(null)
            setSpeakingId(panelist.id)
          }
          a.src = url
          a.currentTime = 0
          a.play().catch(viaBrowser)
        })
      }),
    [fetchClip],
  )

  const stop = useCallback(() => cancelRef.current?.(), [])

  const setMuted = useCallback((value: boolean) => {
    mutedRef.current = value
    setMutedState(value)
    if (value && audioRef.current) audioRef.current.volume = 0
    if (!value && audioRef.current) audioRef.current.volume = 1
  }, [])

  return { speak, stop, prefetch: fetchClip, unlock, speakingId, preparingId, muted, setMuted }
}
